"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { X } from "lucide-react";
import { applyCoupon, applyGiftCard, removeCoupon, removeGiftCard, setGiftWrap } from "@/actions/cart";
import { useMoney } from "@/components/money";

export function CouponForm({ applied, error }: { applied: string | null; error: string | null }) {
  const [code, setCode] = useState("");
  const [pending, start] = useTransition();
  if (applied) {
    return (
      <div>
        <div className="flex items-center justify-between text-sm">
          <span>
            Code <span className="text-gold">{applied}</span>
          </span>
          <button onClick={() => start(async () => void (await removeCoupon()))} disabled={pending} aria-label="Remove code" className="text-subtle hover:text-fg">
            <X className="size-4" />
          </button>
        </div>
        {error && <p className="mt-2 text-xs text-ember">{error}</p>}
      </div>
    );
  }
  return (
    <form
      className="flex items-center border-b border-line-strong focus-within:border-gold"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await applyCoupon(code);
          if (res.ok) {
            toast(res.message);
            setCode("");
          } else toast.error(res.error);
        });
      }}
    >
      <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Promo code" aria-label="Promo code" className="h-11 flex-1 bg-transparent text-sm uppercase tracking-widest placeholder:normal-case placeholder:tracking-normal placeholder:text-subtle focus:outline-none" />
      <button disabled={pending || !code} className="text-[0.6875rem] uppercase tracking-[0.28em] text-gold disabled:opacity-40">
        Apply
      </button>
    </form>
  );
}

export function GiftWrapToggle({ on, note, fee }: { on: boolean; note: string; fee: number }) {
  const money = useMoney();
  const [checked, setChecked] = useState(on);
  const [text, setText] = useState(note);
  const [pending, start] = useTransition();
  const save = (next: boolean, n = text) => start(async () => void (await setGiftWrap(next, n)));
  return (
    <div className="space-y-3">
      <label className="flex cursor-pointer items-center justify-between text-sm">
        <span>
          Gift wrap & hand-written note <span className="text-muted">({money(fee)})</span>
        </span>
        <input
          type="checkbox"
          checked={checked}
          disabled={pending}
          onChange={(e) => {
            setChecked(e.target.checked);
            save(e.target.checked);
          }}
          className="size-4 accent-[var(--gold)]"
        />
      </label>
      {checked && (
        <textarea
          value={text}
          maxLength={300}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => save(true, text)}
          placeholder="Your note (we’ll write it by hand)"
          aria-label="Gift note"
          className="min-h-20 w-full border border-line bg-transparent p-3 text-sm placeholder:text-subtle focus:border-gold focus:outline-none"
        />
      )}
    </div>
  );
}

export function GiftCardForm({ applied, appliedAmount, error }: { applied: string | null; appliedAmount: number; error: string | null }) {
  const money = useMoney();
  const [code, setCode] = useState("");
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  if (applied) {
    return (
      <div>
        <div className="flex items-center justify-between text-sm">
          <span>
            Gift card <span className="text-gold tracking-wider">{applied.slice(0, 7)}…</span>
            {appliedAmount > 0 && <span className="text-muted"> · {money(appliedAmount)}</span>}
          </span>
          <button onClick={() => start(async () => void (await removeGiftCard()))} disabled={pending} aria-label="Remove gift card" className="text-subtle hover:text-fg">
            <X className="size-4" />
          </button>
        </div>
        {error && <p className="mt-2 text-xs text-ember">{error}</p>}
      </div>
    );
  }
  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="link-draw text-xs text-muted hover:text-fg">
        Have a gift card?
      </button>
    );
  }
  return (
    <form
      className="flex items-center border-b border-line-strong focus-within:border-gold"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await applyGiftCard(code);
          if (res.ok) {
            toast(res.message);
            setCode("");
          } else toast.error(res.error);
        });
      }}
    >
      <input autoFocus value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="MO-XXXX-XXXX-XXXX" aria-label="Gift card code" className="h-11 flex-1 bg-transparent text-sm uppercase tracking-widest placeholder:text-subtle focus:outline-none" />
      <button disabled={pending || !code} className="text-[0.6875rem] uppercase tracking-[0.28em] text-gold disabled:opacity-40">
        Apply
      </button>
    </form>
  );
}
