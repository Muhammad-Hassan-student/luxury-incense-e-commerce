"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
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
  const t = useTranslations("tradeQuote.request");
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
      if (lines[i].kind === "catalogue" && !it.variantId) return setError(t("errChooseProduct", { line: i + 1 }));
      if (lines[i].kind === "custom" && it.description.length < 3) return setError(t("errDescribe", { line: i + 1 }));
      if (!Number.isInteger(it.quantity) || it.quantity < 1) return setError(t("errQuantity", { line: i + 1 }));
      if (it.targetPrice !== null && (!Number.isFinite(it.targetPrice) || it.targetPrice < 0)) return setError(t("errTarget", { line: i + 1 }));
    }
    start(async () => {
      const res = await requestQuoteAction({ message, items });
      if (res.ok) {
        toast(t("requested", { number: res.number }));
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
                  {l.kind === "catalogue" ? t("lineCatalogue", { line: i + 1 }) : t("lineCustom", { line: i + 1 })}
                </p>
                {lines.length > 1 ? (
                  <button type="button" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} className="text-muted hover:text-ember" aria-label={t("removeLine", { line: i + 1 })}>
                    <Trash2 className="size-4" aria-hidden />
                  </button>
                ) : null}
              </div>
              <div className="grid gap-6 sm:grid-cols-[1fr_8rem_9rem]">
                {l.kind === "catalogue" ? (
                  <Field label={t("product")} hint={opt ? t("productHint", { price: formatMoney(opt.trade), caseSize: opt.caseSize }) : undefined}>
                    <Select value={l.variantId} onChange={(e) => update(l.key, { variantId: e.target.value })} disabled={pending} required>
                      <option value="">{t("choose")}</option>
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
                  <Field label={t("whatNeed")} hint={t("whatNeedHint")}>
                    <Input value={l.description} onChange={(e) => update(l.key, { description: e.target.value })} maxLength={300} disabled={pending} placeholder={t("whatNeedPlaceholder")} />
                  </Field>
                )}
                <Field label={t("quantity")}>
                  <Input type="number" inputMode="numeric" min={1} step={1} value={l.quantity} onChange={(e) => update(l.key, { quantity: e.target.value })} disabled={pending} required />
                </Field>
                <Field label={t("target")} hint={t("optional")}>
                  <Input type="number" inputMode="decimal" min={0} step={0.01} value={l.target} onChange={(e) => update(l.key, { target: e.target.value })} disabled={pending} />
                </Field>
                {l.kind === "catalogue" ? (
                  <Field label={t("lineNote")} className="sm:col-span-3">
                    <Input value={l.description} onChange={(e) => update(l.key, { description: e.target.value })} maxLength={200} disabled={pending} placeholder={t("lineNotePlaceholder")} />
                  </Field>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap gap-6">
        <button type="button" onClick={() => setLines((ls) => [...ls, newLine("catalogue")])} className="link-draw eyebrow inline-flex items-center gap-2" disabled={pending}>
          <Plus className="size-3" aria-hidden /> {t("addCatalogue")}
        </button>
        <button type="button" onClick={() => setLines((ls) => [...ls, newLine("custom")])} className="link-draw eyebrow inline-flex items-center gap-2" disabled={pending}>
          <Plus className="size-3" aria-hidden /> {t("addCustom")}
        </button>
      </div>
      <p className="text-xs leading-relaxed text-subtle">
        {t("customNote")}
      </p>
      <Field label={t("message")}>
        <Textarea value={message} onChange={(e) => setMessage(e.target.value)} maxLength={2000} rows={4} disabled={pending} placeholder={t("messagePlaceholder")} />
      </Field>
      {error ? (
        <p role="alert" className="border border-ember/40 p-4 text-sm text-ember">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end border-t border-line pt-8">
        <Button type="submit" disabled={pending}>
          <span>{pending ? t("sending") : t("submit")}</span>
        </Button>
      </div>
    </form>
  );
}
