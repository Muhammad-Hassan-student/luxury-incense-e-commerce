"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { requestQuoteAction } from "@/actions/trade";
import { formatMoney } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";

export type QuoteVariantOption = { variantId: string; product: string; label: string; sku: string; trade: number; caseSize: number };

type Line = { key: string; kind: "catalogue" | "custom"; variantId: string; description: string; quantity: string; target: string };

let seq = 0;
const newLine = (kind: Line["kind"]): Line => ({ key: `l${++seq}`, kind, variantId: "", description: "", quantity: "", target: "" });

/** Request for quotation: catalogue lines with target prices and/or free-text lines (private label, custom blends). */
export function QuoteRequestForm({ options }: { options: QuoteVariantOption[] }) {
  const router = useRouter();
  const formId = useId();
  const [pending, start] = useTransition();
  const [lines, setLines] = useState<Line[]>(() => [newLine("catalogue")]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const byProduct = new Map<string, QuoteVariantOption[]>();
  for (const o of options) byProduct.set(o.product, [...(byProduct.get(o.product) ?? []), o]);

  const update = (key: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const items = lines.map((l) => ({
      variantId: l.kind === "catalogue" ? l.variantId || null : null,
      description: l.description.trim(),
      quantity: Number(l.quantity),
      targetPrice: l.target.trim() ? Math.round(Number(l.target) * 100) : null,
    }));
    for (const [i, it] of items.entries()) {
      if (lines[i].kind === "catalogue" && !it.variantId) return setError(`Line ${i + 1}: choose a product.`);
      if (lines[i].kind === "custom" && it.description.length < 3) return setError(`Line ${i + 1}: describe what you need.`);
      if (!Number.isInteger(it.quantity) || it.quantity < 1) return setError(`Line ${i + 1}: enter a quantity.`);
      if (it.targetPrice !== null && (!Number.isFinite(it.targetPrice) || it.targetPrice < 0)) return setError(`Line ${i + 1}: target price must be a number.`);
    }
    start(async () => {
      const res = await requestQuoteAction({ message, items });
      if (res.ok) {
        toast(`Quote ${res.number} requested`);
        router.push(`/trade/portal/quotes/${res.number}`);
        router.refresh();
      } else setError(res.error);
    });
  }

  return (
    <form id={formId} onSubmit={submit} className="space-y-12" noValidate>
      <ol className="space-y-6">
        {lines.map((l, i) => {
          const opt = options.find((o) => o.variantId === l.variantId);
          return (
            <li key={l.key} className="border border-line p-6">
              <div className="mb-4 flex items-center justify-between">
                <p className="eyebrow">
                  Line {i + 1} · {l.kind === "catalogue" ? "From the catalogue" : "Custom or private label"}
                </p>
                {lines.length > 1 ? (
                  <button type="button" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} className="text-muted hover:text-ember" aria-label={`Remove line ${i + 1}`}>
                    <Trash2 className="size-4" aria-hidden />
                  </button>
                ) : null}
              </div>
              <div className="grid gap-6 sm:grid-cols-[1fr_8rem_9rem]">
                {l.kind === "catalogue" ? (
                  <Field label="Product" hint={opt ? `Your price ${formatMoney(opt.trade)} · case of ${opt.caseSize}` : undefined}>
                    <Select value={l.variantId} onChange={(e) => update(l.key, { variantId: e.target.value })} disabled={pending} required>
                      <option value="">Choose…</option>
                      {[...byProduct].map(([product, vs]) => (
                        <optgroup key={product} label={product}>
                          {vs.map((v) => (
                            <option key={v.variantId} value={v.variantId}>
                              {product} — {v.label} ({v.sku})
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </Select>
                  </Field>
                ) : (
                  <Field label="What do you need?" hint="Scent direction, packaging, labelling, timing…">
                    <Input value={l.description} onChange={(e) => update(l.key, { description: e.target.value })} maxLength={300} disabled={pending} placeholder="Private-label oud bakhoor, 50 g tins with our logo" />
                  </Field>
                )}
                <Field label="Quantity">
                  <Input type="number" inputMode="numeric" min={1} step={1} value={l.quantity} onChange={(e) => update(l.key, { quantity: e.target.value })} disabled={pending} required />
                </Field>
                <Field label="Target ₹ / unit" hint="Optional">
                  <Input type="number" inputMode="decimal" min={0} step={0.01} value={l.target} onChange={(e) => update(l.key, { target: e.target.value })} disabled={pending} />
                </Field>
                {l.kind === "catalogue" ? (
                  <Field label="Note for this line (optional)" className="sm:col-span-3">
                    <Input value={l.description} onChange={(e) => update(l.key, { description: e.target.value })} maxLength={200} disabled={pending} placeholder="e.g. gift boxed, staggered delivery" />
                  </Field>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap gap-6">
        <button type="button" onClick={() => setLines((ls) => [...ls, newLine("catalogue")])} className="link-draw eyebrow inline-flex items-center gap-2" disabled={pending}>
          <Plus className="size-3" aria-hidden /> Catalogue item
        </button>
        <button type="button" onClick={() => setLines((ls) => [...ls, newLine("custom")])} className="link-draw eyebrow inline-flex items-center gap-2" disabled={pending}>
          <Plus className="size-3" aria-hidden /> Custom / private label
        </button>
      </div>
      <p className="text-xs leading-relaxed text-subtle">
        Custom lines are priced by our trade desk. Before a quote can become an order, we link each custom line to a catalogue item we create for you.
      </p>
      <Field label="Message to the trade desk (optional)">
        <Textarea value={message} onChange={(e) => setMessage(e.target.value)} maxLength={2000} rows={4} disabled={pending} placeholder="Delivery timing, branding, anything that helps us price it" />
      </Field>
      {error ? (
        <p role="alert" className="border border-ember/40 p-4 text-sm text-ember">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end border-t border-line pt-8">
        <Button type="submit" disabled={pending}>
          <span>{pending ? "Sending…" : "Request quote"}</span>
        </Button>
      </div>
    </form>
  );
}
