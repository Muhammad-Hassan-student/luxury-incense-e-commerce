"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { OrderStatus } from "@/generated/prisma/enums";
import { db } from "@/server/db";
import { hasRole, requireRole } from "@/server/roles";
import { audit } from "@/server/audit";
import { advanceOrder, nextStatuses, refundOrder } from "@/server/orders";
import { cuid, done, fail, zodMessage } from "@/lib/admin-server";
import type { ActionResult } from "@/lib/admin-shared";

function revalidateOrder(id: string) {
  revalidatePath("/admin");
  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${id}`);
  revalidatePath("/admin/inventory");
}

const advanceSchema = z
  .object({
    orderId: cuid,
    to: z.enum(OrderStatus),
    trackingNumber: z.string().trim().max(100).optional(),
    carrier: z.string().trim().max(100).optional(),
  })
  .refine((v) => v.to !== "SHIPPED" || (v.trackingNumber && v.carrier), {
    message: "Tracking number and carrier are required to ship.",
    path: ["trackingNumber"],
  });

export async function advanceOrderAction(input: z.input<typeof advanceSchema>): Promise<ActionResult> {
  const user = await requireRole("SUPPORT");
  const parsed = advanceSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  const { orderId, to, trackingNumber, carrier } = parsed.data;

  const order = await db.order.findUnique({ where: { id: orderId }, select: { status: true, number: true } });
  if (!order) return fail("Order not found.");
  if (!nextStatuses(order.status).includes(to)) return fail(`Cannot move ${order.status} to ${to}.`);
  // Cancelling a paid order moves money/stock: keep it to managers.
  if (to === "CANCELLED" && order.status !== "PENDING" && !hasRole(user.role, "MANAGER")) {
    return fail("Only managers can cancel a paid order.");
  }

  try {
    await advanceOrder(orderId, to, to === "SHIPPED" ? { trackingNumber, carrier } : {});
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Could not update the order.");
  }
  await audit(user.id, `order.${to.toLowerCase()}`, "Order", orderId, { from: order.status, to, number: order.number, trackingNumber, carrier });
  revalidateOrder(orderId);
  return done(`${order.number} marked ${to.toLowerCase()}`);
}

const refundSchema = z.object({ orderId: cuid, reason: z.string().trim().min(3, "Give a reason").max(500) });

export async function refundOrderAction(input: z.input<typeof refundSchema>): Promise<ActionResult> {
  const user = await requireRole("MANAGER");
  const parsed = refundSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  const order = await db.order.findUnique({ where: { id: parsed.data.orderId }, select: { status: true, number: true, total: true } });
  if (!order) return fail("Order not found.");
  if (order.status === "REFUNDED") return fail("This order is already refunded.");
  if (order.status === "PENDING") return fail("Unpaid orders should be cancelled, not refunded.");

  try {
    await refundOrder(parsed.data.orderId, parsed.data.reason);
  } catch (e) {
    return fail(e instanceof Error ? `Refund failed: ${e.message}` : "Refund failed.");
  }
  await audit(user.id, "order.refund", "Order", parsed.data.orderId, { number: order.number, total: order.total, reason: parsed.data.reason });
  revalidateOrder(parsed.data.orderId);
  return done(`${order.number} refunded`);
}

const notesSchema = z.object({ orderId: cuid, notes: z.string().max(5000) });

export async function updateOrderNotes(input: z.input<typeof notesSchema>): Promise<ActionResult> {
  const user = await requireRole("SUPPORT");
  const parsed = notesSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  const updated = await db.order.updateMany({ where: { id: parsed.data.orderId }, data: { notes: parsed.data.notes.trim() || null } });
  if (!updated.count) return fail("Order not found.");
  await audit(user.id, "order.notes", "Order", parsed.data.orderId);
  revalidatePath(`/admin/orders/${parsed.data.orderId}`);
  return done("Notes saved");
}
