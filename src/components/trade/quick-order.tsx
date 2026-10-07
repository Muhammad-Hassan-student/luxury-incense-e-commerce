"use client";

import { useMemo, useRef, useState, useTransition, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Minus, Plus, Search, X } from "lucide-react";
import type { TradeTerms } from "@/generated/prisma/enums";
import type { CatalogueRow } from "@/server/trade";
import { placeTradeOrderAction } from "@/actions/trade";
import { brand } from "@/config/brand";
import { price } from "@/lib/pricing";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { TradeThumb } from "./trade-thumb";
import { TradeCheckoutFields, chosenRate, type TradeAddressValue, type TradeCheckoutValue } from "./checkout-fields";
import { TERMS_DAYS, TERMS_LABEL, quantityProblem, roundUpQty, type ShippingRateLike } from "./trade-rules";

type Props = {
  rows: CatalogueRow[];
  minimum: number;
  terms: TradeTerms;
  creditAvailable: number | null;
  rates: ShippingRateLike[];
  tax: { ratePercent: number; inclusive: boolean };
  pointValue: number;
  defaultAddress: TradeAddressValue;
  initialQty: Record<string, number>;
  reorderFrom: string | null;
};

const COLS = "md:grid-cols-[minmax(0,1.5fr)_5.5rem_5.5rem_4.5rem_4rem_9.5rem_6.5rem]";

export function QuickOrder(props: Props) {
  const { rows, minimum, terms, creditAvailable, rates, tax } = props;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [qty, setQty] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(props.initialQty).map(([k, v]) => [k, String(v)])));
  const [filter, setFilter] = useState("");
  const [orderedOnly, setOrderedOnly] = useState(false);
  const [step, setStep] = useState<"build" | "review">("build");
  const [checkout, setCheckout] = useState<TradeCheckoutValue>({ poNumber: "", shippingRateId: "", address: props.defaultAddress });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const parsed = useMemo(() => {
    const out = new Map<string, { qty: number; problem: string | null }>();
    for (const r of rows) {
      const raw = (qty[r.variantId] ?? "").trim();
      if (!raw) continue;
      const n = Number(raw);
      let problem = quantityProblem(n, r.caseSize, r.minQty);
      if (!problem && n > r.available) problem = r.available ? `Only ${r.available} available` : "Out of stock";
      if (n !== 0 || problem) out.set(r.variantId, { qty: Number.isFinite(n) ? n : 0, problem });
    }
    return out;
  }, [qty, rows]);

  const lines = rows.filter((r) => (parsed.get(r.variantId)?.qty ?? 0) > 0).map((r) => ({ row: r, quantity: parsed.get(r.variantId)!.qty }));
  const problems = [...parsed.values()].filter((p) => p.problem).length;
  const units = lines.reduce((s, l) => s + l.quantity, 0);
  const { options, rate } = chosenRate(rates, checkout);
  const pricing = price({
    lines: lines.map((l) => ({ unitPrice: l.row.trade, quantity: l.quantity })),
    shipping: rate,
    pointValue: props.pointValue,
    taxRatePercent: tax.ratePercent,
    taxInclusive: tax.inclusive,
  });
  const retailValue = lines.reduce((s, l) => s + l.row.retail * l.quantity, 0);
  const shortfall = Math.max(0, minimum - pricing.subtotal);
  const overCredit = creditAvailable !== null && lines.length > 0 && pricing.total > creditAvailable;
  const ready = lines.length > 0 && problems === 0 && shortfall === 0 && !overCredit;

  const q = filter.trim().toLowerCase();
  const visible = rows.filter(
    (r) => (!q || `${r.productName} ${r.label} ${r.sku} ${r.category}`.toLowerCase().includes(q)) && (!orderedOnly || (qty[r.variantId] ?? "").trim() !== ""),
  );
  const groups: CatalogueRow[][] = [];
  for (const r of visible) {
    const last = groups.at(-1);
    if (last && last[0].productId === r.productId) last.push(r);
    else groups.push([r]);
  }
  let index = 0;

  function setRowQty(id: string, v: string) {
    setQty((p) => {
      const next = { ...p };
      if (v === "" || v === "0") delete next[id];
      else next[id] = v;
      return next;
    });
  }

  function stepQty(r: CatalogueRow, dir: 1 | -1) {
    const cur = parsed.get(r.variantId)?.qty ?? 0;
    let n: number;
    if (dir === 1) n = cur < r.minQty ? roundUpQty(r.minQty, r.caseSize, r.minQty) : roundUpQty(cur + 1, r.caseSize, r.minQty);
    else {
      const down = Math.floor((cur - 1) / r.caseSize) * r.caseSize;
      n = down < r.minQty ? 0 : down;
    }
    setRowQty(r.variantId, n > 0 ? String(n) : "");
  }

  function focusRow(i: number) {
    const el = gridRef.current?.querySelector<HTMLInputElement>(`[data-qty-index="${i}"]`);
    if (el) {
      el.focus();
      el.select();
    }
  }

  function onQtyKey(e: KeyboardEvent<HTMLInputElement>, i: number) {
    if (e.key === "Enter") {
      e.preventDefault();
      focusRow(e.shiftKey ? i - 1 : i + 1);
    }
  }

  function place() {
    setFormError(null);
    setErrors({});
    if (!rate) {
      setErrors({ shippingRateId: "Choose a shipping method." });
      return;
    }
    start(async () => {
      const res = await placeTradeOrderAction({
        lines: lines.map((l) => ({ variantId: l.row.variantId, quantity: l.quantity })),
        poNumber: checkout.poNumber,
        address: checkout.address,
        shippingRateId: rate.id,
      });
      if (res.ok) {
        toast(res.proforma ? `Order ${res.number} placed — proforma invoice sent` : `Order ${res.number} placed — invoice sent`);
        router.push(`/trade/portal/orders/${res.number}`);
        router.refresh();
      } else {
        setErrors(res.fieldErrors ?? {});
        setFormError(res.error);
      }
    });
  }

  const summary = (
    <Summary
      lines={lines.length}
      units={units}
      subtotal={pricing.subtotal}
      retailValue={retailValue}
      shipping={rate ? pricing.shipping : null}
      tax={pricing.tax}
      taxInclusive={tax.inclusive}
      taxRate={tax.ratePercent}
      total={pricing.total}
      minimum={minimum}
      shortfall={shortfall}
      problems={problems}
      terms={terms}
      creditAvailable={creditAvailable}
      overCredit={overCredit}
    />
  );

  return (
    <div className="grid gap-12 pb-28 lg:grid-cols-[minmax(0,1fr)_22rem] lg:pb-0">
      <div className="min-w-0">
        {step === "build" ? (
          <>
            {props.reorderFrom ? (
              <p role="status" className="mb-8 border border-gold/40 p-4 text-sm text-muted">
                Quantities loaded from <span className="text-fg">{props.reorderFrom}</span>, rounded up to today’s case packs and minimums. Adjust anything before you continue.
              </p>
            ) : null}
            <div className="mb-6 flex flex-wrap items-center gap-6">
              <label className="relative min-w-[14rem] flex-1">
                <span className="sr-only">Filter products</span>
                <Search className="pointer-events-none absolute left-0 top-1/2 size-3.5 -translate-y-1/2 text-subtle" aria-hidden />
                <input
                  type="search"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Filter by name or SKU"
                  className="w-full border-0 border-b border-line-strong bg-transparent py-3 pl-6 text-sm text-fg placeholder:text-subtle focus:border-gold focus:outline-none"
                />
              </label>
              <label className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-muted">
                <input type="checkbox" checked={orderedOnly} onChange={(e) => setOrderedOnly(e.target.checked)} className="size-4 accent-[var(--gold)]" />
                Ordered only
              </label>
              {lines.length || parsed.size ? (
                <button type="button" onClick={() => setQty({})} className="link-draw text-xs uppercase tracking-[0.2em] text-muted hover:text-fg">
                  Clear all
                </button>
              ) : null}
            </div>
            <p className="mb-4 text-xs text-subtle">
              Type quantities and press <kbd className="border border-line px-1">Enter</kbd> to jump to the next line (<kbd className="border border-line px-1">Shift</kbd>+<kbd className="border border-line px-1">Enter</kbd> goes back). Arrow keys step by the case.
            </p>

            <div ref={gridRef} role="table" aria-label="Quick order" className="border-t border-line text-sm">
              <div role="row" className={cn("hidden gap-4 border-b border-line py-3 text-[0.5625rem] uppercase tracking-[0.2em] text-subtle md:grid", COLS)}>
                <span role="columnheader">Item</span>
                <span role="columnheader" className="text-right">Retail</span>
                <span role="columnheader" className="text-right">Trade</span>
                <span role="columnheader" className="text-right">Case · min</span>
                <span role="columnheader" className="text-right">Avail.</span>
                <span role="columnheader" className="text-center">Quantity</span>
                <span role="columnheader" className="text-right">Line</span>
              </div>
              {groups.map((g) => (
                <div key={g[0].productId} role="rowgroup" className="border-b border-line">
                  <div className="flex items-center gap-4 pt-5">
                    <TradeThumb media={g[0].media} model={g[0].model} palette={g[0].palette} sizes="56px" className="h-14 w-11 shrink-0" />
                    <div className="min-w-0">
                      <p className="font-display text-xl leading-tight">{g[0].productName}</p>
                      <p className="text-[0.625rem] uppercase tracking-[0.2em] text-subtle">{g[0].category}</p>
                    </div>
                  </div>
                  {g.map((r) => {
                    const i = index++;
                    const state = parsed.get(r.variantId);
                    const errId = `qty-err-${r.variantId}`;
                    const lineTotal = (state?.qty ?? 0) * r.trade;
                    return (
                      <div
                        key={r.variantId}
                        id={`v-${r.variantId}`}
                        role="row"
                        className={cn("grid scroll-mt-32 grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2 py-3 md:gap-4", COLS, state && !state.problem && state.qty > 0 && "text-fg")}
                      >
                        <div role="cell" className="min-w-0 pl-0 md:pl-[3.75rem]">
                          <p className="truncate">{r.label}</p>
                          <p className="truncate font-mono text-[0.625rem] text-subtle">{r.sku}</p>
                          <p className="mt-1 text-xs text-muted md:hidden">
                            <span className="text-gold">{formatMoney(r.trade)}</span> <s className="text-subtle">{formatMoney(r.retail)}</s> · case {r.caseSize} · min {r.minQty} · {r.available ? `${r.available} avail.` : "out of stock"}
                          </p>
                        </div>
                        <span role="cell" className="hidden text-right tabular-nums text-subtle line-through decoration-line-strong md:block">
                          {formatMoney(r.retail)}
                        </span>
                        <span role="cell" className="hidden text-right tabular-nums text-gold md:block">
                          {formatMoney(r.trade)}
                          {r.override ? <span className="sr-only"> special price</span> : null}
                        </span>
                        <span role="cell" className="hidden text-right tabular-nums text-muted md:block">
                          {r.caseSize} · {r.minQty}
                        </span>
                        <span role="cell" className={cn("hidden text-right tabular-nums md:block", r.available ? "text-muted" : "text-ember")}>
                          {r.available || "Out"}
                        </span>
                        <div role="cell" className="row-span-2 md:row-span-1">
                          <div className={cn("flex items-center border", state?.problem ? "border-ember/60" : state?.qty ? "border-gold/60" : "border-line-strong")}>
                            <button
                              type="button"
                              tabIndex={-1}
                              onClick={() => stepQty(r, -1)}
                              disabled={!state?.qty}
                              aria-label={`One case fewer of ${r.productName} ${r.label}`}
                              className="flex size-9 items-center justify-center text-muted hover:text-gold disabled:opacity-30"
                            >
                              <Minus className="size-3" aria-hidden />
                            </button>
                            <input
                              type="number"
                              inputMode="numeric"
                              min={0}
                              step={r.caseSize}
                              max={r.available || undefined}
                              value={qty[r.variantId] ?? ""}
                              placeholder="0"
                              data-qty-index={i}
                              onChange={(e) => setRowQty(r.variantId, e.target.value)}
                              onKeyDown={(e) => onQtyKey(e, i)}
                              onFocus={(e) => e.target.select()}
                              disabled={!r.available && !state}
                              aria-label={`Quantity of ${r.productName}, ${r.label}`}
                              aria-invalid={Boolean(state?.problem) || undefined}
                              aria-describedby={state?.problem ? errId : undefined}
                              className="h-9 w-full min-w-0 [appearance:textfield] bg-transparent text-center tabular-nums text-fg focus:outline-none disabled:opacity-40 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                            />
                            <button
                              type="button"
                              tabIndex={-1}
                              onClick={() => stepQty(r, 1)}
                              disabled={!r.available}
                              aria-label={`One case more of ${r.productName} ${r.label}`}
                              className="flex size-9 items-center justify-center text-muted hover:text-gold disabled:opacity-30"
                            >
                              <Plus className="size-3" aria-hidden />
                            </button>
                          </div>
                          {state?.problem ? (
                            <p id={errId} className="mt-1 flex items-center gap-2 text-[0.6875rem] text-ember">
                              {state.problem}
                              {state.qty > 0 && !state.problem.startsWith("Only") && state.problem !== "Out of stock" ? (
                                <button type="button" className="underline underline-offset-2 hover:text-fg" onClick={() => setRowQty(r.variantId, String(roundUpQty(state.qty, r.caseSize, r.minQty)))}>
                                  use {roundUpQty(state.qty, r.caseSize, r.minQty)}
                                </button>
                              ) : null}
                            </p>
                          ) : null}
                        </div>
                        <span role="cell" className="hidden text-right tabular-nums md:block">
                          {lineTotal ? formatMoney(lineTotal) : <span className="text-subtle">—</span>}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ))}
              {!groups.length ? <p className="py-10 text-center text-sm text-muted">Nothing matches “{filter}”.</p> : null}
            </div>
          </>
        ) : (
          <div className="space-y-12">
            <button type="button" onClick={() => setStep("build")} className="link-draw eyebrow inline-flex items-center gap-2" disabled={pending}>
              <ArrowLeft className="size-3" aria-hidden /> Edit quantities
            </button>
            <section aria-labelledby="review-lines">
              <h2 id="review-lines" className="mb-6 font-display text-3xl">
                Your order
              </h2>
              <ul className="divide-y divide-line border-y border-line text-sm">
                {lines.map((l) => (
                  <li key={l.row.variantId} className="flex items-center justify-between gap-4 py-4">
                    <div className="flex min-w-0 items-center gap-4">
                      <TradeThumb media={l.row.media} model={l.row.model} palette={l.row.palette} sizes="44px" className="h-12 w-10 shrink-0" />
                      <div className="min-w-0">
                        <p className="truncate">
                          {l.row.productName} <span className="text-muted">· {l.row.label}</span>
                        </p>
                        <p className="text-xs text-subtle">
                          {l.quantity} × {formatMoney(l.row.trade)} · {l.quantity / l.row.caseSize} case{l.quantity / l.row.caseSize === 1 ? "" : "s"}
                        </p>
                      </div>
                    </div>
                    <span className="tabular-nums">{formatMoney(l.quantity * l.row.trade)}</span>
                  </li>
                ))}
              </ul>
            </section>
            <TradeCheckoutFields value={{ ...checkout, shippingRateId: rate?.id ?? "" }} onChange={setCheckout} rates={rates} errors={errors} disabled={pending} idPrefix="qo" />
            {options.length === 0 ? null : (
              <p className="text-xs leading-relaxed text-subtle">
                {terms === "PREPAID"
                  ? `You’ll receive a proforma invoice, due in ${TERMS_DAYS.PREPAID} days. We hold your stock and dispatch once payment arrives.`
                  : `Invoiced on ${TERMS_LABEL[terms]} terms — payment due ${TERMS_DAYS[terms]} days from today. Coupons, gift cards and ${brand.loyalty.name} don’t apply to trade orders.`}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Desktop: sticky totals */}
      <aside className="hidden lg:block">
        <div className="sticky top-28 space-y-6 border border-line bg-bg-elev p-6">
          {summary}
          {formError ? (
            <p role="alert" className="border border-ember/40 p-3 text-xs leading-relaxed text-ember">
              {formError}
            </p>
          ) : null}
          {step === "build" ? (
            <Button className="w-full" disabled={!ready} onClick={() => setStep("review")}>
              <span>Review order</span>
            </Button>
          ) : (
            <Button className="w-full" disabled={!ready || pending || !rate} onClick={place}>
              <span>{pending ? "Placing…" : terms === "PREPAID" ? "Place order & get proforma" : "Place order on account"}</span>
            </Button>
          )}
        </div>
      </aside>

      {/* Mobile: sticky bar */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-bg/95 px-4 py-3 backdrop-blur lg:hidden">
        {formError ? (
          <p role="alert" className="mb-2 flex items-start justify-between gap-3 text-xs text-ember">
            {formError}
            <button type="button" onClick={() => setFormError(null)} aria-label="Dismiss">
              <X className="size-3.5" aria-hidden />
            </button>
          </p>
        ) : null}
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0 text-xs">
            <p className="font-display text-xl tabular-nums text-fg">{formatMoney(pricing.total)}</p>
            <p className={cn("truncate", shortfall || problems || overCredit ? "text-ember" : "text-muted")}>
              {problems
                ? `${problems} line${problems === 1 ? "" : "s"} to fix`
                : overCredit
                  ? "Over your available credit"
                  : shortfall
                    ? `${formatMoney(shortfall)} to minimum`
                    : `${lines.length} lines · ${units} units`}
            </p>
          </div>
          {step === "build" ? (
            <Button size="sm" disabled={!ready} onClick={() => setStep("review")}>
              <span>Review</span>
            </Button>
          ) : (
            <Button size="sm" disabled={!ready || pending || !rate} onClick={place}>
              <span>{pending ? "Placing…" : "Place order"}</span>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function Summary(p: {
  lines: number;
  units: number;
  subtotal: number;
  retailValue: number;
  shipping: number | null;
  tax: number;
  taxInclusive: boolean;
  taxRate: number;
  total: number;
  minimum: number;
  shortfall: number;
  problems: number;
  terms: TradeTerms;
  creditAvailable: number | null;
  overCredit: boolean;
}) {
  const reached = p.minimum > 0 ? Math.min(100, Math.round((p.subtotal / p.minimum) * 100)) : 100;
  return (
    <div className="space-y-5" aria-live="polite">
      <div className="flex items-baseline justify-between">
        <p className="eyebrow">Order total</p>
        <p className="text-xs text-muted">
          {p.lines} line{p.lines === 1 ? "" : "s"} · {p.units} unit{p.units === 1 ? "" : "s"}
        </p>
      </div>
      <dl className="space-y-2 text-sm">
        <Row label="Goods" value={formatMoney(p.subtotal)} />
        {p.retailValue > p.subtotal ? <Row label="Retail value" value={formatMoney(p.retailValue)} muted /> : null}
        <Row label="Shipping" value={p.shipping == null ? "—" : p.shipping ? formatMoney(p.shipping) : "Free"} />
        <Row label={p.taxInclusive ? `GST ${p.taxRate}% (included)` : `GST ${p.taxRate}%`} value={formatMoney(p.tax)} muted={p.taxInclusive} />
        <div className="flex items-baseline justify-between border-t border-line pt-3">
          <dt className="eyebrow !text-muted">Total</dt>
          <dd className="font-display text-3xl tabular-nums">{formatMoney(p.total)}</dd>
        </div>
      </dl>
      {p.minimum > 0 ? (
        <div>
          <div className="flex justify-between text-[0.625rem] uppercase tracking-[0.2em]">
            <span className={p.shortfall ? "text-ember" : "text-gold"}>{p.shortfall ? `${formatMoney(p.shortfall)} to minimum` : "Minimum reached"}</span>
            <span className="text-subtle">min {formatMoney(p.minimum)}</span>
          </div>
          <div className="mt-2 h-px bg-line-strong" role="progressbar" aria-label="Minimum order" aria-valuemin={0} aria-valuemax={100} aria-valuenow={reached}>
            <div className={cn("h-px transition-[width] duration-500", p.shortfall ? "bg-ember" : "bg-gold")} style={{ width: `${reached}%` }} />
          </div>
        </div>
      ) : null}
      {p.problems ? <p className="text-xs text-ember">{p.problems} line{p.problems === 1 ? " needs" : "s need"} a valid quantity.</p> : null}
      {p.creditAvailable !== null ? (
        <p className={cn("text-xs", p.overCredit ? "text-ember" : "text-muted")}>
          {p.overCredit ? `This order is over your available credit of ${formatMoney(p.creditAvailable)}. Settle an invoice or contact the trade desk.` : `Credit available ${formatMoney(p.creditAvailable)} · ${TERMS_LABEL[p.terms]}`}
        </p>
      ) : (
        <p className="text-xs text-muted">Prepaid — proforma invoice, dispatched once paid.</p>
      )}
    </div>
  );
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className={cn("flex justify-between gap-4", muted && "text-xs text-subtle")}>
      <dt className={muted ? undefined : "text-muted"}>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
