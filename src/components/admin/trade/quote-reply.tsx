"use client";

import { useState } from "react";
import { replyToQuoteAction, saveQuoteNotes, withdrawQuoteAction } from "@/actions/admin-trade";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { useAdminAction } from "@/components/admin/use-admin-action";
import { formatMoney } from "@/lib/money";
import { toMajor } from "@/lib/admin-shared";

export type ReplyVariantOption = { id: string; label: string; retail: number; trade: number };
export type ReplyLine = { id: string; description: string; variantId: string | null; quantity: number; targetPrice: number | null; quotedPrice: number | null };

/** Staff price each line (mapping free-text lines to catalogue variants), set validity and a message, then email the buyer. */
export function QuoteReplyForm({
  quoteId,
  lines: initialLines,
  variants,
  validUntil,
  replyMessage,
  staffNotes,
  resend,
}: {
  quoteId: string;
  lines: ReplyLine[];
  variants: ReplyVariantOption[];
  validUntil: string;
  replyMessage: string;
  staffNotes: string;
  resend: boolean;
}) {
  const { pending, run } = useAdminAction();
  const [lines, setLines] = useState(() =>
    initialLines.map((l) => ({ ...l, qty: String(l.quantity), price: l.quotedPrice != null ? String(toMajor(l.quotedPrice)) : "" })),
  );
  const [valid, setValid] = useState(validUntil);
  const [message, setMessage] = useState(replyMessage);
  const [notes, setNotes] = useState(staffNotes);
  const byId = new Map(variants.map((v) => [v.id, v]));
  const total = lines.reduce((s, l) => s + Math.round(Number(l.price || 0) * 100) * Number(l.qty || 0), 0);
  const unmapped = lines.filter((l) => Number(l.qty) > 0 && !l.variantId).length;

  const update = (id: string, patch: Partial<(typeof lines)[number]>) => setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  return (
    <form
      className="space-y-8 p-5"
      onSubmit={(e) => {
        e.preventDefault();
        run(() =>
          replyToQuoteAction({
            id: quoteId,
            validUntil: valid,
            replyMessage: message,
            staffNotes: notes,
            lines: lines.map((l) => ({ id: l.id, variantId: l.variantId, quantity: Number(l.qty || 0), quotedPrice: l.price.trim() === "" ? null : Number(l.price) })),
          }),
        );
      }}
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-left text-sm">
          <thead>
            <tr className="text-[0.625rem] uppercase tracking-[0.2em] text-subtle">
              <th scope="col" className="border-b border-line py-3 pr-4 font-normal">Request</th>
              <th scope="col" className="border-b border-line py-3 pr-4 font-normal">Catalogue item</th>
              <th scope="col" className="w-24 border-b border-line py-3 pr-4 text-right font-normal">Qty</th>
              <th scope="col" className="w-24 border-b border-line py-3 pr-4 text-right font-normal">Target</th>
              <th scope="col" className="w-32 border-b border-line py-3 text-right font-normal">Quote ₹/unit</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const v = l.variantId ? byId.get(l.variantId) : undefined;
              return (
                <tr key={l.id} className={Number(l.qty) === 0 ? "opacity-40" : undefined}>
                  <td className="border-b border-line py-3 pr-4 align-top">
                    <p>{l.description}</p>
                    {!l.variantId ? <p className="text-xs text-ember">Free text — map to a variant so the buyer can accept</p> : null}
                  </td>
                  <td className="border-b border-line py-3 pr-4 align-top">
                    <label className="sr-only" htmlFor={`map-${l.id}`}>
                      Catalogue item for line {i + 1}
                    </label>
                    <Select id={`map-${l.id}`} value={l.variantId ?? ""} onChange={(e) => update(l.id, { variantId: e.target.value || null })} disabled={pending} className="py-1.5">
                      <option value="">— Not mapped —</option>
                      {variants.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.label}
                        </option>
                      ))}
                    </Select>
                    {v ? (
                      <p className="mt-1 text-xs text-subtle">
                        Retail {formatMoney(v.retail)} · tier price {formatMoney(v.trade)}
                      </p>
                    ) : null}
                  </td>
                  <td className="border-b border-line py-3 pr-4 text-right align-top">
                    <label className="sr-only" htmlFor={`qty-${l.id}`}>
                      Quantity for line {i + 1} (0 removes it)
                    </label>
                    <Input id={`qty-${l.id}`} type="number" min={0} step={1} value={l.qty} onChange={(e) => update(l.id, { qty: e.target.value })} disabled={pending} className="py-1.5 text-right" />
                  </td>
                  <td className="border-b border-line py-3 pr-4 text-right align-top tabular-nums text-muted">{l.targetPrice != null ? formatMoney(l.targetPrice) : "—"}</td>
                  <td className="border-b border-line py-3 text-right align-top">
                    <label className="sr-only" htmlFor={`price-${l.id}`}>
                      Quoted price for line {i + 1} in rupees
                    </label>
                    <Input
                      id={`price-${l.id}`}
                      type="number"
                      min={0}
                      step={0.01}
                      value={l.price}
                      placeholder={v ? String(toMajor(v.trade)) : ""}
                      onChange={(e) => update(l.id, { price: e.target.value })}
                      disabled={pending}
                      className="py-1.5 text-right"
                      required={Number(l.qty) > 0}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4} className="py-3 text-right text-xs uppercase tracking-[0.2em] text-muted">
                Goods total
              </td>
              <td className="py-3 text-right font-display text-xl tabular-nums">{formatMoney(total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="text-xs text-subtle">Set a quantity to 0 to drop a line. Lines without a catalogue item can be quoted, but the buyer can’t accept until every line is mapped.</p>

      <div className="grid gap-6 sm:grid-cols-[12rem_1fr]">
        <Field label="Valid until">
          <Input type="date" value={valid} onChange={(e) => setValid(e.target.value)} required disabled={pending} />
        </Field>
        <Field label="Message to the buyer">
          <Textarea value={message} onChange={(e) => setMessage(e.target.value)} maxLength={2000} rows={3} disabled={pending} />
        </Field>
      </div>
      <Field label="Internal notes" hint="Never shown to the buyer">
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={5000} rows={2} disabled={pending} />
      </Field>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-xs text-muted">{unmapped ? `${unmapped} line${unmapped === 1 ? " is" : "s are"} not mapped — the buyer will be told to wait for mapping.` : "All lines are mapped."}</p>
        <Button type="submit" size="sm" disabled={pending}>
          {resend ? "Update & re-send quote" : "Send quote"}
        </Button>
      </div>
    </form>
  );
}

export function QuoteNotesForm({ quoteId, notes }: { quoteId: string; notes: string }) {
  const { pending, run } = useAdminAction();
  const [value, setValue] = useState(notes);
  return (
    <form
      className="space-y-3 p-5"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => saveQuoteNotes({ id: quoteId, notes: value }));
      }}
    >
      <Field label="Internal notes">
        <Textarea value={value} onChange={(e) => setValue(e.target.value)} maxLength={5000} rows={3} disabled={pending} />
      </Field>
      <div className="flex justify-end">
        <Button type="submit" size="sm" variant="outline" disabled={pending || value === notes}>
          Save notes
        </Button>
      </div>
    </form>
  );
}

export function WithdrawQuoteButton({ quoteId }: { quoteId: string }) {
  const { pending, run } = useAdminAction();
  const [confirm, setConfirm] = useState(false);
  return confirm ? (
    <span className="inline-flex items-center gap-3">
      <Button size="sm" variant="danger" disabled={pending} onClick={() => run(() => withdrawQuoteAction({ id: quoteId }))}>
        Withdraw & email buyer
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>
        Keep
      </Button>
    </span>
  ) : (
    <Button size="sm" variant="ghost" onClick={() => setConfirm(true)}>
      Withdraw quote
    </Button>
  );
}
