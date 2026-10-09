import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { Prisma, ShipmentStatus } from "@/generated/prisma/client";
import { formatMoney } from "@/lib/money";
import { boardColumn, buildPickList, type BoardColumn, type PickItem } from "@/lib/fulfilment";
import { ShipmentUpdateEmail } from "@/emails/shipment-update";
import { db } from "../db";
import { sendEmail } from "../email";
import { notifyOrderStatus } from "../notify";
import { advanceOrder } from "../orders";
import { boxOf, clientFor, getCourier } from "./index";
import { mockScript } from "./mock";
import { renderLabels, renderManifest, type LabelData } from "./documents";
import { mapCourierStatus, orderTargetFor, shouldApply, TERMINAL_SHIPMENT } from "./status";
import { parseCourierDate } from "./shiprocket";
import { trackUrlFor } from "./track-key";
import { CourierError, type CourierRate, type TrackingScan } from "./types";

/*
 * Fulfilment operations on top of the courier client: booking shipments (+ AWB), labels, manifests, pickups,
 * cancellation, tracking ingestion (webhook + polling + Test-mode simulation) and the data behind the board.
 * Permission checks and audit live in the server actions / routes that call these.
 */

export class FulfilmentError extends Error {}

type Addr = { fullName?: string; phone?: string; line1?: string; line2?: string; city?: string; state?: string; postalCode?: string; country?: string };
export const addrOf = (v: unknown): Addr => (v && typeof v === "object" && !Array.isArray(v) ? (v as Addr) : {});
const isDigital = (meta: Prisma.JsonValue | null) => Boolean(meta && typeof meta === "object" && !Array.isArray(meta) && "giftCard" in meta && meta.giftCard);

/** Packaging allowance on top of the products (box, wrap, padding). */
const PACKAGING_GRAMS = 150;

// ─────────────────────────────── Order helpers ───────────────────────────────

const shipInclude = {
  items: true,
  payments: { select: { provider: true, status: true } },
  shipments: { where: { active: true }, orderBy: { createdAt: "desc" } },
} satisfies Prisma.OrderInclude;
type ShipOrder = Prisma.OrderGetPayload<{ include: typeof shipInclude }>;

async function weightOf(items: { variantId: string | null; quantity: number; components: string[]; meta: Prisma.JsonValue | null }[]) {
  const ids = [...new Set(items.flatMap((i) => (i.components.length ? i.components : i.variantId ? [i.variantId] : [])))];
  const variants = ids.length ? await db.productVariant.findMany({ where: { id: { in: ids } }, select: { id: true, weightGrams: true } }) : [];
  const w = new Map(variants.map((v) => [v.id, v.weightGrams]));
  let grams = 0;
  for (const i of items) {
    if (isDigital(i.meta)) continue;
    const pieces = i.components.length ? i.components : [i.variantId];
    for (const p of pieces) grams += (p ? (w.get(p) ?? 100) : 100) * i.quantity;
  }
  return grams + PACKAGING_GRAMS;
}

const isCod = (o: { payments: { provider: string }[] }) => o.payments.some((p) => p.provider === "COD");
const codDue = (o: { total: number; giftCardAmount: number; payments: { provider: string; status: string }[] }) =>
  isCod(o) && !o.payments.some((p) => p.status === "CAPTURED") ? Math.max(0, o.total - o.giftCardAmount) : 0;

/** Why an order can't be booked with the courier yet (null = it can). */
export function bookingProblem(o: { status: string; reservedUntil: Date | null; codStatus?: string | null; shippingAddress: unknown; items: { meta: Prisma.JsonValue | null }[] }) {
  if (!["PAID", "PACKED", "PENDING"].includes(o.status)) return `Orders that are ${o.status.toLowerCase()} can’t be booked.`;
  if (o.status === "PENDING" && o.reservedUntil) return "Still awaiting online payment.";
  if (o.codStatus === "AWAITING") return "Cash-on-delivery order awaiting the customer’s confirmation.";
  if (o.items.every((i) => isDigital(i.meta))) return "Gift cards are delivered by email — nothing to ship.";
  const a = addrOf(o.shippingAddress);
  if ((a.country ?? "IN") !== "IN") return "International orders ship outside Shiprocket — use “Ship order” on the order page.";
  if (!/^\d{6}$/.test(a.postalCode ?? "")) return "The shipping address needs a 6-digit pincode.";
  return null;
}

// ─────────────────────────────── Rates ───────────────────────────────

export type RateOption = CourierRate & { cheapest: boolean; fastest: boolean };

export function badgeRates(rates: CourierRate[]): RateOption[] {
  if (!rates.length) return [];
  const minRate = Math.min(...rates.map((r) => r.rate));
  const withDays = rates.filter((r) => r.etdDays != null);
  const minDays = withDays.length ? Math.min(...withDays.map((r) => r.etdDays!)) : null;
  const fastest = minDays == null ? null : withDays.filter((r) => r.etdDays === minDays).sort((a, b) => a.rate - b.rate)[0];
  const cheapest = rates.filter((r) => r.rate === minRate).sort((a, b) => (a.etdDays ?? 99) - (b.etdDays ?? 99))[0];
  return rates.map((r) => ({ ...r, cheapest: r === cheapest, fastest: r === fastest }));
}

/** Courier options for an order, cheapest first, with cheapest / fastest / recommended badges. */
export async function ratesForOrder(orderId: string) {
  const o = await db.order.findUnique({ where: { id: orderId }, include: shipInclude });
  if (!o) throw new FulfilmentError("Order not found.");
  const a = addrOf(o.shippingAddress);
  const { client } = await getCourier();
  const weightGrams = await weightOf(o.items);
  const cod = codDue(o) > 0;
  const rates = /^\d{6}$/.test(a.postalCode ?? "") && (a.country ?? "IN") === "IN" ? await client.serviceability({ deliveryPincode: a.postalCode!, weightGrams, cod, declaredValue: o.total }) : [];
  return { mode: client.mode, pincode: a.postalCode ?? "", weightGrams, cod, rates: badgeRates(rates) };
}

// ─────────────────────────────── Booking ───────────────────────────────

const ADVANCE_TO_PACKED = ["PAID", "PENDING"];

async function ensurePacked(orderId: string) {
  const o = await db.order.findUnique({ where: { id: orderId }, select: { status: true } });
  if (o && ADVANCE_TO_PACKED.includes(o.status)) await advanceOrder(orderId, "PACKED");
}

/**
 * Books the order with the courier and assigns an AWB (chosen courier, or the courier's recommendation).
 * Idempotent: an order with a live AWB returns it; a half-finished booking (created, no AWB) is resumed.
 * Labelled orders count as packed.
 */
export async function createShipmentForOrder(orderId: string, opts: { courierId?: string | null; actorId?: string | null } = {}) {
  const o: ShipOrder | null = await db.order.findUnique({ where: { id: orderId }, include: shipInclude });
  if (!o) throw new FulfilmentError("Order not found.");
  const existing = o.shipments[0];
  if (existing?.awb) return { shipment: existing, created: false };
  const problem = bookingProblem(o);
  if (problem) throw new FulfilmentError(problem);

  const { client, config } = await getCourier();
  const a = addrOf(o.shippingAddress);
  const weightGrams = await weightOf(o.items);
  const due = codDue(o);

  let shipment = existing && existing.provider === client.provider ? existing : null;
  if (existing && !shipment) await db.shipment.update({ where: { id: existing.id }, data: { active: false, status: "CANCELLED" } });
  if (!shipment) {
    const previous = await db.shipment.count({ where: { orderId } });
    try {
      shipment = await db.shipment.create({
        data: {
          orderId,
          provider: client.provider,
          reference: previous ? `${o.number}-R${previous}` : o.number,
          weightGrams,
          cod: due > 0,
          codAmount: due,
          createdById: opts.actorId ?? null,
        },
      });
    } catch (e) {
      if ((e as { code?: string }).code === "P2002") throw new FulfilmentError("This order is already being booked — refresh in a moment.");
      throw e;
    }
  }

  if (!shipment.providerShipmentId) {
    const created = await client.createShipment({
      reference: shipment.reference,
      orderDate: o.placedAt,
      to: { name: a.fullName ?? "Customer", phone: a.phone ?? "", email: o.email, line1: a.line1 ?? "", line2: a.line2, city: a.city ?? "", state: a.state ?? "", pincode: a.postalCode ?? "", country: a.country ?? "IN" },
      items: o.items.filter((i) => !isDigital(i.meta)).map((i) => ({ name: `${i.name} ${i.label}`.trim(), sku: i.sku, units: i.quantity, unitPrice: i.unitPrice })),
      cod: due > 0,
      amount: due > 0 ? due : o.total,
      shippingCharges: o.shipping,
      discount: o.discount + o.giftCardAmount,
      weightGrams,
      box: boxOf(config),
    });
    shipment = await db.shipment.update({ where: { id: shipment.id }, data: { providerOrderId: created.providerOrderId, providerShipmentId: created.providerShipmentId } });
  }

  const awb = await client.assignAwb(shipment.providerShipmentId!, opts.courierId);
  // Delivery estimate and charges for the chosen courier (best effort).
  let rate: CourierRate | undefined;
  try {
    rate = (await client.serviceability({ deliveryPincode: a.postalCode!, weightGrams, cod: due > 0, declaredValue: o.total })).find((r) => r.courierId === awb.courierId);
  } catch {
    rate = undefined;
  }
  let labelUrl: string | null = null;
  try {
    labelUrl = await client.labels([shipment.providerShipmentId!]);
  } catch (e) {
    console.error("[courier] label generation failed", e instanceof Error ? e.message : e);
  }
  const updated = await db.shipment.update({
    where: { id: shipment.id },
    data: {
      awb: awb.awb,
      courierId: awb.courierId,
      courierName: awb.courierName,
      charges: awb.charges ?? rate?.rate ?? null,
      etd: rate?.etd ?? null,
      labelUrl,
      status: "AWB_ASSIGNED",
      events: { create: { status: "AWB_ASSIGNED", rawStatus: "AWB ASSIGNED", at: new Date(), source: "system", dedupeKey: `${shipment.id}:awb:${awb.awb}` } },
    },
  });
  await ensurePacked(orderId);
  await db.order.update({
    where: { id: orderId },
    data: { trackingNumber: awb.awb, carrier: awb.courierName, events: { create: { status: "PACKED", message: `AWB ${awb.awb} with ${awb.courierName}${client.mode === "test" ? " (test mode)" : ""}` } } },
  });
  return { shipment: updated, created: true };
}

export type BulkOutcome = { orderId: string; number: string; ok: boolean; error?: string; detail?: string };

async function each(orderIds: string[], fn: (id: string) => Promise<string | undefined>): Promise<BulkOutcome[]> {
  const orders = await db.order.findMany({ where: { id: { in: orderIds } }, select: { id: true, number: true } });
  const out: BulkOutcome[] = [];
  for (const id of orderIds) {
    const number = orders.find((x) => x.id === id)?.number ?? id;
    try {
      out.push({ orderId: id, number, ok: true, detail: await fn(id) });
    } catch (e) {
      out.push({ orderId: id, number, ok: false, error: e instanceof Error ? e.message : "Failed" });
    }
  }
  return out;
}

/** Book + AWB many orders, one at a time (couriers rate-limit bursts). */
export const bulkCreateShipments = (orderIds: string[], actorId?: string | null) =>
  each(orderIds, async (id) => (await createShipmentForOrder(id, { actorId })).shipment.awb ?? undefined);

export const bulkMarkPacked = (orderIds: string[]) =>
  each(orderIds, async (id) => {
    const o = await db.order.findUnique({ where: { id }, select: { status: true, reservedUntil: true, codStatus: true } });
    if (!o) throw new FulfilmentError("Order not found.");
    if (o.status === "PACKED") return "already packed";
    if (!ADVANCE_TO_PACKED.includes(o.status)) throw new FulfilmentError(`Can’t pack an order that is ${o.status.toLowerCase()}.`);
    await advanceOrder(id, "PACKED");
  });

/** Schedules courier pickup for the orders' labelled shipments, then generates the manifest. */
export async function schedulePickups(orderIds: string[]) {
  const shipments = await db.shipment.findMany({ where: { orderId: { in: orderIds }, active: true, awb: { not: null } }, include: { order: { select: { number: true } } } });
  const outcomes: BulkOutcome[] = orderIds
    .filter((id) => !shipments.some((s) => s.orderId === id))
    .map((id) => ({ orderId: id, number: id, ok: false, error: "No AWB yet — create the shipment first." }));
  const due = shipments.filter((s) => s.status === "AWB_ASSIGNED");
  for (const s of shipments.filter((x) => x.status !== "AWB_ASSIGNED")) outcomes.push({ orderId: s.orderId, number: s.order.number, ok: true, detail: "already scheduled" });
  const byProvider = new Map<string, typeof due>();
  for (const s of due) byProvider.set(s.provider, [...(byProvider.get(s.provider) ?? []), s]);
  for (const [provider, list] of byProvider) {
    const client = await clientFor(provider);
    try {
      if (!client) throw new CourierError("Shiprocket is not connected — reconnect it in Admin → Integrations.");
      const res = await client.schedulePickup(list.map((s) => s.providerShipmentId!));
      const at = res.scheduledAt ?? new Date();
      let manifestUrl: string | null = null;
      try {
        manifestUrl = await client.manifest(
          list.map((s) => s.providerShipmentId!),
          list.map((s) => s.providerOrderId!),
        );
      } catch (e) {
        console.error("[courier] manifest failed", e instanceof Error ? e.message : e);
      }
      for (const s of list) {
        await db.shipment.update({
          where: { id: s.id },
          data: {
            status: "PICKUP_SCHEDULED",
            pickupScheduledAt: at,
            pickupToken: res.token,
            manifestUrl,
            events: { create: { status: "PICKUP_SCHEDULED", rawStatus: "PICKUP SCHEDULED", at: new Date(), source: "system", dedupeKey: `${s.id}:pickup:${at.toISOString()}` } },
          },
        });
        outcomes.push({ orderId: s.orderId, number: s.order.number, ok: true, detail: at.toISOString() });
      }
    } catch (e) {
      for (const s of list) outcomes.push({ orderId: s.orderId, number: s.order.number, ok: false, error: e instanceof Error ? e.message : "Pickup failed" });
    }
  }
  return outcomes;
}

/** Cancels the active shipment (before the courier has it). The order stays packed and can be re-booked. */
export async function cancelShipment(orderId: string, reason = "Cancelled by store") {
  const s = await db.shipment.findFirst({ where: { orderId, active: true }, orderBy: { createdAt: "desc" } });
  if (!s) throw new FulfilmentError("No active shipment to cancel.");
  if (!["CREATED", "AWB_ASSIGNED", "PICKUP_SCHEDULED"].includes(s.status)) throw new FulfilmentError("The courier already has this parcel — it can’t be cancelled now.");
  if (s.providerOrderId) {
    const client = await clientFor(s.provider);
    if (!client) throw new CourierError("Shiprocket is not connected — reconnect it in Admin → Integrations.");
    await client.cancel([s.providerOrderId]);
  }
  await db.shipment.update({
    where: { id: s.id },
    data: { active: false, status: "CANCELLED", events: { create: { status: "CANCELLED", rawStatus: "CANCELLED", at: new Date(), source: "system", dedupeKey: `${s.id}:cancel` } } },
  });
  await db.order.update({
    where: { id: orderId },
    data: { trackingNumber: null, events: { create: { status: (await db.order.findUniqueOrThrow({ where: { id: orderId }, select: { status: true } })).status, message: `Shipment ${s.awb ?? s.reference} cancelled — ${reason}` } } },
  });
  return s;
}

// ─────────────────────────────── Documents ───────────────────────────────

const docShipments = (orderIds: string[]) =>
  db.shipment.findMany({
    where: { orderId: { in: orderIds }, active: true, awb: { not: null } },
    include: { order: { select: { number: true, placedAt: true, shippingAddress: true, items: { select: { quantity: true, meta: true } } } } },
    orderBy: { createdAt: "asc" },
  });

export type DocResult = { kind: "redirect"; url: string } | { kind: "pdf"; bytes: Buffer; filename: string };

/** One merged label PDF for the orders' active shipments (courier PDF when live, rendered locally in Test mode). */
export async function labelsFor(orderIds: string[]): Promise<DocResult> {
  const list = await docShipments(orderIds);
  if (!list.length) throw new FulfilmentError("None of these orders has an AWB yet.");
  const providers = new Set(list.map((s) => s.provider));
  if (providers.size > 1) throw new FulfilmentError("Print live and test-mode labels separately.");
  const provider = list[0].provider;
  const { config } = await getCourier();
  if (provider !== "mock") {
    if (list.length === 1 && list[0].labelUrl) return { kind: "redirect", url: list[0].labelUrl };
    const client = await clientFor(provider);
    if (!client) throw new CourierError("Shiprocket is not connected — reconnect it in Admin → Integrations.");
    const url = await client.labels(list.map((s) => s.providerShipmentId!));
    if (url) return { kind: "redirect", url };
  }
  const labels: LabelData[] = list.map((s) => {
    const a = addrOf(s.order.shippingAddress);
    return {
      awb: s.awb!,
      courierName: s.courierName ?? "Courier",
      orderNumber: s.order.number,
      orderDate: s.order.placedAt,
      to: { name: a.fullName ?? "", phone: a.phone ?? "", line1: a.line1 ?? "", line2: a.line2, city: a.city ?? "", state: a.state ?? "", pincode: a.postalCode ?? "" },
      cod: s.cod,
      codAmount: s.codAmount,
      weightGrams: s.weightGrams,
      pieces: s.order.items.filter((i) => !isDigital(i.meta)).reduce((n, i) => n + i.quantity, 0),
      pickupLocation: config.pickupLocation,
      test: provider === "mock",
    };
  });
  return { kind: "pdf", bytes: renderLabels(labels), filename: `labels-${new Date().toISOString().slice(0, 10)}-${labels.length}.pdf` };
}

export async function manifestFor(orderIds: string[]): Promise<DocResult> {
  const list = await docShipments(orderIds);
  if (!list.length) throw new FulfilmentError("None of these orders has an AWB yet.");
  const live = list.filter((s) => s.provider !== "mock");
  if (live.length === list.length) {
    const urls = [...new Set(live.map((s) => s.manifestUrl).filter(Boolean))] as string[];
    if (urls.length === 1) return { kind: "redirect", url: urls[0] };
    const client = await clientFor(live[0].provider);
    if (client) {
      const url = await client.manifest(
        live.map((s) => s.providerShipmentId!),
        live.map((s) => s.providerOrderId!),
      );
      if (url) return { kind: "redirect", url };
    }
  }
  const { config } = await getCourier();
  const bytes = renderManifest(
    list.map((s) => ({ orderNumber: s.order.number, awb: s.awb!, courierName: s.courierName ?? "Courier", pincode: addrOf(s.order.shippingAddress).postalCode ?? "", cod: s.cod, codAmount: s.codAmount, weightGrams: s.weightGrams })),
    { pickupLocation: config.pickupLocation, test: list.some((s) => s.provider === "mock") },
  );
  return { kind: "pdf", bytes, filename: `manifest-${new Date().toISOString().slice(0, 10)}.pdf` };
}

/** Orders with items resolved for pick lists and packing slips (coffret pieces expanded). */
export async function packingData(orderIds: string[]) {
  const orders = await db.order.findMany({
    where: { id: { in: orderIds } },
    include: { items: { orderBy: { id: "asc" } }, shipments: { where: { active: true }, take: 1, orderBy: { createdAt: "desc" } }, payments: { select: { provider: true, status: true } } },
    orderBy: { placedAt: "asc" },
  });
  const componentIds = [...new Set(orders.flatMap((o) => o.items.flatMap((i) => i.components)))];
  const comps = componentIds.length
    ? await db.productVariant.findMany({ where: { id: { in: componentIds } }, select: { id: true, sku: true, label: true, product: { select: { name: true } } } })
    : [];
  const byId = new Map(comps.map((c) => [c.id, { sku: c.sku, name: c.product.name, label: c.label }]));
  const view = orders.map((o) => {
    const items: PickItem[] = o.items.map((i) => ({
      sku: i.sku,
      name: i.name,
      label: i.label,
      quantity: i.quantity,
      digital: isDigital(i.meta),
      components: i.components.map((c) => byId.get(c)).filter((c): c is { sku: string; name: string; label: string } => Boolean(c)),
    }));
    return {
      id: o.id,
      number: o.number,
      placedAt: o.placedAt,
      email: o.email,
      address: addrOf(o.shippingAddress),
      giftWrap: o.giftWrap,
      giftNote: o.giftNote,
      notes: o.notes,
      deliveryDate: o.deliveryDate,
      codDue: codDue(o),
      awb: o.shipments[0]?.awb ?? null,
      courierName: o.shipments[0]?.courierName ?? null,
      items,
    };
  });
  return { orders: view, pickList: buildPickList(view) };
}

// ─────────────────────────────── Tracking ingestion ───────────────────────────────

type IncomingScan = TrackingScan & { key?: string };

const scanKey = (shipmentId: string, s: IncomingScan) =>
  s.key ?? `${shipmentId}:${createHash("sha1").update(`${s.label.trim().toUpperCase()}|${Math.floor(s.at.getTime() / 60_000)}`).digest("hex").slice(0, 24)}`;

/**
 * Stores scans (deduplicated) and moves the shipment — and through it the order — forward.
 * Returns how many scans were new and the shipment status after.
 */
export async function ingestScans(shipmentId: string, scans: IncomingScan[], source: "webhook" | "poll" | "mock" | "system", extra: { lastTracking?: Prisma.InputJsonValue; etd?: Date | null; trackUrl?: string | null } = {}) {
  const shipment = await db.shipment.findUnique({ where: { id: shipmentId } });
  if (!shipment) throw new FulfilmentError("Shipment not found.");
  const sorted = [...scans].sort((a, b) => a.at.getTime() - b.at.getTime());
  const latest = await db.shipmentEvent.findFirst({ where: { shipmentId, status: { not: null } }, orderBy: { at: "desc" }, select: { at: true } });
  let lastAt = latest?.at.getTime() ?? 0;
  let status = shipment.status;
  const reached: ShipmentStatus[] = [];
  let added = 0;
  for (const s of sorted) {
    const mapped = mapCourierStatus(s.label, s.statusId);
    try {
      await db.shipmentEvent.create({
        data: { shipmentId, status: mapped, rawStatus: s.label.slice(0, 120), location: s.location?.slice(0, 160) ?? null, at: s.at, source, dedupeKey: scanKey(shipmentId, s), raw: (s.raw ?? undefined) as Prisma.InputJsonValue | undefined },
      });
    } catch (e) {
      if ((e as { code?: string }).code === "P2002") continue; // replay
      throw e;
    }
    added++;
    if (mapped && shouldApply(status, mapped, s.at.getTime() >= lastAt)) {
      status = mapped;
      lastAt = Math.max(lastAt, s.at.getTime());
      reached.push(mapped);
    }
  }
  const now = new Date();
  await db.shipment.update({
    where: { id: shipmentId },
    data: {
      status,
      lastSyncedAt: now,
      ...(extra.lastTracking !== undefined ? { lastTracking: extra.lastTracking } : {}),
      ...(extra.etd ? { etd: extra.etd } : {}),
      ...(extra.trackUrl ? { trackUrl: extra.trackUrl } : {}),
      ...(status === "DELIVERED" && !shipment.deliveredAt ? { deliveredAt: now } : {}),
      ...(["IN_TRANSIT", "OUT_FOR_DELIVERY", "FAILED_DELIVERY", "DELIVERED"].includes(status) && !shipment.shippedAt ? { shippedAt: now } : {}),
      ...(status === "CANCELLED" ? { active: false } : {}),
    },
  });
  // A catch-up batch that ends delivered shouldn't announce "out for delivery" after the fact.
  const effects = TERMINAL_SHIPMENT.includes(status) ? reached.filter((r) => r !== "OUT_FOR_DELIVERY") : reached;
  for (const r of effects) await applyToOrder(shipmentId, r);
  return { added, status, changed: status !== shipment.status };
}

/** Mirrors a shipment milestone onto the order (status, RTO flag, timeline) and tells the customer. */
async function applyToOrder(shipmentId: string, s: ShipmentStatus) {
  const sh = await db.shipment.findUniqueOrThrow({ where: { id: shipmentId }, include: { order: { include: { payments: { select: { provider: true, status: true } } } } } });
  const o = sh.order;
  if (o.status === "CANCELLED" || o.status === "REFUNDED") return;
  const target = orderTargetFor(s);
  try {
    if (target) {
      if (ADVANCE_TO_PACKED.includes(o.status)) await advanceOrder(o.id, "PACKED");
      const now = await db.order.findUniqueOrThrow({ where: { id: o.id }, select: { status: true } });
      if (now.status === "PACKED") await advanceOrder(o.id, "SHIPPED", { trackingNumber: sh.awb ?? undefined, carrier: sh.courierName ?? undefined });
      if (target === "DELIVERED") {
        const again = await db.order.findUniqueOrThrow({ where: { id: o.id }, select: { status: true } });
        if (again.status === "SHIPPED") await advanceOrder(o.id, "DELIVERED");
      }
    }
  } catch (e) {
    console.error(`[courier] could not move ${o.number} for ${s}:`, e instanceof Error ? e.message : e);
  }
  const current = (await db.order.findUniqueOrThrow({ where: { id: o.id }, select: { status: true } })).status;
  const note = (message: string) => db.orderEvent.create({ data: { orderId: o.id, status: current, message } });
  if (s === "OUT_FOR_DELIVERY") {
    const claimed = await db.shipment.updateMany({ where: { id: sh.id, ofdNotifiedAt: null }, data: { ofdNotifiedAt: new Date() } });
    if (claimed.count) {
      await note(`Out for delivery with ${sh.courierName ?? "the courier"}`);
      const due = codDue(o);
      await sendEmail({
        to: o.email,
        subject: `Order ${o.number}: out for delivery today`,
        react: ShipmentUpdateEmail({
          number: o.number,
          title: "Arriving today",
          body: "Your parcel is out for delivery. Someone will need to be there to receive it.",
          courier: sh.courierName,
          awb: sh.awb,
          trackUrl: trackUrlFor(o.number),
          codDue: due ? formatMoney(due) : null,
        }),
      }).catch((e) => console.error("[courier] OFD email failed", e instanceof Error ? e.message : e));
      await notifyOrderStatus(o.id, "out_for_delivery", { channels: ["whatsapp"] });
    }
  } else if (s === "FAILED_DELIVERY") {
    await note(`Delivery attempt failed${sh.courierName ? ` (${sh.courierName})` : ""} — the courier will retry`);
  } else if (s === "RTO") {
    await db.order.updateMany({ where: { id: o.id, rtoAt: null }, data: { rtoAt: new Date() } });
    await note("Courier is returning the parcel to us (RTO)");
  } else if (s === "RTO_DELIVERED") {
    await db.order.updateMany({ where: { id: o.id, rtoAt: null }, data: { rtoAt: new Date() } });
    await note("Parcel returned to us (RTO delivered) — inspect, then restock or refund");
  } else if (s === "LOST") {
    await note(`${sh.courierName ?? "Courier"} reports the parcel lost or damaged — raise a claim`);
  } else if (s === "CANCELLED") {
    await note(`${sh.courierName ?? "Courier"} cancelled shipment ${sh.awb ?? sh.reference}`);
  }
}

// ─────────────────────────────── Webhook ───────────────────────────────

const webhookSchema = z.looseObject({
  awb: z.union([z.string(), z.number()]).transform(String),
  current_status: z.string().nullish(),
  current_status_id: z.coerce.number().nullish(),
  shipment_status: z.string().nullish(),
  shipment_status_id: z.coerce.number().nullish(),
  current_timestamp: z.string().nullish(),
  etd: z.string().nullish(),
  scans: z
    .array(
      z.looseObject({
        date: z.string().nullish(),
        activity: z.string().nullish(),
        status: z.string().nullish(),
        location: z.string().nullish(),
        "sr-status": z.union([z.string(), z.number()]).nullish(),
        "sr-status-label": z.string().nullish(),
      }),
    )
    .nullish(),
});

/** Constant-time comparison of the `x-api-key` header with the saved token (hashing equalises lengths). */
export function webhookTokenValid(given: string | null | undefined, expected: string | null | undefined) {
  if (!expected || !given) return false;
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/**
 * Shiprocket tracking webhook. Always answers 200 for well-formed, authenticated calls (Shiprocket disables
 * webhooks that keep failing), even for AWBs we don't know. Replays are no-ops (scan dedupe keys).
 */
export async function handleCourierWebhook(body: string, apiKey: string | null, expectedToken: string): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!expectedToken) return { status: 401, body: { error: "Webhook token not configured" } };
  if (!webhookTokenValid(apiKey, expectedToken)) return { status: 401, body: { error: "Invalid token" } };
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return { status: 400, body: { error: "Invalid JSON" } };
  }
  const parsed = webhookSchema.safeParse(json);
  if (!parsed.success) return { status: 200, body: { ignored: "unrecognised payload" } };
  const p = parsed.data;
  const shipment = await db.shipment.findUnique({ where: { awb: p.awb }, select: { id: true } });
  if (!shipment) return { status: 200, body: { ignored: "unknown awb" } };

  const scans: IncomingScan[] = (p.scans ?? []).map((s) => {
    const srId = s["sr-status"] != null && s["sr-status"] !== "NA" ? Number(s["sr-status"]) : null;
    const label = s["sr-status-label"] && s["sr-status-label"] !== "NA" ? s["sr-status-label"] : (s.activity ?? s.status ?? "Update");
    return { at: parseCourierDate(s.date) ?? new Date(), label, statusId: Number.isFinite(srId) ? srId : null, location: s.location ?? null, raw: s };
  });
  const currentLabel = p.current_status ?? p.shipment_status;
  if (currentLabel) {
    scans.push({ at: parseCourierDate(p.current_timestamp) ?? new Date(), label: currentLabel, statusId: p.shipment_status_id ?? p.current_status_id ?? null, location: null, raw: { current: true } });
  }
  const { added, status } = await ingestScans(shipment.id, scans, "webhook", { lastTracking: json as Prisma.InputJsonValue, etd: parseCourierDate(p.etd) });
  return { status: 200, body: { ok: true, added, duplicate: added === 0, status } };
}

// ─────────────────────────────── Polling & Test-mode simulation ───────────────────────────────

/** Scripted mock scans for a test-mode shipment that are due by `now` and not yet stored. */
async function dueMockScans(s: { id: string; pickupScheduledAt: Date | null; orderId: string }, pincode: string, now: Date, forceNext: boolean): Promise<IncomingScan[]> {
  if (!s.pickupScheduledAt) return [];
  const script = mockScript(pincode);
  const done = await db.shipmentEvent.count({ where: { shipmentId: s.id, dedupeKey: { startsWith: `${s.id}:mock:` } } });
  const out: IncomingScan[] = [];
  for (let i = done; i < script.length; i++) {
    const [h, label, statusId, location] = script[i];
    const at = new Date(s.pickupScheduledAt.getTime() + h * 3600_000);
    if (at > now) {
      if (forceNext && !out.length) out.push({ at: now, label, statusId, location, raw: { mock: true, step: i, simulated: true }, key: `${s.id}:mock:${i}` });
      break;
    }
    out.push({ at, label, statusId, location, raw: { mock: true, step: i }, key: `${s.id}:mock:${i}` });
  }
  return out;
}

/** Test mode: play the next scripted courier scan now (for demos and training). */
export async function simulateNextScan(orderId: string) {
  const s = await db.shipment.findFirst({ where: { orderId, active: true }, include: { order: { select: { shippingAddress: true } } }, orderBy: { createdAt: "desc" } });
  if (!s) throw new FulfilmentError("No active shipment.");
  if (s.provider !== "mock") throw new FulfilmentError("Simulation is only available for test-mode shipments.");
  if (!s.pickupScheduledAt) throw new FulfilmentError("Schedule the pickup first.");
  if (TERMINAL_SHIPMENT.includes(s.status)) throw new FulfilmentError("This shipment has finished its journey.");
  const scans = await dueMockScans(s, addrOf(s.order.shippingAddress).postalCode ?? "", new Date(), true);
  if (!scans.length) throw new FulfilmentError("Nothing left to simulate.");
  const res = await ingestScans(s.id, [scans[0]], "mock");
  return { ...res, label: scans[0].label };
}

/**
 * Cron fallback for missed webhooks: polls active shipments that haven't been checked for ~50 minutes.
 * Test-mode shipments advance along their script by elapsed time.
 */
export async function syncActiveShipments(opts: { limit?: number; now?: Date; orderIds?: string[] } = {}) {
  const now = opts.now ?? new Date();
  const list = await db.shipment.findMany({
    where: {
      ...(opts.orderIds ? { orderId: { in: opts.orderIds } } : {}),
      active: true,
      awb: { not: null },
      status: { notIn: TERMINAL_SHIPMENT },
      OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lt: new Date(now.getTime() - 50 * 60_000) } }],
    },
    include: { order: { select: { shippingAddress: true } } },
    orderBy: { lastSyncedAt: { sort: "asc", nulls: "first" } },
    take: opts.limit ?? 100,
  });
  let updated = 0;
  const errors: string[] = [];
  for (const s of list) {
    try {
      const pincode = addrOf(s.order.shippingAddress).postalCode ?? "";
      if (s.provider === "mock") {
        const scans = await dueMockScans(s, pincode, now, false);
        const r = await ingestScans(s.id, scans, "poll");
        if (r.added) updated++;
        continue;
      }
      const client = await clientFor(s.provider);
      if (!client) continue;
      const t = await client.track(s.awb!, { pickupScheduledAt: s.pickupScheduledAt, pincode, now });
      const scans: IncomingScan[] = [...t.scans];
      if (!scans.length && t.current) scans.push({ at: now, label: t.current.label, statusId: t.current.statusId, location: null, raw: { current: true } });
      const r = await ingestScans(s.id, scans, "poll", { etd: t.etd, trackUrl: t.trackUrl });
      if (r.added) updated++;
    } catch (e) {
      errors.push(`${s.awb}: ${e instanceof Error ? e.message : "failed"}`);
      await db.shipment.update({ where: { id: s.id }, data: { lastSyncedAt: now } }).catch(() => {});
    }
  }
  return { checked: list.length, updated, errors: errors.slice(0, 20) };
}

/** Pull the latest tracking for one order now (drawer "Refresh"). */
export async function refreshShipment(orderId: string) {
  const s = await db.shipment.findFirst({ where: { orderId, active: true, awb: { not: null } }, include: { order: { select: { shippingAddress: true } } }, orderBy: { createdAt: "desc" } });
  if (!s) throw new FulfilmentError("No AWB to track yet.");
  const pincode = addrOf(s.order.shippingAddress).postalCode ?? "";
  if (s.provider === "mock") return ingestScans(s.id, await dueMockScans(s, pincode, new Date(), false), "poll");
  const client = await clientFor(s.provider);
  if (!client) throw new CourierError("Shiprocket is not connected — reconnect it in Admin → Integrations.");
  const t = await client.track(s.awb!, { pickupScheduledAt: s.pickupScheduledAt, pincode });
  return ingestScans(s.id, t.scans, "poll", { etd: t.etd, trackUrl: t.trackUrl });
}

// ─────────────────────────────── Board ───────────────────────────────

export type BoardCard = {
  id: string;
  number: string;
  column: BoardColumn;
  status: string;
  placedAt: string;
  since: string;
  name: string;
  addressLine: string;
  city: string;
  state: string;
  pincode: string;
  email: string;
  phone: string;
  cod: boolean;
  total: number;
  codDue: number;
  pieces: number;
  items: { name: string; label: string; sku: string; quantity: number }[];
  giftWrap: boolean;
  deliveryDate: string | null;
  riskScore: number | null;
  problem: string | null;
  shipment: {
    id: string;
    status: ShipmentStatus;
    provider: string;
    courierName: string | null;
    awb: string | null;
    etd: string | null;
    pickupScheduledAt: string | null;
    charges: number | null;
    lastEvent: { label: string; at: string; location: string | null } | null;
  } | null;
};

/** Everything the fulfilment board shows: open orders plus the last 3 days of deliveries and recent exceptions. */
export async function boardData(now = new Date()) {
  const recent = new Date(now.getTime() - 3 * 86400_000);
  const month = new Date(now.getTime() - 30 * 86400_000);
  const orders = await db.order.findMany({
    where: {
      OR: [
        { status: { in: ["PAID", "PACKED", "SHIPPED"] } },
        { status: "PENDING", reservedUntil: null },
        { status: "DELIVERED", updatedAt: { gte: recent } },
        { rtoAt: { gte: month }, status: { notIn: ["CANCELLED", "REFUNDED"] } },
      ],
    },
    orderBy: { placedAt: "asc" },
    take: 500,
    include: {
      items: { select: { name: true, label: true, sku: true, quantity: true, meta: true } },
      payments: { select: { provider: true, status: true } },
      events: { select: { status: true, message: true, createdAt: true }, orderBy: { createdAt: "asc" } },
      shipments: { where: { active: true }, orderBy: { createdAt: "desc" }, take: 1, include: { events: { orderBy: { at: "desc" }, take: 1 } } },
    },
  });
  const awaitingCod = orders.filter((o) => o.codStatus === "AWAITING").length;
  const cards: BoardCard[] = [];
  for (const o of orders) {
    if (o.codStatus === "AWAITING") continue;
    if (o.items.every((i) => isDigital(i.meta))) continue;
    const s = o.shipments[0] ?? null;
    const column = boardColumn({ status: o.status, reservedUntil: o.reservedUntil, rtoAt: o.rtoAt, shipment: s ? { status: s.status, awb: s.awb } : null });
    if (!column) continue;
    const a = addrOf(o.shippingAddress);
    const evt = (pred: (e: { status: string; message: string }) => boolean) => o.events.find(pred)?.createdAt;
    // SLA clock: from confirmation for unshipped work, from dispatch for parcels on the road.
    const confirmed = evt((e) => e.status === "PAID" || (e.status === "PENDING" && e.message.startsWith("Confirmed"))) ?? o.placedAt;
    const since =
      column === "IN_TRANSIT" ? (s?.shippedAt ?? evt((e) => e.status === "SHIPPED") ?? confirmed) : column === "DELIVERED" ? (s?.deliveredAt ?? evt((e) => e.status === "DELIVERED") ?? o.updatedAt) : column === "EXCEPTIONS" ? (o.rtoAt ?? s?.updatedAt ?? o.updatedAt) : confirmed;
    const physical = o.items.filter((i) => !isDigital(i.meta));
    cards.push({
      id: o.id,
      number: o.number,
      column,
      status: o.status,
      placedAt: o.placedAt.toISOString(),
      since: since.toISOString(),
      name: a.fullName ?? o.email,
      addressLine: [a.line1, a.line2].filter(Boolean).join(", "),
      city: a.city ?? "",
      state: a.state ?? "",
      pincode: a.postalCode ?? "",
      email: o.email,
      phone: a.phone ?? "",
      cod: isCod(o),
      total: o.total,
      codDue: codDue(o),
      pieces: physical.reduce((n, i) => n + i.quantity, 0),
      items: physical.map((i) => ({ name: i.name, label: i.label, sku: i.sku, quantity: i.quantity })),
      giftWrap: o.giftWrap,
      deliveryDate: o.deliveryDate?.toISOString() ?? null,
      riskScore: o.riskScore ?? null,
      problem: column === "TO_PACK" || column === "PACKED" ? bookingProblem(o) : null,
      shipment: s
        ? {
            id: s.id,
            status: s.status,
            provider: s.provider,
            courierName: s.courierName,
            awb: s.awb,
            etd: s.etd?.toISOString() ?? null,
            pickupScheduledAt: s.pickupScheduledAt?.toISOString() ?? null,
            charges: s.charges,
            lastEvent: s.events[0] ? { label: s.events[0].rawStatus, at: s.events[0].at.toISOString(), location: s.events[0].location } : null,
          }
        : null,
    });
  }
  return { cards, awaitingCod };
}

/** Shipment + scan history for the drawer and the customer timeline. */
export async function shipmentHistory(orderId: string) {
  return db.shipment.findMany({
    where: { orderId },
    orderBy: { createdAt: "desc" },
    include: { events: { orderBy: { at: "desc" }, select: { id: true, status: true, rawStatus: true, location: true, at: true, source: true } } },
  });
}
