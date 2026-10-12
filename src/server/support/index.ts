import "server-only";
import type { Prisma, SupportChannel, SupportPriority, SupportStatus } from "@/generated/prisma/client";
import { SupportMessageEmail } from "@/emails/support-message";
import { resolvePermissions } from "@/lib/permissions";
import { renderMacro, SLA_HOURS, ticketRef } from "@/lib/support-shared";
import { db } from "../db";
import { audit } from "../audit";
import { sendEmail } from "../email";
import { isMailableEmail } from "../marketing";

/*
 * Support desk. Tickets come from the account page (web), the AI concierge hand-off (chat), WhatsApp messages the
 * bot can't place (whatsapp) and staff logging an email or call (email). Customers only ever see their own tickets
 * and never internal notes. Every staff change is permission-checked (support.manage) and audited here, so server
 * actions and tests share one path.
 *
 * Replies by email are out of scope: customer emails carry a link back to /account/support/<number> (or, for
 * customers without an account, ask them to answer on the channel they used). See docs in the final report.
 */

export class SupportError extends Error {}

export type SupportActor = { id: string; permissions: readonly string[]; name?: string | null; email?: string | null };
export type SupportSource = "web" | "email" | "whatsapp" | "chat" | "admin";

const CHANNEL: Record<SupportSource, SupportChannel> = { web: "WEB", email: "EMAIL", whatsapp: "WHATSAPP", chat: "CHAT", admin: "EMAIL" };
const clean = (s: string, max: number) => s.replace(/\r\n/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, max);
const firstName = (n?: string | null) => (n ?? "").trim().split(/\s+/)[0] || "there";

function requireSupport(actor: SupportActor) {
  if (!actor.permissions.includes("support.manage")) throw new SupportError("You don’t have access to the support desk.");
}

/** Only our own upload locations are accepted as attachments. */
export function isAttachmentUrl(url: string) {
  if (/^\/uploads\/support\/[a-z0-9-]+\.(jpg|png|webp|gif|avif)$/i.test(url)) return true;
  const cloud = process.env.CLOUDINARY_CLOUD_NAME;
  return Boolean(cloud) && url.startsWith(`https://res.cloudinary.com/${cloud}/image/upload/`) && url.includes("/maison-oud/support/");
}
const attachmentsOf = (list?: string[] | null) => (list ?? []).filter(isAttachmentUrl).slice(0, 4);

// ─────────────────────────────── Notifications ───────────────────────────────

/** Staff to tell about a new ticket / customer reply: the assignee, else everyone with support.manage (max 5). */
async function staffRecipients(assigneeId: string | null) {
  if (assigneeId) {
    const a = await db.user.findUnique({ where: { id: assigneeId }, select: { email: true } });
    if (a) return [a.email];
  }
  const staff = await db.user.findMany({ where: { role: { in: ["SUPPORT", "MANAGER", "OWNER"] } }, select: { email: true, role: true, staffRole: { select: { permissions: true } } }, take: 50 });
  return staff
    .filter((u) => resolvePermissions(u.role, u.staffRole?.permissions).includes("support.manage"))
    .map((u) => u.email)
    .filter(isMailableEmail)
    .slice(0, 5);
}

async function notifyStaff(t: { id: string; number: number; subject: string; assigneeId: string | null; name: string | null; email: string | null }, kind: "new" | "reply", body: string) {
  try {
    const to = await staffRecipients(t.assigneeId);
    for (const addr of to) {
      await sendEmail({
        to: addr,
        subject: `${kind === "new" ? "New ticket" : "Customer replied"} ${ticketRef(t.number)}: ${t.subject}`,
        react: SupportMessageEmail({ preview: t.subject, title: kind === "new" ? "New support ticket" : "New customer reply", intro: `${t.name ?? t.email ?? "A customer"} · ${ticketRef(t.number)} — ${t.subject}`, message: body.slice(0, 1500), cta: { label: "Open in the inbox", path: `/admin/support/${t.id}` } }),
      });
    }
  } catch (e) {
    console.error("[support] staff notification failed", e instanceof Error ? e.message : e);
  }
}

async function notifyCustomer(t: { number: number; subject: string; userId: string | null; email: string | null; name: string | null }, kind: "received" | "reply" | "resolved", body?: string) {
  try {
    if (!t.email || !isMailableEmail(t.email)) return;
    const path = t.userId ? `/account/support/${t.number}` : undefined;
    const copy = {
      received: { subject: `We’ve received your request ${ticketRef(t.number)}`, title: "We’re on it", intro: `Hello ${firstName(t.name)}, thank you for writing to us about “${t.subject}”. A member of the atelier will reply soon${path ? " — you can follow the conversation in your account" : ""}.` },
      reply: { subject: `Re: ${t.subject} [${ticketRef(t.number)}]`, title: "A reply from Maison Oud", intro: `Hello ${firstName(t.name)}, we’ve answered your request ${ticketRef(t.number)}.${path ? " Reply from your account to continue the conversation." : " To continue, reply on the channel you used to reach us."}` },
      resolved: { subject: `Request ${ticketRef(t.number)} resolved`, title: "All sorted", intro: `Hello ${firstName(t.name)}, we’ve marked ${ticketRef(t.number)} as resolved. If anything is still not right, simply reply in your account and it reopens.` },
    }[kind];
    await sendEmail({ to: t.email, subject: copy.subject, react: SupportMessageEmail({ preview: copy.title, title: copy.title, intro: copy.intro, message: body?.slice(0, 3000), cta: path ? { label: "View conversation", path } : undefined }) });
  } catch (e) {
    console.error("[support] customer email failed", e instanceof Error ? e.message : e);
  }
}

// ─────────────────────────────── Create ───────────────────────────────

export type CreateTicketInput = {
  /** Where it came from. The AI concierge uses "chat". */
  source: SupportSource;
  subject: string;
  /** The customer's request (first message). */
  body: string;
  userId?: string | null;
  email?: string | null;
  phone?: string | null;
  name?: string | null;
  /** Link an order by id or number; it must belong to the customer (by account or email), otherwise it is refused. */
  orderId?: string | null;
  orderNumber?: string | null;
  priority?: SupportPriority;
  tags?: string[];
  attachments?: string[];
  /** Caller's own reference (e.g. the concierge conversation id), shown in the inbox. */
  externalRef?: string | null;
  /** Chat hand-off: the conversation so far, stored as an internal note for staff (never shown to the customer). */
  transcript?: { role: "customer" | "assistant"; text: string }[];
  /** Staff member logging the ticket on the customer's behalf (audited). */
  createdBy?: SupportActor;
  /** Skip the customer acknowledgement email (e.g. the WhatsApp hook answers on WhatsApp instead). */
  quiet?: boolean;
  now?: Date;
};

export type CreatedTicket = { id: string; number: number; reference: string };

async function resolveOrder(input: { orderId?: string | null; orderNumber?: string | null; userId: string | null; email: string | null }) {
  if (!input.orderId && !input.orderNumber) return null;
  const o = await db.order.findFirst({ where: input.orderId ? { id: input.orderId } : { number: input.orderNumber!.trim().toUpperCase() }, select: { id: true, number: true, userId: true, email: true } });
  const mine = o && ((input.userId && o.userId === input.userId) || (input.email && o.email.toLowerCase() === input.email.toLowerCase()));
  if (!o || !mine) throw new SupportError("We couldn’t find that order on your account.");
  return o;
}

/**
 * Opens a ticket. The one entry point for every channel — including the AI concierge hand-off:
 *   createTicket({ source: "chat", subject, body, userId?, email?, orderNumber?, transcript, externalRef })
 * Returns the id and the customer-facing reference (#10001).
 */
export async function createTicket(input: CreateTicketInput): Promise<CreatedTicket> {
  const subject = clean(input.subject, 160);
  const body = clean(input.body, 5000);
  if (subject.length < 3) throw new SupportError("Add a short subject.");
  if (body.length < 2) throw new SupportError("Tell us a little about what you need.");
  if (input.createdBy) requireSupport(input.createdBy);

  const user = input.userId ? await db.user.findUnique({ where: { id: input.userId }, select: { id: true, email: true, name: true, phone: true } }) : null;
  if (input.userId && !user) throw new SupportError("Unknown customer.");
  const email = (user?.email ?? input.email ?? null)?.trim().toLowerCase() || null;
  if (!user && !email && !input.phone) throw new SupportError("We need an email address or phone number to reply to.");
  const order = await resolveOrder({ orderId: input.orderId, orderNumber: input.orderNumber, userId: user?.id ?? null, email });

  const now = input.now ?? new Date();
  const priority = input.priority ?? "NORMAL";
  const via = input.source === "admin" ? "admin" : input.source;
  const messages: Prisma.SupportMessageCreateWithoutTicketInput[] = [
    { author: "customer", authorId: user?.id ?? null, authorName: user?.name ?? input.name ?? null, body, attachments: attachmentsOf(input.attachments), via, createdAt: now },
  ];
  if (input.transcript?.length) {
    const text = input.transcript
      .slice(-40)
      .map((m) => `${m.role === "customer" ? "Customer" : "Concierge"}: ${clean(m.text, 1500)}`)
      .join("\n\n");
    messages.push({ author: "system", authorName: "AI concierge", body: `Chat transcript before hand-off:\n\n${text}`.slice(0, 20_000), internal: true, via: "chat", createdAt: new Date(now.getTime() + 1) });
  }
  const t = await db.supportTicket.create({
    data: {
      subject,
      priority,
      channel: CHANNEL[input.source],
      userId: user?.id ?? null,
      email,
      phone: input.phone ?? user?.phone ?? null,
      name: user?.name ?? input.name ?? null,
      orderId: order?.id ?? null,
      tags: [...new Set((input.tags ?? []).map((x) => clean(x, 30).toLowerCase()).filter(Boolean))].slice(0, 10),
      externalRef: input.externalRef?.slice(0, 120) ?? null,
      firstResponseDueAt: new Date(now.getTime() + SLA_HOURS[priority] * 3600_000),
      lastCustomerAt: now,
      createdAt: now,
      messages: { create: messages },
    },
  });
  if (input.createdBy) await audit(input.createdBy.id, "support.ticket.create", "SupportTicket", t.id, { number: t.number, source: input.source });
  if (!input.quiet) void notifyCustomer(t, "received", body);
  void notifyStaff(t, "new", body);
  return { id: t.id, number: t.number, reference: ticketRef(t.number) };
}

// ─────────────────────────────── Customer side ───────────────────────────────

export async function listCustomerTickets(userId: string) {
  return db.supportTicket.findMany({
    where: { userId, mergedIntoId: null },
    orderBy: { updatedAt: "desc" },
    select: { id: true, number: true, subject: true, status: true, channel: true, updatedAt: true, createdAt: true, lastStaffAt: true, lastCustomerAt: true },
    take: 100,
  });
}

/** One ticket for its owner, without internal notes. Merged tickets resolve to the ticket they were merged into. */
export async function getCustomerTicket(userId: string, number: number) {
  let t = await db.supportTicket.findFirst({ where: { number, userId } });
  if (t?.mergedIntoId) t = await db.supportTicket.findFirst({ where: { id: t.mergedIntoId, userId } });
  if (!t) return null;
  const [messages, order] = await Promise.all([
    db.supportMessage.findMany({ where: { ticketId: t.id, internal: false }, orderBy: { createdAt: "asc" }, select: { id: true, author: true, authorName: true, body: true, attachments: true, createdAt: true } }),
    t.orderId ? db.order.findFirst({ where: { id: t.orderId, userId }, select: { number: true, status: true } }) : null,
  ]);
  return { ...t, messages, order };
}

/** Customer replies in their account. Reopens a resolved ticket; staff are told. */
export async function customerReply(userId: string, number: number, input: { body: string; attachments?: string[] }, now = new Date()) {
  const t = await db.supportTicket.findFirst({ where: { number, userId } });
  if (!t) throw new SupportError("We couldn’t find that request.");
  const target = t.mergedIntoId ? await db.supportTicket.findFirst({ where: { id: t.mergedIntoId, userId } }) : t;
  if (!target) throw new SupportError("We couldn’t find that request.");
  const body = clean(input.body, 5000);
  if (body.length < 1) throw new SupportError("Write a message first.");
  const user = await db.user.findUnique({ where: { id: userId }, select: { name: true } });
  await db.$transaction([
    db.supportMessage.create({ data: { ticketId: target.id, author: "customer", authorId: userId, authorName: user?.name ?? null, body, attachments: attachmentsOf(input.attachments), via: "web", createdAt: now } }),
    db.supportTicket.update({ where: { id: target.id }, data: { status: "OPEN", resolvedAt: null, lastCustomerAt: now } }),
  ]);
  void notifyStaff(target, "reply", body);
  return { id: target.id, number: target.number };
}

/** Orders the customer can attach to a new ticket (most recent first). */
export async function orderChoices(userId: string) {
  return db.order.findMany({ where: { userId }, orderBy: { placedAt: "desc" }, take: 30, select: { id: true, number: true, placedAt: true, status: true, total: true } });
}

// ─────────────────────────────── Staff side ───────────────────────────────

export type InboxFilter = {
  status?: SupportStatus | "ALL";
  assignee?: "me" | "unassigned" | "all" | string;
  priority?: SupportPriority | "ALL";
  channel?: SupportChannel | "ALL";
  tag?: string;
  q?: string;
  page?: number;
};

export const INBOX_PAGE = 30;

export async function listInbox(actor: SupportActor, f: InboxFilter = {}) {
  requireSupport(actor);
  const where: Prisma.SupportTicketWhereInput = { mergedIntoId: null };
  const status = f.status ?? "OPEN";
  if (status !== "ALL") where.status = status;
  if (f.priority && f.priority !== "ALL") where.priority = f.priority;
  if (f.channel && f.channel !== "ALL") where.channel = f.channel;
  if (f.assignee === "me") where.assigneeId = actor.id;
  else if (f.assignee === "unassigned") where.assigneeId = null;
  else if (f.assignee && f.assignee !== "all") where.assigneeId = f.assignee;
  if (f.tag) where.tags = { has: f.tag.toLowerCase() };
  const q = f.q?.trim();
  if (q) {
    const n = Number(q.replace(/^#/, ""));
    where.OR = [
      ...(Number.isInteger(n) && n > 0 && n < 2 ** 31 ? [{ number: n }] : []),
      { subject: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } },
      { name: { contains: q, mode: "insensitive" } },
      { phone: { contains: q } },
    ];
  }
  const page = Math.max(1, f.page ?? 1);
  const [rows, total] = await Promise.all([
    db.supportTicket.findMany({
      where,
      // Urgent first, then oldest SLA deadline, then most recently active.
      orderBy: [{ priority: "desc" }, { firstResponseDueAt: "asc" }, { updatedAt: "desc" }],
      skip: (page - 1) * INBOX_PAGE,
      take: INBOX_PAGE,
      select: { id: true, number: true, subject: true, status: true, priority: true, channel: true, name: true, email: true, phone: true, assigneeId: true, tags: true, firstResponseDueAt: true, firstRespondedAt: true, lastCustomerAt: true, lastStaffAt: true, updatedAt: true, createdAt: true, orderId: true },
    }),
    db.supportTicket.count({ where }),
  ]);
  return { rows, total, pages: Math.max(1, Math.ceil(total / INBOX_PAGE)), page };
}

export async function inboxCounts(actor: SupportActor) {
  requireSupport(actor);
  const [open, pending, mine, unassigned, overdue] = await Promise.all([
    db.supportTicket.count({ where: { status: "OPEN", mergedIntoId: null } }),
    db.supportTicket.count({ where: { status: "PENDING", mergedIntoId: null } }),
    db.supportTicket.count({ where: { status: { not: "RESOLVED" }, assigneeId: actor.id, mergedIntoId: null } }),
    db.supportTicket.count({ where: { status: { not: "RESOLVED" }, assigneeId: null, mergedIntoId: null } }),
    db.supportTicket.count({ where: { status: { not: "RESOLVED" }, firstRespondedAt: null, firstResponseDueAt: { lt: new Date() }, mergedIntoId: null } }),
  ]);
  return { open, pending, mine, unassigned, overdue };
}

export async function getTicketForStaff(actor: SupportActor, id: string) {
  requireSupport(actor);
  const t = await db.supportTicket.findUnique({ where: { id }, include: { messages: { orderBy: { createdAt: "asc" } } } });
  if (!t) return null;
  const [order, customer, others, merged] = await Promise.all([
    t.orderId ? db.order.findUnique({ where: { id: t.orderId }, select: { id: true, number: true, status: true, total: true, placedAt: true } }) : null,
    t.userId ? db.user.findUnique({ where: { id: t.userId }, select: { id: true, name: true, email: true, phone: true, createdAt: true, _count: { select: { orders: true } } } }) : null,
    db.supportTicket.findMany({
      where: { id: { not: t.id }, mergedIntoId: null, OR: [...(t.userId ? [{ userId: t.userId }] : []), ...(t.email ? [{ email: t.email }] : []), ...(t.phone ? [{ phone: t.phone }] : [])] },
      orderBy: { updatedAt: "desc" },
      take: 10,
      select: { id: true, number: true, subject: true, status: true, updatedAt: true },
    }),
    db.supportTicket.findMany({ where: { mergedIntoId: t.id }, select: { id: true, number: true, subject: true } }),
  ]);
  return { ...t, order, customer, others, merged };
}

/** Staff reply (customer-visible) or internal note. Replies set PENDING by default and stop the SLA clock. */
export async function staffReply(actor: SupportActor, ticketId: string, input: { body: string; internal?: boolean; status?: SupportStatus; attachments?: string[] }, now = new Date()) {
  requireSupport(actor);
  const t = await db.supportTicket.findUnique({ where: { id: ticketId } });
  if (!t) throw new SupportError("Ticket not found.");
  if (t.mergedIntoId) throw new SupportError("This ticket was merged — reply on the ticket it was merged into.");
  const body = clean(input.body, 8000);
  if (body.length < 1) throw new SupportError("Write a reply first.");
  const internal = Boolean(input.internal);
  const status: SupportStatus = internal ? (input.status ?? t.status) : (input.status ?? "PENDING");
  await db.$transaction([
    db.supportMessage.create({ data: { ticketId, author: "staff", authorId: actor.id, authorName: actor.name ?? actor.email ?? "Staff", body, internal, attachments: attachmentsOf(input.attachments), via: "admin", createdAt: now } }),
    db.supportTicket.update({
      where: { id: ticketId },
      data: {
        status,
        resolvedAt: status === "RESOLVED" ? (t.resolvedAt ?? now) : null,
        ...(internal ? {} : { lastStaffAt: now, ...(t.firstRespondedAt ? {} : { firstRespondedAt: now }) }),
        // Replying to an unassigned ticket takes it.
        ...(!internal && !t.assigneeId ? { assigneeId: actor.id } : {}),
      },
    }),
  ]);
  await audit(actor.id, internal ? "support.note" : "support.reply", "SupportTicket", ticketId, { number: t.number, status });
  if (!internal) {
    void notifyCustomer(t, status === "RESOLVED" ? "resolved" : "reply", body);
    if (t.channel === "WHATSAPP" && t.phone) {
      try {
        const { sendWhatsApp } = await import("../whatsapp/messages");
        await sendWhatsApp({ phone: t.phone, kind: "support_reply", consent: "reply", message: { type: "text", body: `${body}\n\n— Maison Oud (${ticketRef(t.number)})`.slice(0, 4000) }, userId: t.userId });
      } catch (e) {
        console.error("[support] WhatsApp reply failed", e instanceof Error ? e.message : e);
      }
    }
  }
  return { status };
}

export type TicketPatch = { status?: SupportStatus; priority?: SupportPriority; assigneeId?: string | null; tags?: string[]; subject?: string };

export async function updateTicket(actor: SupportActor, ticketId: string, patch: TicketPatch, now = new Date()) {
  requireSupport(actor);
  const t = await db.supportTicket.findUnique({ where: { id: ticketId } });
  if (!t) throw new SupportError("Ticket not found.");
  const data: Prisma.SupportTicketUpdateInput = {};
  const changes: Record<string, unknown> = {};
  if (patch.status && patch.status !== t.status) {
    data.status = patch.status;
    data.resolvedAt = patch.status === "RESOLVED" ? now : null;
    changes.status = [t.status, patch.status];
  }
  if (patch.priority && patch.priority !== t.priority) {
    data.priority = patch.priority;
    // A new priority re-times an SLA that hasn't been met yet.
    if (!t.firstRespondedAt) data.firstResponseDueAt = new Date(t.createdAt.getTime() + SLA_HOURS[patch.priority] * 3600_000);
    changes.priority = [t.priority, patch.priority];
  }
  if (patch.assigneeId !== undefined && patch.assigneeId !== t.assigneeId) {
    if (patch.assigneeId) {
      const a = await db.user.findUnique({ where: { id: patch.assigneeId }, select: { role: true, staffRole: { select: { permissions: true } } } });
      if (!a || !resolvePermissions(a.role, a.staffRole?.permissions).includes("support.manage")) throw new SupportError("That person can’t work on support tickets.");
    }
    data.assigneeId = patch.assigneeId;
    changes.assignee = [t.assigneeId, patch.assigneeId];
  }
  if (patch.tags) {
    const tags = [...new Set(patch.tags.map((x) => clean(x, 30).toLowerCase()).filter(Boolean))].slice(0, 10);
    data.tags = tags;
    changes.tags = tags;
  }
  if (patch.subject) {
    const s = clean(patch.subject, 160);
    if (s.length >= 3) data.subject = s;
  }
  if (!Object.keys(data).length) return t;
  const updated = await db.supportTicket.update({ where: { id: ticketId }, data });
  if (changes.status) await db.supportMessage.create({ data: { ticketId, author: "system", authorName: actor.name ?? "Staff", body: `Status changed to ${String(patch.status).toLowerCase()}.`, internal: true, via: "admin", createdAt: now } });
  await audit(actor.id, "support.update", "SupportTicket", ticketId, { number: t.number, ...changes } as Prisma.InputJsonValue);
  if (changes.status && patch.status === "RESOLVED") void notifyCustomer(t, "resolved");
  return updated;
}

/** Moves every message of `sourceId` into `targetId`; the source is closed and points at the target. */
export async function mergeTickets(actor: SupportActor, sourceId: string, targetNumber: number, now = new Date()) {
  requireSupport(actor);
  const [source, target] = await Promise.all([db.supportTicket.findUnique({ where: { id: sourceId } }), db.supportTicket.findUnique({ where: { number: targetNumber } })]);
  if (!source || !target) throw new SupportError("Ticket not found.");
  if (source.id === target.id) throw new SupportError("A ticket can’t be merged into itself.");
  if (target.mergedIntoId) throw new SupportError(`${ticketRef(target.number)} was itself merged — choose the ticket it went into.`);
  await db.$transaction([
    db.supportMessage.updateMany({ where: { ticketId: source.id }, data: { ticketId: target.id } }),
    db.supportMessage.create({ data: { ticketId: target.id, author: "system", authorName: actor.name ?? "Staff", body: `Merged ${ticketRef(source.number)} (“${source.subject}”) into this ticket.`, internal: true, via: "admin", createdAt: now } }),
    db.supportTicket.updateMany({ where: { mergedIntoId: source.id }, data: { mergedIntoId: target.id } }),
    db.supportTicket.update({ where: { id: source.id }, data: { status: "RESOLVED", resolvedAt: now, mergedIntoId: target.id } }),
    db.supportTicket.update({
      where: { id: target.id },
      data: {
        status: target.status === "RESOLVED" || source.status === "OPEN" ? "OPEN" : target.status,
        resolvedAt: null,
        tags: [...new Set([...target.tags, ...source.tags])].slice(0, 10),
        // Keep the customer link if only the source had it.
        ...(!target.userId && source.userId ? { userId: source.userId } : {}),
        ...(!target.orderId && source.orderId ? { orderId: source.orderId } : {}),
        lastCustomerAt: [target.lastCustomerAt, source.lastCustomerAt].filter(Boolean).sort((a, b) => b!.getTime() - a!.getTime())[0] ?? null,
      },
    }),
  ]);
  await audit(actor.id, "support.merge", "SupportTicket", target.id, { from: source.number, into: target.number });
  return { targetId: target.id, number: target.number };
}

/** People who can be assigned tickets. */
export async function supportAgents() {
  const staff = await db.user.findMany({ where: { role: { in: ["SUPPORT", "MANAGER", "OWNER"] } }, select: { id: true, name: true, email: true, role: true, staffRole: { select: { permissions: true } } }, orderBy: { name: "asc" }, take: 100 });
  return staff.filter((u) => resolvePermissions(u.role, u.staffRole?.permissions).includes("support.manage")).map((u) => ({ id: u.id, name: u.name ?? u.email }));
}

// ─────────────────────────────── Macros (canned replies) ───────────────────────────────

const DEFAULT_MACROS = [
  { title: "Where is my order", body: "Hello {{first_name}},\n\nThank you for your patience. {{order}} is on its way — you can follow it live from your account under Orders. If it hasn’t moved in two days, reply here and we’ll chase the courier for you.\n\nWarmly,\nMaison Oud" },
  { title: "Return instructions", body: "Hello {{first_name}},\n\nOf course — you can start a return for {{order}} from your account (Orders → Return items) within 14 days of delivery. We’ll email a label and refund as soon as the parcel reaches the atelier.\n\nWarmly,\nMaison Oud" },
  { title: "Thank you & closing", body: "Hello {{first_name}},\n\nI’m glad that’s sorted. I’ll close this request now — just reply if there’s anything else.\n\nWarmly,\nMaison Oud" },
];

export async function listMacros() {
  const rows = await db.supportMacro.findMany({ orderBy: { title: "asc" } });
  if (rows.length) return rows;
  // First use: seed a few sensible replies the team can edit.
  await db.supportMacro.createMany({ data: DEFAULT_MACROS, skipDuplicates: true });
  return db.supportMacro.findMany({ orderBy: { title: "asc" } });
}

export async function saveMacro(actor: SupportActor, input: { id?: string | null; title: string; body: string }) {
  requireSupport(actor);
  const title = clean(input.title, 80);
  const body = clean(input.body, 5000);
  if (title.length < 2 || body.length < 2) throw new SupportError("A canned reply needs a title and text.");
  try {
    const m = input.id ? await db.supportMacro.update({ where: { id: input.id }, data: { title, body } }) : await db.supportMacro.create({ data: { title, body } });
    await audit(actor.id, input.id ? "support.macro.update" : "support.macro.create", "SupportMacro", m.id, { title });
    return m;
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") throw new SupportError("A canned reply with that title already exists.");
    throw e;
  }
}

export async function deleteMacro(actor: SupportActor, id: string) {
  requireSupport(actor);
  const m = await db.supportMacro.delete({ where: { id } }).catch(() => null);
  if (m) await audit(actor.id, "support.macro.delete", "SupportMacro", id, { title: m.title });
  return Boolean(m);
}

export { renderMacro };

// ─────────────────────────────── WhatsApp inbound ───────────────────────────────

/**
 * A WhatsApp message the bot couldn't place (not a COD answer, STOP/START): becomes a ticket, or joins the customer's
 * open WhatsApp ticket from the last 7 days. Returns the ticket and whether it was new (the hook acknowledges new ones).
 */
export async function ticketFromWhatsApp(input: { phone: string; text: string; now?: Date }) {
  const now = input.now ?? new Date();
  const text = clean(input.text, 4000);
  if (!text) return null;
  const existing = await db.supportTicket.findFirst({
    where: { phone: input.phone, channel: "WHATSAPP", mergedIntoId: null, OR: [{ status: { not: "RESOLVED" } }, { resolvedAt: { gt: new Date(now.getTime() - 864e5) } }], updatedAt: { gt: new Date(now.getTime() - 7 * 864e5) } },
    orderBy: { updatedAt: "desc" },
  });
  if (existing) {
    await db.$transaction([
      db.supportMessage.create({ data: { ticketId: existing.id, author: "customer", authorName: existing.name, body: text, via: "whatsapp", createdAt: now } }),
      db.supportTicket.update({ where: { id: existing.id }, data: { status: "OPEN", resolvedAt: null, lastCustomerAt: now } }),
    ]);
    void notifyStaff(existing, "reply", text);
    return { id: existing.id, number: existing.number, created: false };
  }
  // Who is this? A customer with that phone, or the WhatsApp contact's known email / account.
  const contact = await db.whatsAppContact.findUnique({ where: { phone: input.phone }, select: { userId: true, email: true } });
  const user =
    (contact?.userId ? await db.user.findUnique({ where: { id: contact.userId }, select: { id: true } }) : null) ??
    (await db.user.findFirst({ where: { OR: [{ phone: input.phone }, ...(contact?.email ? [{ email: contact.email }] : [])] }, select: { id: true } }));
  const subject = `WhatsApp: ${text.split("\n")[0].slice(0, 60)}${text.length > 60 ? "…" : ""}`;
  const t = await createTicket({ source: "whatsapp", subject: subject.length >= 3 ? subject : "WhatsApp message", body: text, userId: user?.id ?? null, email: user ? null : (contact?.email ?? null), phone: input.phone, quiet: true, now });
  return { id: t.id, number: t.number, created: true };
}
