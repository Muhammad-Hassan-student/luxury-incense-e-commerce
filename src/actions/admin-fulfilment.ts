"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/server/db";
import { requirePermission } from "@/server/roles";
import { audit } from "@/server/audit";
import { getCourier } from "@/server/courier";
import {
  bulkCreateShipments,
  bulkMarkPacked,
  cancelShipment,
  createShipmentForOrder,
  ratesForOrder,
  refreshShipment,
  schedulePickups,
  shipmentHistory,
  simulateNextScan,
  type BulkOutcome,
} from "@/server/courier/fulfilment";
import { SHIPMENT_STATUS_LABEL } from "@/lib/fulfilment";
import { cuid, done, fail, zodMessage } from "@/lib/admin-server";
import type { ActionResult } from "@/lib/admin-shared";

/*
 * Fulfilment board actions. Every one: permission orders.fulfil, zod input, audit log entry.
 * Courier errors are returned as messages (never credentials or tokens).
 */

const refresh = () => {
  revalidatePath("/admin/fulfilment");
  revalidatePath("/admin/orders");
  revalidatePath("/admin");
};
const errText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

const one = z.object({ orderId: cuid });
const many = z.object({ orderIds: z.array(cuid).min(1, "Select at least one order").max(200, "At most 200 orders at a time") });

export type RatesResult =
  | {
      ok: true;
      mode: "live" | "test";
      pincode: string;
      weightGrams: number;
      cod: boolean;
      rates: { courierId: string; courierName: string; rate: number; etdDays: number | null; etd: string | null; cod: boolean; rating: number | null; recommended: boolean; cheapest: boolean; fastest: boolean }[];
    }
  | { ok: false; error: string };

export async function courierRatesAction(input: z.input<typeof one>): Promise<RatesResult> {
  await requirePermission("orders.fulfil");
  const parsed = one.safeParse(input);
  if (!parsed.success) return { ok: false, error: zodMessage(parsed.error) };
  try {
    const r = await ratesForOrder(parsed.data.orderId);
    return { ok: true, mode: r.mode, pincode: r.pincode, weightGrams: r.weightGrams, cod: r.cod, rates: r.rates.map((x) => ({ ...x, etd: x.etd?.toISOString() ?? null })) };
  } catch (e) {
    return { ok: false, error: errText(e, "Could not load courier rates.") };
  }
}

const createSchema = z.object({ orderId: cuid, courierId: z.string().trim().max(40).optional() });

export async function createShipmentAction(input: z.input<typeof createSchema>): Promise<ActionResult> {
  const user = await requirePermission("orders.fulfil");
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  try {
    const { shipment, created } = await createShipmentForOrder(parsed.data.orderId, { courierId: parsed.data.courierId, actorId: user.id });
    await audit(user.id, "shipment.create", "Order", parsed.data.orderId, { awb: shipment.awb, courier: shipment.courierName, provider: shipment.provider, created });
    refresh();
    return done(created ? `AWB ${shipment.awb} · ${shipment.courierName}` : `Already booked: AWB ${shipment.awb}`);
  } catch (e) {
    await audit(user.id, "shipment.create_failed", "Order", parsed.data.orderId, { error: errText(e, "failed").slice(0, 200) });
    return fail(errText(e, "Could not create the shipment."));
  }
}

export type BulkResult = { ok: true; message: string; outcomes: BulkOutcome[] } | { ok: false; error: string };

const bulkSchema = many.extend({ action: z.enum(["pack", "ship", "pickup"]) });

export async function bulkFulfilmentAction(input: z.input<typeof bulkSchema>): Promise<BulkResult> {
  const user = await requirePermission("orders.fulfil");
  const parsed = bulkSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: zodMessage(parsed.error) };
  const { action, orderIds } = parsed.data;
  const ids = [...new Set(orderIds)];
  const outcomes = action === "pack" ? await bulkMarkPacked(ids) : action === "ship" ? await bulkCreateShipments(ids, user.id) : await schedulePickups(ids);
  const okCount = outcomes.filter((o) => o.ok).length;
  await audit(user.id, `fulfilment.bulk_${action}`, "Order", null, {
    count: ids.length,
    ok: okCount,
    failed: outcomes.filter((o) => !o.ok).map((o) => ({ number: o.number, error: o.error?.slice(0, 120) })),
  });
  refresh();
  const verb = { pack: "packed", ship: "booked with AWB", pickup: "scheduled for pickup" }[action];
  return { ok: true, message: `${okCount} of ${ids.length} ${verb}`, outcomes };
}

export async function cancelShipmentAction(input: z.input<typeof one>): Promise<ActionResult> {
  const user = await requirePermission("orders.fulfil");
  const parsed = one.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  try {
    const s = await cancelShipment(parsed.data.orderId);
    await audit(user.id, "shipment.cancel", "Order", parsed.data.orderId, { awb: s.awb, courier: s.courierName });
    refresh();
    return done("Shipment cancelled — the order is back in Packed");
  } catch (e) {
    return fail(errText(e, "Could not cancel the shipment."));
  }
}

export async function refreshTrackingAction(input: z.input<typeof one>): Promise<ActionResult> {
  const user = await requirePermission("orders.fulfil");
  const parsed = one.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  try {
    const r = await refreshShipment(parsed.data.orderId);
    await audit(user.id, "shipment.refresh", "Order", parsed.data.orderId, { added: r.added, status: r.status });
    refresh();
    return done(r.added ? `${r.added} new scan${r.added === 1 ? "" : "s"} · ${SHIPMENT_STATUS_LABEL[r.status]}` : `No news · ${SHIPMENT_STATUS_LABEL[r.status]}`);
  } catch (e) {
    return fail(errText(e, "Could not refresh tracking."));
  }
}

/** Test mode only: play the next scripted courier scan. */
export async function simulateScanAction(input: z.input<typeof one>): Promise<ActionResult> {
  const user = await requirePermission("orders.fulfil");
  const parsed = one.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  try {
    const r = await simulateNextScan(parsed.data.orderId);
    await audit(user.id, "shipment.simulate", "Order", parsed.data.orderId, { scan: r.label, status: r.status });
    refresh();
    return done(`Simulated: ${r.label.toLowerCase()}`);
  } catch (e) {
    return fail(errText(e, "Could not simulate a scan."));
  }
}

export type ShipmentDetail =
  | {
      ok: true;
      mode: "live" | "test";
      shipments: {
        id: string;
        active: boolean;
        provider: string;
        status: string;
        statusLabel: string;
        courierName: string | null;
        awb: string | null;
        reference: string;
        etd: string | null;
        charges: number | null;
        pickupScheduledAt: string | null;
        labelUrl: string | null;
        trackUrl: string | null;
        createdAt: string;
        events: { id: string; status: string | null; rawStatus: string; location: string | null; at: string; source: string }[];
      }[];
      orderEvents: { status: string; message: string; at: string }[];
    }
  | { ok: false; error: string };

export async function shipmentDetailAction(input: z.input<typeof one>): Promise<ShipmentDetail> {
  await requirePermission("orders.fulfil");
  const parsed = one.safeParse(input);
  if (!parsed.success) return { ok: false, error: zodMessage(parsed.error) };
  const [history, events, { client }] = await Promise.all([
    shipmentHistory(parsed.data.orderId),
    db.orderEvent.findMany({ where: { orderId: parsed.data.orderId }, orderBy: { createdAt: "desc" }, take: 30 }),
    getCourier(),
  ]);
  return {
    ok: true,
    mode: client.mode,
    shipments: history.map((s) => ({
      id: s.id,
      active: s.active,
      provider: s.provider,
      status: s.status,
      statusLabel: SHIPMENT_STATUS_LABEL[s.status],
      courierName: s.courierName,
      awb: s.awb,
      reference: s.reference,
      etd: s.etd?.toISOString() ?? null,
      charges: s.charges,
      pickupScheduledAt: s.pickupScheduledAt?.toISOString() ?? null,
      labelUrl: s.labelUrl,
      trackUrl: s.trackUrl,
      createdAt: s.createdAt.toISOString(),
      events: s.events.map((e) => ({ id: e.id, status: e.status, rawStatus: e.rawStatus, location: e.location, at: e.at.toISOString(), source: e.source })),
    })),
    orderEvents: events.map((e) => ({ status: e.status, message: e.message, at: e.createdAt.toISOString() })),
  };
}
