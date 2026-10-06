"use client";

import { useState } from "react";
import type { OrderStatus } from "@/generated/prisma/enums";
import { advanceOrderAction, refundOrderAction, updateOrderNotes } from "@/actions/admin-orders";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { useAdminAction } from "./use-admin-action";

const verbs: Partial<Record<OrderStatus, string>> = {
  PACKED: "Mark packed",
  SHIPPED: "Ship order",
  DELIVERED: "Mark delivered",
  CANCELLED: "Cancel order",
};

export function OrderStatusActions({
  orderId,
  next,
  awaitingPayment,
  defaultCarrier,
}: {
  orderId: string;
  next: OrderStatus[];
  awaitingPayment: boolean;
  defaultCarrier: string;
}) {
  const { pending, run } = useAdminAction();
  const [shipping, setShipping] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [tracking, setTracking] = useState("");
  const [carrier, setCarrier] = useState(defaultCarrier);

  if (!next.length) return <p className="text-sm text-muted">This order is complete — no further steps.</p>;

  const forward = next.filter((s) => s !== "CANCELLED" && !(awaitingPayment && s === "PACKED"));

  return (
    <div className="space-y-5">
      {awaitingPayment ? <p className="text-sm text-muted">Awaiting online payment. It can be packed once paid.</p> : null}
      <div className="flex flex-wrap gap-3">
        {forward.map((s) =>
          s === "SHIPPED" ? (
            <Button key={s} size="sm" onClick={() => setShipping((v) => !v)} aria-expanded={shipping} disabled={pending}>
              {verbs[s]}
            </Button>
          ) : (
            <Button key={s} size="sm" disabled={pending} onClick={() => run(() => advanceOrderAction({ orderId, to: s }))}>
              {verbs[s] ?? s}
            </Button>
          ),
        )}
        {next.includes("CANCELLED") ? (
          <Button size="sm" variant="danger" disabled={pending} onClick={() => setConfirmCancel(true)}>
            Cancel order
          </Button>
        ) : null}
      </div>

      {shipping ? (
        <form
          className="grid gap-5 border border-line p-5 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => advanceOrderAction({ orderId, to: "SHIPPED", trackingNumber: tracking, carrier }), {
              onSuccess: () => setShipping(false),
            });
          }}
        >
          <Field label="Carrier">
            <Input value={carrier} onChange={(e) => setCarrier(e.target.value)} required maxLength={100} />
          </Field>
          <Field label="Tracking number">
            <Input value={tracking} onChange={(e) => setTracking(e.target.value)} required maxLength={100} autoFocus />
          </Field>
          <div className="flex gap-3 sm:col-span-2">
            <Button size="sm" type="submit" disabled={pending || !tracking.trim() || !carrier.trim()}>
              Confirm shipment
            </Button>
            <Button size="sm" type="button" variant="ghost" onClick={() => setShipping(false)}>
              Back
            </Button>
          </div>
        </form>
      ) : null}

      {confirmCancel ? (
        <div role="alertdialog" aria-label="Confirm cancellation" className="border border-ember/40 p-5">
          <p className="text-sm text-fg">Cancel this order? Held or sold stock is returned. Captured payments are not refunded automatically.</p>
          <div className="mt-4 flex gap-3">
            <Button
              size="sm"
              variant="danger"
              disabled={pending}
              onClick={() => run(() => advanceOrderAction({ orderId, to: "CANCELLED" }), { onSuccess: () => setConfirmCancel(false) })}
            >
              Yes, cancel
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmCancel(false)}>
              Keep order
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function RefundAction({ orderId, total }: { orderId: string; total: string }) {
  const { pending, run } = useAdminAction();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");

  if (!open) {
    return (
      <Button size="sm" variant="danger" onClick={() => setOpen(true)}>
        Refund {total}
      </Button>
    );
  }
  return (
    <form
      className="space-y-4 border border-ember/40 p-5"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => refundOrderAction({ orderId, reason }), { onSuccess: () => setOpen(false) });
      }}
    >
      <p className="text-sm text-fg">
        Refund the full {total} to the original payment method. Unshipped items return to stock and loyalty points are reversed. This cannot be undone.
      </p>
      <Field label="Reason (shown in the order timeline)">
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} maxLength={500} className="min-h-16" />
      </Field>
      <div className="flex gap-3">
        <Button size="sm" variant="danger" type="submit" disabled={pending || reason.trim().length < 3}>
          {pending ? "Refunding…" : "Confirm refund"}
        </Button>
        <Button size="sm" variant="ghost" type="button" onClick={() => setOpen(false)}>
          Back
        </Button>
      </div>
    </form>
  );
}

export function OrderNotes({ orderId, notes }: { orderId: string; notes: string }) {
  const { pending, run } = useAdminAction();
  const [value, setValue] = useState(notes);
  const dirty = value !== notes;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        run(() => updateOrderNotes({ orderId, notes: value }));
      }}
      className="space-y-3"
    >
      <Field label="Notes" hint="Includes any note the customer left at checkout. Not shown to the customer after placement.">
        <Textarea value={value} onChange={(e) => setValue(e.target.value)} maxLength={5000} />
      </Field>
      <Button size="sm" variant="outline" type="submit" disabled={pending || !dirty}>
        Save notes
      </Button>
    </form>
  );
}
