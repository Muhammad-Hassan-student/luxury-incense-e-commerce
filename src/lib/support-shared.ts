/* Support desk: client-safe labels, SLA rules and helpers shared by the inbox, the account pages and the server. */
import type { SupportChannel, SupportPriority, SupportStatus } from "@/generated/prisma/enums";

export const SUPPORT_STATUSES: SupportStatus[] = ["OPEN", "PENDING", "RESOLVED"];
export const SUPPORT_PRIORITIES: SupportPriority[] = ["LOW", "NORMAL", "HIGH", "URGENT"];
export const SUPPORT_CHANNELS: SupportChannel[] = ["WEB", "EMAIL", "WHATSAPP", "CHAT"];

export const STATUS_LABEL: Record<SupportStatus, string> = { OPEN: "Open", PENDING: "Waiting on customer", RESOLVED: "Resolved" };
export const PRIORITY_LABEL: Record<SupportPriority, string> = { LOW: "Low", NORMAL: "Normal", HIGH: "High", URGENT: "Urgent" };
export const CHANNEL_LABEL: Record<SupportChannel, string> = { WEB: "Web", EMAIL: "Email", WHATSAPP: "WhatsApp", CHAT: "Chat" };

/** Hours until the first staff reply is due, by priority. */
export const SLA_HOURS: Record<SupportPriority, number> = { URGENT: 2, HIGH: 4, NORMAL: 24, LOW: 72 };

export const ticketRef = (n: number) => `#${n}`;

export const SUPPORT_TOPICS = ["order", "delivery", "return", "product", "payment", "account", "other"] as const;
export type SupportTopic = (typeof SUPPORT_TOPICS)[number];

export type SlaState = { state: "met" | "ok" | "due_soon" | "overdue" | "none"; dueAt: Date | null; minutesLeft: number | null };

/** First-response SLA: met once staff replied; otherwise ok / due soon (last 25% or 1h) / overdue. */
export function slaState(t: { status: SupportStatus; firstResponseDueAt: Date | string | null; firstRespondedAt: Date | string | null; priority: SupportPriority }, now = new Date()): SlaState {
  if (t.firstRespondedAt) return { state: "met", dueAt: t.firstResponseDueAt ? new Date(t.firstResponseDueAt) : null, minutesLeft: null };
  if (!t.firstResponseDueAt || t.status === "RESOLVED") return { state: "none", dueAt: null, minutesLeft: null };
  const due = new Date(t.firstResponseDueAt);
  const left = Math.round((due.getTime() - now.getTime()) / 60_000);
  if (left < 0) return { state: "overdue", dueAt: due, minutesLeft: left };
  const window = SLA_HOURS[t.priority] * 60;
  return { state: left <= Math.max(60, window * 0.25) ? "due_soon" : "ok", dueAt: due, minutesLeft: left };
}

export function fmtMinutes(m: number) {
  const a = Math.abs(m);
  if (a < 60) return `${a}m`;
  if (a < 48 * 60) return `${Math.round(a / 60)}h`;
  return `${Math.round(a / 1440)}d`;
}

/** Fills {{name}}, {{first_name}}, {{order}} and {{ticket}} in a canned reply. */
export function renderMacro(body: string, ctx: { name?: string | null; order?: string | null; ticket?: number | null }) {
  const first = (ctx.name ?? "").trim().split(/\s+/)[0] || "there";
  return body
    .replace(/\{\{\s*first_name\s*\}\}/g, first)
    .replace(/\{\{\s*name\s*\}\}/g, (ctx.name ?? "").trim() || first)
    .replace(/\{\{\s*order\s*\}\}/g, ctx.order ?? "your order")
    .replace(/\{\{\s*ticket\s*\}\}/g, ctx.ticket ? ticketRef(ctx.ticket) : "");
}
