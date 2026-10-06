import "server-only";
import { z } from "zod";
import type { ActionResult } from "./admin-shared";

/** First human-readable message from a zod error. */
export function zodMessage(err: z.ZodError) {
  const flat = z.flattenError(err);
  const field = Object.entries(flat.fieldErrors).find(([, v]) => Array.isArray(v) && v.length) as [string, string[]] | undefined;
  if (field) return `${field[0]}: ${field[1][0]}`;
  return flat.formErrors[0] ?? "Invalid input.";
}

export const fail = (error: string): ActionResult => ({ ok: false, error });
export const done = (message?: string, id?: string): ActionResult => ({ ok: true, message, id });

/** Prisma unique-constraint violation (P2002). */
export function isUniqueViolation(e: unknown) {
  return typeof e === "object" && e !== null && "code" in e && (e as { code: unknown }).code === "P2002";
}

export const cuid = z.string().min(1).max(64);
