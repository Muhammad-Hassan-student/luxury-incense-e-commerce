"use client";

import Link from "next/link";
import { use, useState } from "react";
import { Ban, ExternalLink, FlaskConical, Printer, RefreshCw, Truck, X, Zap } from "lucide-react";
import {
  bulkFulfilmentAction,
  cancelShipmentAction,
  createShipmentAction,
  refreshTrackingAction,
  simulateScanAction,
  type RatesResult,
  type ShipmentDetail,
} from "@/actions/admin-fulfilment";
import type { BoardCard } from "@/server/courier/fulfilment";
import { SHIPMENT_STATUS_LABEL } from "@/lib/fulfilment";
import { formatMoney } from "@/lib/money";
import { fmtDateTime, statusLabel } from "@/lib/admin-shared";
import type { OrderStatus } from "@/generated/prisma/enums";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/field";
import { useAdminAction } from "../use-admin-action";

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" }) : "—");

export function DrawerShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={`Order ${title}`}>
      <button type="button" aria-label="Close" className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" onClick={onClose} />
      <div className="absolute inset-y-0 right-0 flex w-full max-w-[30rem] flex-col border-l border-line-strong bg-bg-elev shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
          <p className="font-mono text-lg text-fg">{title}</p>
          <button type="button" onClick={onClose} className="p-1 text-muted hover:text-fg" aria-label="Close drawer">
            <X className="size-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

export function DrawerSkeleton() {
  return (
    <div className="space-y-4 p-5">
      <Skeleton className="h-5 w-2/3" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}

export function FulfilmentDrawer({
  card,
  mode,
  detail,
  rates,
  onClose,
  onChanged,
}: {
  card: BoardCard;
  mode: "live" | "test";
  detail: Promise<ShipmentDetail>;
  rates: Promise<RatesResult> | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const d = use(detail);
  const { pending, run } = useAdminAction();
  const active = d.ok ? d.shipments.find((s) => s.active) : undefined;
  const s = card.shipment;
  const awb = active?.awb ?? s?.awb ?? null;
  const after = { onSuccess: onChanged };

  return (
    <DrawerShell title={card.number} onClose={onClose}>
      <div className="divide-y divide-line">
        {/* Who and what */}
        <section className="space-y-3 px-5 py-4">
          <div className="flex flex-wrap items-center gap-2 text-[0.625rem] uppercase tracking-[0.18em]">
            <span className="border border-line-strong px-2 py-0.5 text-muted">{statusLabel(card.status as OrderStatus, null)}</span>
            <span className={cn("border px-2 py-0.5", card.cod ? "border-gold/40 text-gold" : "border-line-strong text-muted")}>
              {card.cod ? (card.codDue ? `COD ${formatMoney(card.codDue)}` : "COD paid") : "Prepaid"}
            </span>
            {card.giftWrap ? <span className="border border-line-strong px-2 py-0.5 text-muted">Gift wrap</span> : null}
            {card.riskScore != null && card.riskScore >= 60 ? <span className="border border-ember/50 px-2 py-0.5 text-ember">RTO risk {card.riskScore}</span> : null}
          </div>
          <div className="text-sm leading-relaxed">
            <p className="text-fg">{card.name}</p>
            <p className="text-muted">{card.addressLine}</p>
            <p className="text-muted">
              {card.city}, {card.state} <span className="font-mono text-fg">{card.pincode}</span>
            </p>
            <p className="text-subtle">
              {card.phone} · {card.email}
            </p>
          </div>
          <ul className="space-y-1 border-t border-line pt-3 text-sm">
            {card.items.map((i) => (
              <li key={i.sku + i.label} className="flex justify-between gap-3">
                <span className="min-w-0 truncate text-fg">
                  {i.name} <span className="text-subtle">{i.label}</span>
                </span>
                <span className="shrink-0 font-mono text-xs text-muted">
                  {i.sku} ×{i.quantity}
                </span>
              </li>
            ))}
          </ul>
          {card.problem ? <p className="text-xs text-ember">{card.problem}</p> : null}
          <Link href={`/admin/orders/${card.id}`} className="inline-flex items-center gap-1.5 text-[0.625rem] uppercase tracking-[0.2em] text-muted hover:text-gold">
            Full order <ExternalLink className="size-3" aria-hidden />
          </Link>
        </section>

        {/* Courier */}
        <section className="space-y-4 px-5 py-4">
          <div className="flex items-center justify-between">
            <h3 className="eyebrow">Courier</h3>
            {mode === "test" ? (
              <span className="inline-flex items-center gap-1.5 text-[0.625rem] uppercase tracking-[0.18em] text-gold">
                <FlaskConical className="size-3" aria-hidden /> Test mode
              </span>
            ) : null}
          </div>

          {awb && active ? (
            <div className="space-y-3">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <Dt label="AWB">
                  <span className="font-mono">{awb}</span>
                </Dt>
                <Dt label="Courier">{active.courierName}</Dt>
                <Dt label="Status">{active.statusLabel}</Dt>
                <Dt label="Expected">{day(active.etd)}</Dt>
                {active.charges != null ? <Dt label="Freight">{formatMoney(active.charges)}</Dt> : null}
                {active.pickupScheduledAt ? <Dt label="Pickup">{fmtDateTime(active.pickupScheduledAt)}</Dt> : null}
              </dl>
              <div className="flex flex-wrap gap-2">
                <Button asChild size="sm" variant="outline">
                  <a href={`/api/admin/fulfilment/documents?doc=labels&orders=${card.id}`} target="_blank" rel="noopener">
                    <Printer className="size-3.5" aria-hidden /> Label
                  </a>
                </Button>
                {active.status === "AWB_ASSIGNED" ? (
                  <Button size="sm" disabled={pending} onClick={() => run(async () => {
                    const r = await bulkFulfilmentAction({ action: "pickup", orderIds: [card.id] });
                    if (!r.ok) return r;
                    const bad = r.outcomes.find((o) => !o.ok);
                    return bad ? { ok: false as const, error: bad.error ?? "Pickup failed" } : { ok: true as const, message: "Pickup scheduled" };
                  }, after)}>
                    <Truck className="size-3.5" aria-hidden /> Schedule pickup
                  </Button>
                ) : null}
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => refreshTrackingAction({ orderId: card.id }), after)}>
                  <RefreshCw className="size-3.5" aria-hidden /> Refresh
                </Button>
                {active.provider === "mock" && active.pickupScheduledAt && !["DELIVERED", "RTO_DELIVERED", "CANCELLED", "LOST"].includes(active.status) ? (
                  <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => simulateScanAction({ orderId: card.id }), after)}>
                    <Zap className="size-3.5" aria-hidden /> Simulate next scan
                  </Button>
                ) : null}
                {["CREATED", "AWB_ASSIGNED", "PICKUP_SCHEDULED"].includes(active.status) ? (
                  <CancelShipment disabled={pending} onConfirm={() => run(() => cancelShipmentAction({ orderId: card.id }), after)} />
                ) : null}
              </div>
              {active.trackUrl ? (
                <a href={active.trackUrl} target="_blank" rel="noopener" className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-gold">
                  Courier tracking page <ExternalLink className="size-3" aria-hidden />
                </a>
              ) : null}
            </div>
          ) : rates ? (
            <RateChooser rates={rates} pending={pending} onBook={(courierId) => run(() => createShipmentAction({ orderId: card.id, courierId }), after)} />
          ) : (
            <p className="text-sm text-muted">{card.problem ?? "Nothing to book for this order."}</p>
          )}
        </section>

        {/* Timeline */}
        <section className="px-5 py-4">
          <h3 className="eyebrow mb-3">Tracking</h3>
          {!d.ok ? (
            <p className="text-sm text-ember">{d.error}</p>
          ) : (
            <Timeline shipments={d.shipments} orderEvents={d.orderEvents} />
          )}
        </section>
      </div>
    </DrawerShell>
  );
}

function Dt({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[0.625rem] uppercase tracking-[0.18em] text-subtle">{label}</dt>
      <dd className="text-fg">{children}</dd>
    </div>
  );
}

function CancelShipment({ disabled, onConfirm }: { disabled: boolean; onConfirm: () => void }) {
  const [ask, setAsk] = useState(false);
  if (!ask)
    return (
      <Button size="sm" variant="ghost" className="text-ember hover:text-ember" disabled={disabled} onClick={() => setAsk(true)}>
        <Ban className="size-3.5" aria-hidden /> Cancel AWB
      </Button>
    );
  return (
    <span className="inline-flex items-center gap-2 border border-ember/40 px-2 py-1 text-xs text-muted">
      Cancel with courier?
      <button type="button" className="text-ember underline underline-offset-2" disabled={disabled} onClick={onConfirm}>
        Yes
      </button>
      <button type="button" className="underline underline-offset-2" onClick={() => setAsk(false)}>
        No
      </button>
    </span>
  );
}

function RateChooser({ rates, pending, onBook }: { rates: Promise<RatesResult>; pending: boolean; onBook: (courierId?: string) => void }) {
  const r = use(rates);
  const [choice, setChoice] = useState<string | null>(null);
  if (!r.ok) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-ember">{r.error}</p>
        <Button size="sm" disabled={pending} onClick={() => onBook(undefined)}>
          Book recommended courier
        </Button>
      </div>
    );
  }
  if (!r.rates.length) return <p className="text-sm text-ember">No courier serves pincode {r.pincode} for this parcel{r.cod ? " with cash on delivery" : ""}.</p>;
  const picked = choice ?? r.rates.find((x) => x.recommended)?.courierId ?? r.rates[0].courierId;
  const chosen = r.rates.find((x) => x.courierId === picked)!;
  return (
    <div className="space-y-3">
      <p className="text-xs text-subtle">
        {(r.weightGrams / 1000).toFixed(2)} kg to {r.pincode}
        {r.cod ? " · cash on delivery" : " · prepaid"}
      </p>
      <ul className="divide-y divide-line border border-line" role="radiogroup" aria-label="Courier">
        {r.rates.map((x) => (
          <li key={x.courierId}>
            <label className={cn("flex cursor-pointer items-center gap-3 px-3 py-2.5 transition-colors", picked === x.courierId ? "bg-bg-soft" : "hover:bg-bg-soft/50")}>
              <input type="radio" name="courier" checked={picked === x.courierId} onChange={() => setChoice(x.courierId)} className="accent-[var(--gold)]" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-fg">{x.courierName}</span>
                <span className="flex flex-wrap items-center gap-1.5 text-[0.6875rem] text-muted">
                  {x.etdDays != null ? `${x.etdDays} day${x.etdDays === 1 ? "" : "s"}` : "ETA n/a"}
                  {x.etd ? ` · by ${day(x.etd)}` : ""}
                  {x.rating != null ? ` · ★ ${x.rating.toFixed(1)}` : ""}
                </span>
                <span className="mt-1 flex flex-wrap gap-1">
                  {x.cheapest ? <Tag tone="gold">Cheapest</Tag> : null}
                  {x.fastest ? <Tag tone="gold">Fastest</Tag> : null}
                  {x.recommended ? <Tag tone="muted">Recommended</Tag> : null}
                </span>
              </span>
              <span className="shrink-0 text-sm tabular-nums text-fg">{formatMoney(x.rate)}</span>
            </label>
          </li>
        ))}
      </ul>
      <Button size="sm" className="w-full" disabled={pending} onClick={() => onBook(chosen.courierId)}>
        {pending ? "Booking…" : `Book ${chosen.courierName} · ${formatMoney(chosen.rate)}`}
      </Button>
    </div>
  );
}

function Tag({ tone, children }: { tone: "gold" | "muted"; children: React.ReactNode }) {
  return <span className={cn("border px-1.5 py-px text-[0.5625rem] uppercase tracking-[0.14em]", tone === "gold" ? "border-gold/40 text-gold" : "border-line-strong text-muted")}>{children}</span>;
}

function Timeline({ shipments, orderEvents }: { shipments: Extract<ShipmentDetail, { ok: true }>["shipments"]; orderEvents: Extract<ShipmentDetail, { ok: true }>["orderEvents"] }) {
  const rows = [
    ...shipments.flatMap((s) =>
      s.events.map((e) => ({
        key: e.id,
        at: e.at,
        title: e.status ? SHIPMENT_STATUS_LABEL[e.status as keyof typeof SHIPMENT_STATUS_LABEL] : e.rawStatus.toLowerCase(),
        sub: [e.rawStatus !== (e.status ?? "") ? e.rawStatus.toLowerCase() : null, e.location, s.awb ? `AWB ${s.awb}` : null, e.source === "mock" ? "simulated" : null].filter(Boolean).join(" · "),
        exception: ["FAILED_DELIVERY", "RTO", "RTO_DELIVERED", "LOST"].includes(e.status ?? ""),
        courier: true,
      })),
    ),
    ...orderEvents.map((e, i) => ({ key: `o${i}`, at: e.at, title: e.message, sub: e.status.toLowerCase(), exception: false, courier: false })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  if (!rows.length) return <p className="text-sm text-muted">No events yet.</p>;
  return (
    <ol>
      {rows.map((r) => (
        <li key={r.key} className="relative border-l border-line py-2.5 pl-5">
          <span className={cn("absolute -left-[3.5px] top-[1.05rem] size-1.5", r.exception ? "bg-ember" : r.courier ? "bg-gold" : "bg-line-strong")} aria-hidden />
          <p className={cn("text-sm", r.exception ? "text-ember" : "text-fg")}>{r.title}</p>
          <p className="text-[0.6875rem] text-subtle">
            {fmtDateTime(r.at)}
            {r.sub ? ` · ${r.sub}` : ""}
          </p>
        </li>
      ))}
    </ol>
  );
}
