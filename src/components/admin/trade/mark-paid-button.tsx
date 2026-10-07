"use client";

import { useState } from "react";
import { markTradeInvoicePaid } from "@/actions/admin-trade";
import { Button } from "@/components/ui/button";
import { useAdminAction } from "@/components/admin/use-admin-action";

/**
 * "Mark invoice paid" for trade orders (needs trade.manage). Two-step to avoid slips.
 * Render only for orders with a tradeAccountId and no paidAt; the server re-checks everything.
 */
export function MarkTradeInvoicePaidButton({ orderId, amount, dueDate }: { orderId: string; amount: string; dueDate?: string | null }) {
  const { pending, run } = useAdminAction();
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">
        Trade invoice unpaid{dueDate ? ` · due ${dueDate}` : ""}. Record payment once the bank transfer has arrived.
      </p>
      {confirming ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm">Received {amount}?</span>
          <Button size="sm" disabled={pending} onClick={() => run(() => markTradeInvoicePaid(orderId), { onSuccess: () => setConfirming(false) })}>
            {pending ? "Saving…" : "Yes, mark paid"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirming(false)} disabled={pending}>
            Cancel
          </Button>
        </div>
      ) : (
        <Button size="sm" variant="outline" onClick={() => setConfirming(true)}>
          Mark invoice paid
        </Button>
      )}
    </div>
  );
}
