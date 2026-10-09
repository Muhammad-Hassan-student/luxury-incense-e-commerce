"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { AlertTriangle, Gift, Keyboard, ListChecks, Package, PackageCheck, Printer, Search, ShieldAlert, Truck, X } from "lucide-react";
import { bulkFulfilmentAction, courierRatesAction, shipmentDetailAction, type BulkResult } from "@/actions/admin-fulfilment";
import { BOARD_COLUMNS, SHIPMENT_STATUS_LABEL, slaAge, type BoardColumn, type SlaTone } from "@/lib/fulfilment";
import type { BoardCard } from "@/server/courier/fulfilment";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { notify } from "../use-admin-action";
import { DrawerShell, DrawerSkeleton, FulfilmentDrawer } from "./drawer";

type Mode = "live" | "test";
type BulkKind = "pack" | "ship" | "pickup";

const toneClass: Record<SlaTone, string> = {
  ok: "border-line-strong text-muted",
  warn: "border-gold/50 text-gold",
  late: "border-ember/60 text-ember",
};

/** SLA thresholds (hours) per column: how long a parcel may sit there before it's "late". */
const SLA: Record<BoardColumn, { warn: number; late: number; verb: string }> = {
  TO_PACK: { warn: 12, late: 24, verb: "since confirmed" },
  PACKED: { warn: 12, late: 24, verb: "since confirmed" },
  READY: { warn: 18, late: 30, verb: "since confirmed" },
  IN_TRANSIT: { warn: 96, late: 144, verb: "on the road" },
  DELIVERED: { warn: 1e9, late: 1e9, verb: "ago" },
  EXCEPTIONS: { warn: 0, late: 24, verb: "open" },
};

const docUrl = (doc: "labels" | "manifest", ids: string[]) => `/api/admin/fulfilment/documents?doc=${doc}&orders=${ids.join(",")}`;
const printUrl = (doc: "picklist" | "slips", ids: string[]) => `/admin/fulfilment/print?doc=${doc}&orders=${ids.join(",")}`;

const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));

export function FulfilmentBoard({ cards, awaitingCod, mode, serverNow }: { cards: BoardCard[]; awaitingCod: number; mode: Mode; serverNow: string }) {
  const [now, setNow] = useState(() => new Date(serverNow));
  const [query, setQuery] = useState("");
  const [payment, setPayment] = useState<"all" | "cod" | "prepaid">("all");
  const [courier, setCourier] = useState("");
  const [lateOnly, setLateOnly] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [focusId, setFocusId] = useState<string | null>(null);
  const [mobileCol, setMobileCol] = useState<BoardColumn>("TO_PACK");
  const [help, setHelp] = useState(false);
  const [failures, setFailures] = useState<{ number: string; error?: string }[]>([]);
  const [pending, startTransition] = useTransition();
  const [drawer, setDrawer] = useState<{ id: string; detail: ReturnType<typeof shipmentDetailAction>; rates: ReturnType<typeof courierRatesAction> | null } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Ageing badges tick every minute.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const couriers = useMemo(() => [...new Set(cards.map((c) => c.shipment?.courierName).filter((x): x is string => Boolean(x)))].sort(), [cards]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return cards.filter((c) => {
      if (payment === "cod" && !c.cod) return false;
      if (payment === "prepaid" && c.cod) return false;
      if (courier && c.shipment?.courierName !== courier) return false;
      if (lateOnly && slaAge(c.since, now, SLA[c.column]).tone !== "late") return false;
      if (!q) return true;
      return [c.number, c.name, c.email, c.phone, c.city, c.pincode, c.shipment?.awb ?? "", ...c.items.map((i) => i.sku)].some((v) => v.toLowerCase().includes(q));
    });
  }, [cards, query, payment, courier, lateOnly, now]);

  const byColumn = useMemo(() => {
    const m = new Map<BoardColumn, BoardCard[]>(BOARD_COLUMNS.map((c) => [c.key, []]));
    for (const c of visible) m.get(c.column)!.push(c);
    return m;
  }, [visible]);

  // Selection only ever holds cards that are still on the board.
  const liveSelected = useMemo(() => visible.filter((c) => selected.has(c.id)), [visible, selected]);
  const selIds = liveSelected.map((c) => c.id);

  const toggle = useCallback((id: string) => {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }, []);

  const openDrawer = useCallback(
    (id: string) => {
      const card = cards.find((c) => c.id === id);
      const bookable = card && !card.shipment?.awb && !card.problem && (card.column === "TO_PACK" || card.column === "PACKED");
      setFocusId(id);
      setDrawer({ id, detail: shipmentDetailAction({ orderId: id }), rates: bookable ? courierRatesAction({ orderId: id }) : null });
    },
    [cards],
  );

  const reloadDrawer = useCallback(() => {
    setDrawer((d) => (d ? { id: d.id, detail: shipmentDetailAction({ orderId: d.id }), rates: d.rates ? courierRatesAction({ orderId: d.id }) : null } : d));
  }, []);

  const runBulk = useCallback(
    (kind: BulkKind, ids: string[]) => {
      if (!ids.length) {
        notify.error("Select orders first (x, or tick the cards).");
        return;
      }
      startTransition(async () => {
        let res: BulkResult;
        try {
          res = await bulkFulfilmentAction({ action: kind, orderIds: ids });
        } catch (e) {
          if (e && typeof e === "object" && "digest" in e) throw e;
          notify.error("Something went wrong. Please try again.");
          return;
        }
        if (!res.ok) {
          notify.error(res.error);
          return;
        }
        const failed = res.outcomes.filter((o) => !o.ok);
        setFailures(failed.map((f) => ({ number: f.number, error: f.error })));
        if (failed.length) notify.error(`${res.message} · ${failed.length} need attention`);
        else notify.success(res.message);
        setSelected((s) => {
          const n = new Set(s);
          for (const o of res.outcomes) if (o.ok) n.delete(o.orderId);
          return n;
        });
      });
    },
    [],
  );

  const eligible = useMemo(
    () => ({
      pack: liveSelected.filter((c) => c.column === "TO_PACK").map((c) => c.id),
      ship: liveSelected.filter((c) => (c.column === "TO_PACK" || c.column === "PACKED") && !c.shipment?.awb && !c.problem).map((c) => c.id),
      pickup: liveSelected.filter((c) => c.column === "READY" && c.shipment?.status === "AWB_ASSIGNED").map((c) => c.id),
      labelled: liveSelected.filter((c) => c.shipment?.awb).map((c) => c.id),
    }),
    [liveSelected],
  );

  const openDoc = (url: string) => window.open(url, "_blank", "noopener");

  // ── Keyboard ──
  const flat = useMemo(() => BOARD_COLUMNS.flatMap((col) => byColumn.get(col.key)!.map((c) => c.id)), [byColumn]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape") {
        if (drawer) setDrawer(null);
        else if (help) setHelp(false);
        else if (isTyping(e.target)) (e.target as HTMLElement).blur();
        else setSelected(new Set());
        return;
      }
      if (isTyping(e.target) || drawer) return;
      const focused = flat.includes(focusId ?? "") ? focusId : null;
      const target = selIds.length ? selIds : focused ? [focused] : [];
      const col = (id: string | null) => cards.find((c) => c.id === id)?.column;
      const moveWithin = (dir: 1 | -1) => {
        const c = col(focused) ?? BOARD_COLUMNS.find((x) => byColumn.get(x.key)!.length)?.key;
        if (!c) return;
        const list = byColumn.get(c)!.map((x) => x.id);
        const i = focused ? list.indexOf(focused) : -1;
        const next = list[Math.min(list.length - 1, Math.max(0, i + dir))];
        if (next) setFocusId(next);
      };
      const moveAcross = (dir: 1 | -1) => {
        const keys = BOARD_COLUMNS.map((x) => x.key);
        let i = keys.indexOf(col(focused) ?? "TO_PACK");
        for (let step = 0; step < keys.length; step++) {
          i = (i + dir + keys.length) % keys.length;
          const first = byColumn.get(keys[i])![0];
          if (first) {
            setFocusId(first.id);
            setMobileCol(keys[i]);
            return;
          }
        }
      };
      const k = e.key;
      const act: Record<string, () => void> = {
        "/": () => searchRef.current?.focus(),
        "?": () => setHelp((h) => !h),
        j: () => moveWithin(1),
        ArrowDown: () => moveWithin(1),
        k: () => moveWithin(-1),
        ArrowUp: () => moveWithin(-1),
        ArrowRight: () => moveAcross(1),
        ArrowLeft: () => moveAcross(-1),
        x: () => focused && toggle(focused),
        " ": () => focused && toggle(focused),
        Enter: () => focused && openDrawer(focused),
        o: () => focused && openDrawer(focused),
        a: () => {
          const c = col(focused);
          if (c) setSelected((s) => new Set([...s, ...byColumn.get(c)!.map((x) => x.id)]));
        },
        p: () => runBulk("pack", target),
        b: () => runBulk("ship", target),
        u: () => runBulk("pickup", target),
        l: () => (target.length ? openDoc(docUrl("labels", target)) : notify.error("Select orders first.")),
        m: () => (target.length ? openDoc(docUrl("manifest", target)) : notify.error("Select orders first.")),
        i: () => (target.length ? openDoc(printUrl("picklist", target)) : notify.error("Select orders first.")),
        s: () => (target.length ? openDoc(printUrl("slips", target)) : notify.error("Select orders first.")),
      };
      const fn = act[k];
      if (fn) {
        e.preventDefault();
        fn();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [byColumn, cards, drawer, flat, focusId, help, openDrawer, runBulk, selIds, toggle]);

  // Keep the keyboard cursor in view.
  useEffect(() => {
    if (focusId) document.getElementById(`card-${focusId}`)?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [focusId]);

  const counts = BOARD_COLUMNS.map((c) => ({ ...c, n: byColumn.get(c.key)!.length, late: byColumn.get(c.key)!.filter((x) => slaAge(x.since, now, SLA[c.key]).tone === "late").length }));
  const lateTotal = counts.filter((c) => c.key !== "DELIVERED").reduce((s, c) => s + c.late, 0);
  const drawerCard = drawer ? cards.find((c) => c.id === drawer.id) : null;

  return (
    <div className="pb-28">
      {/* Summary strip */}
      <div className="mb-5 grid grid-cols-2 gap-px border border-line bg-line sm:grid-cols-3 xl:grid-cols-6">
        {counts.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => {
              setMobileCol(c.key);
              document.getElementById(`col-${c.key}`)?.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
            }}
            className={cn("bg-bg-elev px-4 py-3 text-left transition-colors hover:bg-bg-soft", mobileCol === c.key && "max-md:bg-bg-soft")}
          >
            <span className="block text-[0.625rem] uppercase tracking-[0.2em] text-subtle">{c.label}</span>
            <span className="mt-1 flex items-baseline gap-2">
              <span className="font-display text-2xl font-light tabular-nums text-fg">{c.n}</span>
              {c.late && c.key !== "DELIVERED" ? <span className="text-[0.625rem] uppercase tracking-[0.15em] text-ember">{c.late} late</span> : null}
            </span>
          </button>
        ))}
      </div>

      {/* Toolbar */}
      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center">
        <label className="relative flex-1">
          <span className="sr-only">Search the board</span>
          <Search className="pointer-events-none absolute left-0 top-1/2 size-4 -translate-y-1/2 text-subtle" aria-hidden />
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search order, customer, pincode, AWB or SKU   ( / )"
            className="w-full border-0 border-b border-line-strong bg-transparent py-2.5 pl-7 text-sm text-fg placeholder:text-subtle focus:border-gold focus:outline-none"
          />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <Seg value={payment} onChange={setPayment} options={[["all", "All"], ["cod", "COD"], ["prepaid", "Prepaid"]]} label="Payment" />
          {couriers.length ? (
            <select
              value={courier}
              onChange={(e) => setCourier(e.target.value)}
              aria-label="Courier"
              className="h-8 border border-line-strong bg-bg px-2 text-xs text-fg focus:border-gold focus:outline-none"
            >
              <option value="">All couriers</option>
              {couriers.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          ) : null}
          <button
            type="button"
            aria-pressed={lateOnly}
            onClick={() => setLateOnly((v) => !v)}
            className={cn("inline-flex h-8 items-center gap-1.5 border px-3 text-[0.625rem] uppercase tracking-[0.18em] transition-colors", lateOnly ? "border-ember/60 text-ember" : "border-line-strong text-muted hover:text-fg")}
          >
            <AlertTriangle className="size-3.5" aria-hidden /> Late only{lateTotal ? ` · ${lateTotal}` : ""}
          </button>
          <button type="button" onClick={() => setHelp(true)} className="hidden h-8 items-center gap-1.5 border border-line-strong px-3 text-[0.625rem] uppercase tracking-[0.18em] text-muted hover:text-fg md:inline-flex">
            <Keyboard className="size-3.5" aria-hidden /> Shortcuts
          </button>
        </div>
      </div>

      {awaitingCod ? (
        <p className="mb-4 flex items-center gap-2 text-xs text-muted">
          <ShieldAlert className="size-3.5 text-gold" aria-hidden />
          {awaitingCod} cash-on-delivery order{awaitingCod === 1 ? " is" : "s are"} waiting for the customer to confirm — they join “To pack” once confirmed.
        </p>
      ) : null}

      {failures.length ? (
        <div role="status" className="mb-4 border border-ember/40 p-4 text-sm">
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="eyebrow !text-ember">Needs attention</p>
            <button type="button" onClick={() => setFailures([])} className="text-muted hover:text-fg" aria-label="Dismiss">
              <X className="size-4" />
            </button>
          </div>
          <ul className="space-y-1 text-muted">
            {failures.map((f) => (
              <li key={f.number}>
                <span className="font-mono text-fg">{f.number}</span> — {f.error}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Mobile column picker */}
      <div className="mb-4 flex gap-2 overflow-x-auto pb-1 md:hidden" role="tablist" aria-label="Columns">
        {counts.map((c) => (
          <button
            key={c.key}
            role="tab"
            aria-selected={mobileCol === c.key}
            onClick={() => setMobileCol(c.key)}
            className={cn("shrink-0 border px-3 py-1.5 text-[0.625rem] uppercase tracking-[0.18em]", mobileCol === c.key ? "border-gold text-gold" : "border-line-strong text-muted")}
          >
            {c.label} · {c.n}
          </button>
        ))}
      </div>

      {/* Board */}
      <div className="flex gap-4 overflow-x-auto pb-4 md:snap-x">
        {BOARD_COLUMNS.map((col) => {
          const list = byColumn.get(col.key)!;
          const allSel = list.length > 0 && list.every((c) => selected.has(c.id));
          return (
            <section
              key={col.key}
              id={`col-${col.key}`}
              aria-label={col.label}
              className={cn("w-full shrink-0 snap-start md:w-[17.5rem]", mobileCol !== col.key && "max-md:hidden")}
            >
              <header className="mb-3 flex items-center justify-between gap-2 border-b border-line pb-2">
                <div>
                  <h2 className="eyebrow">
                    {col.label} <span className="text-subtle">· {list.length}</span>
                  </h2>
                  <p className="text-[0.6875rem] text-subtle">{col.hint}</p>
                </div>
                {list.length ? (
                  <label className="flex items-center gap-1.5 text-[0.625rem] uppercase tracking-[0.15em] text-subtle">
                    <input
                      type="checkbox"
                      className="size-3.5 accent-[var(--gold)]"
                      checked={allSel}
                      onChange={() =>
                        setSelected((s) => {
                          const n = new Set(s);
                          for (const c of list) {
                            if (allSel) n.delete(c.id);
                            else n.add(c.id);
                          }
                          return n;
                        })
                      }
                    />
                    All
                  </label>
                ) : null}
              </header>
              <ul className="space-y-2.5">
                {list.map((c) => (
                  <Card key={c.id} c={c} now={now} selected={selected.has(c.id)} focused={focusId === c.id} onToggle={toggle} onOpen={openDrawer} />
                ))}
                {!list.length ? <li className="border border-dashed border-line px-4 py-8 text-center text-xs text-subtle">Nothing here</li> : null}
              </ul>
            </section>
          );
        })}
      </div>

      {/* Bulk bar */}
      {liveSelected.length ? (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line-strong bg-bg-elev/95 backdrop-blur lg:left-60">
          <div className="mx-auto flex max-w-[1280px] flex-wrap items-center gap-2 px-4 py-3 sm:px-6 lg:px-10">
            <span className="mr-2 text-sm text-fg">
              <span className="font-display text-xl tabular-nums">{liveSelected.length}</span> selected
            </span>
            <BulkBtn icon={Package} label="Mark packed" hint="p" n={eligible.pack.length} disabled={pending} onClick={() => runBulk("pack", eligible.pack)} />
            <BulkBtn icon={PackageCheck} label="Create AWBs" hint="b" n={eligible.ship.length} disabled={pending} onClick={() => runBulk("ship", eligible.ship)} primary />
            <BulkBtn icon={Truck} label="Schedule pickup" hint="u" n={eligible.pickup.length} disabled={pending} onClick={() => runBulk("pickup", eligible.pickup)} />
            <BulkBtn icon={Printer} label="Labels" hint="l" n={eligible.labelled.length} onClick={() => openDoc(docUrl("labels", eligible.labelled))} />
            <BulkBtn icon={ListChecks} label="Pick list" hint="i" n={selIds.length} onClick={() => openDoc(printUrl("picklist", selIds))} />
            <BulkBtn icon={Printer} label="Packing slips" hint="s" n={selIds.length} onClick={() => openDoc(printUrl("slips", selIds))} />
            <BulkBtn icon={Printer} label="Manifest" hint="m" n={eligible.labelled.length} onClick={() => openDoc(docUrl("manifest", eligible.labelled))} />
            <button type="button" onClick={() => setSelected(new Set())} className="ml-auto text-[0.625rem] uppercase tracking-[0.2em] text-muted hover:text-fg">
              Clear · esc
            </button>
            {pending ? <span className="w-full text-xs text-gold sm:w-auto">Working with the courier…</span> : null}
          </div>
        </div>
      ) : null}

      {drawer && drawerCard ? (
        <Suspense fallback={<DrawerShell onClose={() => setDrawer(null)} title={drawerCard.number}><DrawerSkeleton /></DrawerShell>}>
          <FulfilmentDrawer key={drawer.id} card={drawerCard} mode={mode} detail={drawer.detail} rates={drawer.rates} onClose={() => setDrawer(null)} onChanged={reloadDrawer} />
        </Suspense>
      ) : null}

      {help ? <ShortcutHelp onClose={() => setHelp(false)} /> : null}
    </div>
  );
}

function Card({ c, now, selected, focused, onToggle, onOpen }: { c: BoardCard; now: Date; selected: boolean; focused: boolean; onToggle: (id: string) => void; onOpen: (id: string) => void }) {
  const age = slaAge(c.since, now, SLA[c.column]);
  const first = c.items[0];
  const s = c.shipment;
  return (
    <li
      id={`card-${c.id}`}
      className={cn(
        "group relative border bg-bg-elev transition-[border-color,box-shadow] duration-300",
        selected ? "border-gold" : "border-line hover:border-line-strong",
        focused && "ring-1 ring-gold/70 ring-offset-2 ring-offset-bg",
      )}
    >
      <div className="flex items-start gap-3 p-3.5">
        <input type="checkbox" checked={selected} onChange={() => onToggle(c.id)} aria-label={`Select ${c.number}`} className="mt-1 size-3.5 shrink-0 accent-[var(--gold)]" />
        <button type="button" onClick={() => onOpen(c.id)} className="min-w-0 flex-1 text-left">
          <span className="flex items-center justify-between gap-2">
            <span className="font-mono text-[0.8125rem] text-fg">{c.number}</span>
            {c.column !== "DELIVERED" ? (
              <span className={cn("shrink-0 border px-1.5 py-px text-[0.5625rem] uppercase tracking-[0.15em] tabular-nums", toneClass[age.tone])} title={`${age.label} ${SLA[c.column].verb}`}>
                {age.label}
              </span>
            ) : (
              <span className="text-[0.625rem] text-subtle">{age.label} ago</span>
            )}
          </span>
          <span className="mt-1 block truncate text-sm text-fg">{c.name}</span>
          <span className="block truncate text-xs text-muted">
            {c.city}
            {c.pincode ? ` · ${c.pincode}` : ""}
          </span>
          <span className="mt-2 block truncate text-xs text-subtle">
            {c.pieces} pc · {first ? `${first.name}${first.quantity > 1 ? ` ×${first.quantity}` : ""}` : "—"}
            {c.items.length > 1 ? ` +${c.items.length - 1}` : ""}
          </span>
          <span className="mt-2 flex flex-wrap items-center gap-1.5">
            <Chip tone={c.cod ? "gold" : "muted"}>{c.cod ? (c.codDue ? `COD ${formatMoney(c.codDue)}` : "COD paid") : "Prepaid"}</Chip>
            {c.giftWrap ? (
              <Chip tone="muted">
                <Gift className="size-3" aria-hidden /> Gift
              </Chip>
            ) : null}
            {c.riskScore != null && c.riskScore >= 60 ? <Chip tone="ember">RTO risk {c.riskScore}</Chip> : null}
            {c.deliveryDate ? <Chip tone="muted">By {new Date(c.deliveryDate).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</Chip> : null}
          </span>
          {s?.awb ? (
            <span className="mt-2.5 block border-t border-line pt-2 text-[0.6875rem] leading-relaxed text-muted">
              <span className="text-fg">{s.courierName}</span> · <span className="font-mono">{s.awb}</span>
              <span className="block truncate text-subtle">
                {s.provider === "mock" ? "Test · " : ""}
                {s.lastEvent ? `${s.lastEvent.label.toLowerCase()}${s.lastEvent.location ? ` — ${s.lastEvent.location}` : ""}` : SHIPMENT_STATUS_LABEL[s.status]}
              </span>
            </span>
          ) : s && !s.awb ? (
            <span className="mt-2 block text-[0.6875rem] text-gold">Booking incomplete — open to retry</span>
          ) : null}
          {c.problem ? <span className="mt-2 block text-[0.6875rem] text-ember">{c.problem}</span> : null}
        </button>
      </div>
    </li>
  );
}

function Chip({ tone, children }: { tone: "gold" | "ember" | "muted"; children: React.ReactNode }) {
  const t = { gold: "border-gold/40 text-gold", ember: "border-ember/50 text-ember", muted: "border-line-strong text-muted" }[tone];
  return <span className={cn("inline-flex items-center gap-1 border px-1.5 py-px text-[0.5625rem] uppercase tracking-[0.14em]", t)}>{children}</span>;
}

function Seg<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: [T, string][]; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex h-8 border border-line-strong">
      {options.map(([v, l]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={cn("px-3 text-[0.625rem] uppercase tracking-[0.18em] transition-colors", value === v ? "bg-fg text-bg" : "text-muted hover:text-fg")}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

function BulkBtn({ icon: Icon, label, hint, n, onClick, disabled, primary }: { icon: typeof Package; label: string; hint: string; n: number; onClick: () => void; disabled?: boolean; primary?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || n === 0}
      title={`${label} (${hint})`}
      className={cn(
        "inline-flex h-9 items-center gap-2 border px-3 text-[0.625rem] uppercase tracking-[0.18em] transition-colors disabled:pointer-events-none disabled:opacity-35",
        primary ? "border-gold bg-gold text-bg hover:bg-fg hover:border-fg" : "border-line-strong text-fg hover:border-gold hover:text-gold",
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {label}
      <span className={cn("tabular-nums", primary ? "text-bg/70" : "text-subtle")}>{n}</span>
    </button>
  );
}

const SHORTCUTS: [string, string][] = [
  ["/", "Search"],
  ["j / k  ↑ ↓", "Move between cards"],
  ["← →", "Move between columns"],
  ["x  space", "Select card"],
  ["a", "Select whole column"],
  ["enter  o", "Open details"],
  ["p", "Mark packed"],
  ["b", "Create AWBs (book courier)"],
  ["u", "Schedule pickup"],
  ["l", "Print labels"],
  ["i", "Pick list"],
  ["s", "Packing slips"],
  ["m", "Manifest"],
  ["esc", "Close / clear selection"],
];

function ShortcutHelp({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-md border border-line-strong bg-bg-elev p-6">
        <p className="eyebrow mb-4">Keyboard shortcuts</p>
        <dl className="grid grid-cols-[8rem_1fr] gap-x-4 gap-y-2 text-sm">
          {SHORTCUTS.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="font-mono text-xs text-gold">{k}</dt>
              <dd className="text-muted">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-5 text-xs text-subtle">Actions apply to the selected cards, or to the highlighted card when nothing is selected.</p>
      </div>
    </div>
  );
}
