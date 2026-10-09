"use client";

import { useState } from "react";
import { codOutcomeAction, resendWhatsAppAction } from "@/actions/admin-whatsapp";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { useAdminAction } from "./use-admin-action";

type Notice = "confirmed" | "cod_reminder" | "shipped" | "out_for_delivery" | "delivered" | "cancelled";

const NOTICE_LABEL: Record<Notice, string> = {
  confirmed: "Order confirmed",
  cod_reminder: "COD confirmation request",
  shipped: "Shipped",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

export function WhatsAppResend({ orderId, notices }: { orderId: string; notices: Notice[] }) {
  const { pending, run } = useAdminAction();
  if (!notices.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[0.625rem] uppercase tracking-[0.2em] text-subtle">Resend</span>
      {notices.map((n) => (
        <Button key={n} size="sm" variant="outline" disabled={pending} onClick={() => run(() => resendWhatsAppAction({ orderId, notice: n }))}>
          {NOTICE_LABEL[n]}
        </Button>
      ))}
    </div>
  );
}

/** Staff log the outcome of a confirmation call. */
export function CodCallOutcome({ orderId, canCancel }: { orderId: string; canCancel: boolean }) {
  const { pending, run } = useAdminAction();
  const [note, setNote] = useState("");
  const [confirmCancel, setConfirmCancel] = useState(false);
  const go = (outcome: "confirmed" | "cancelled" | "no_answer") => run(() => codOutcomeAction({ orderId, outcome, note: note || undefined }), { onSuccess: () => setNote("") });
  return (
    <div className="space-y-3">
      <Field label="Call note (optional)">
        <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="e.g. spoke to customer, address confirmed" />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={pending} onClick={() => go("confirmed")}>
          Confirmed on call
        </Button>
        <Button size="sm" variant="outline" disabled={pending} onClick={() => go("no_answer")}>
          No answer
        </Button>
        {canCancel ? (
          confirmCancel ? (
            <>
              <Button size="sm" variant="danger" disabled={pending} onClick={() => go("cancelled")}>
                Yes, cancel order
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmCancel(false)}>
                Back
              </Button>
            </>
          ) : (
            <Button size="sm" variant="danger" disabled={pending} onClick={() => setConfirmCancel(true)}>
              Customer declined
            </Button>
          )
        ) : null}
      </div>
    </div>
  );
}
