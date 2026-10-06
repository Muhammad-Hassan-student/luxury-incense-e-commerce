/**
 * Client-safe helpers shared by admin pages, components and server actions.
 * No server-only imports here.
 */
import type { OrderStatus, Role } from "@/generated/prisma/enums";

export type ActionResult = { ok: true; message?: string; id?: string } | { ok: false; error: string };

export const ROLE_RANK: Record<Role, number> = { CUSTOMER: 0, SUPPORT: 1, MANAGER: 2, OWNER: 3 };
export const can = (role: Role, min: Role) => ROLE_RANK[role] >= ROLE_RANK[min];

export const ORDER_STATUSES: OrderStatus[] = ["PENDING", "PAID", "PACKED", "SHIPPED", "DELIVERED", "CANCELLED", "REFUNDED"];

export function statusTone(status: OrderStatus): "gold" | "ember" | "muted" {
  if (status === "CANCELLED" || status === "REFUNDED") return "ember";
  if (status === "DELIVERED") return "muted";
  return "gold";
}

/** A COD order sits in PENDING once confirmed (no reservation hold); show it as such. */
export function statusLabel(status: OrderStatus, reservedUntil: Date | null) {
  if (status === "PENDING") return reservedUntil ? "Awaiting payment" : "COD confirmed";
  return status.charAt(0) + status.slice(1).toLowerCase();
}

const dateFmt = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" });
const dateTimeFmt = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

export const fmtDate = (d: Date | string | null | undefined) => (d ? dateFmt.format(new Date(d)) : "—");
export const fmtDateTime = (d: Date | string | null | undefined) => (d ? dateTimeFmt.format(new Date(d)) : "—");

/** "a, b ,c" → ["a","b","c"] */
export const splitList = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

/** Major units (e.g. rupees, possibly decimal) → integer minor units. */
export const toMinor = (major: number) => Math.round(major * 100);
export const toMajor = (minor: number) => minor / 100;

/** Value for <input type="datetime-local"> in local time. */
export function toLocalInput(d: Date | null | undefined) {
  if (!d) return "";
  const x = new Date(d);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}T${pad(x.getHours())}:${pad(x.getMinutes())}`;
}
