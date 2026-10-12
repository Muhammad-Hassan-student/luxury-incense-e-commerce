import "server-only";
import { db } from "../db";

/**
 * Concierge → support desk hand-off ("Talk to a person").
 *
 * The support desk (src/server/support/**) plugs in by registering a handler once at start-up, e.g. from its own
 * module that the app always loads (instrumentation `register()` or a module imported by the root layout):
 *
 *   import { registerSupportHandoff } from "@/server/ai/handoff";
 *   registerSupportHandoff(async (chat) => {
 *     const t = await createTicket({ subject: chat.subject, userId: chat.userId, email: chat.email,
 *       channel: "WEB", externalRef: chat.conversationId, messages: chat.transcript });
 *     return { ticketId: t.id, ticketNumber: t.number };
 *   });
 *
 * Until a handler is registered, the request is still recorded on the conversation (handoffRequestedAt) and is
 * listed in Admin → AI, and the shopper is shown the care team's contact details.
 * The support desk can also pull a transcript itself with `getChatTranscriptForSupport(conversationId)`.
 */

export type ChatHandoff = {
  conversationId: string;
  /** Signed-in shopper, or null for a guest (anonymised chat). */
  userId: string | null;
  /** Only for signed-in shoppers; guests give contact details to the desk themselves. */
  email: string | null;
  name: string | null;
  locale: string;
  subject: string;
  /** Shopper's note when asking for a person (PII-redacted). */
  note: string | null;
  /** PII-redacted transcript, oldest first. */
  transcript: { role: "user" | "assistant"; content: string; at: Date }[];
};

export type HandoffHandler = (chat: ChatHandoff) => Promise<{ ticketId: string; ticketNumber?: number | string }>;

const KEY = Symbol.for("maison-oud.ai.supportHandoff");
type Holder = { [KEY]?: HandoffHandler };

/** Called by the support desk. Survives dev hot reloads (stored on globalThis). */
export function registerSupportHandoff(handler: HandoffHandler | null) {
  (globalThis as Holder)[KEY] = handler ?? undefined;
}

export const supportHandoffRegistered = () => Boolean((globalThis as Holder)[KEY]);

export async function getChatTranscriptForSupport(conversationId: string) {
  const convo = await db.aiConversation.findUnique({
    where: { id: conversationId },
    include: { messages: { orderBy: { createdAt: "asc" }, select: { role: true, content: true, createdAt: true } } },
  });
  if (!convo) return null;
  return {
    conversationId: convo.id,
    userId: convo.userId,
    locale: convo.locale,
    transcript: convo.messages.map((m) => ({ role: m.role === "assistant" ? ("assistant" as const) : ("user" as const), content: m.content, at: m.createdAt })),
  };
}

/** For the support desk: remember which ticket a chat became. */
export async function markChatHandedOff(conversationId: string, ticketId: string) {
  await db.aiConversation.update({ where: { id: conversationId }, data: { supportTicketId: ticketId, handoffRequestedAt: new Date() } });
}

export type HandoffResult = { ok: true; ticketId: string | null; ticketNumber?: number | string } | { ok: false; error: string };

/** Records the request and, when the support desk is plugged in, opens a ticket with the transcript. */
export async function createSupportTicketFromChat(conversationId: string, opts: { note?: string | null } = {}): Promise<HandoffResult> {
  const chat = await getChatTranscriptForSupport(conversationId);
  if (!chat) return { ok: false, error: "Chat not found." };
  const existing = await db.aiConversation.findUnique({ where: { id: conversationId }, select: { supportTicketId: true } });
  if (existing?.supportTicketId) return { ok: true, ticketId: existing.supportTicketId };
  await db.aiConversation.update({ where: { id: conversationId }, data: { handoffRequestedAt: new Date() } });

  // The support desk registers itself on first use (no start-up hook needed, survives every runtime/bundle split).
  if (!(globalThis as Holder)[KEY]) await import("../support/chat-handoff").then((m) => m.installChatHandoff()).catch(() => {});
  const handler = (globalThis as Holder)[KEY];
  if (!handler) return { ok: true, ticketId: null };
  const user = chat.userId ? await db.user.findUnique({ where: { id: chat.userId }, select: { email: true, name: true } }) : null;
  const firstQuestion = chat.transcript.find((m) => m.role === "user")?.content ?? "Concierge chat";
  try {
    const t = await handler({
      ...chat,
      email: user?.email ?? null,
      name: user?.name ?? null,
      note: opts.note ?? null,
      subject: `Concierge chat: ${firstQuestion.slice(0, 80)}`,
    });
    await markChatHandedOff(conversationId, t.ticketId);
    return { ok: true, ticketId: t.ticketId, ticketNumber: t.ticketNumber };
  } catch (e) {
    console.error("[ai] support handoff failed", e instanceof Error ? e.message : e);
    return { ok: true, ticketId: null };
  }
}
