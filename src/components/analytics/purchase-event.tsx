"use client";

import { useEffect } from "react";
import { track, type TrackItem } from "@/lib/analytics";

/**
 * Browser Purchase on the thank-you page, once per order per browser. Its event id matches the server-side
 * Conversions API event (purchaseEventId), so Meta keeps one; GA4 deduplicates on transaction_id.
 */
export function PurchaseEvent({ number, value, currency, items }: { number: string; value: number; currency: string; items: TrackItem[] }) {
  useEffect(() => {
    const key = `mo:purchase:${number}`;
    try {
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, "1");
    } catch {
      // Storage blocked: Meta/GA still deduplicate on the ids.
    }
    track("purchase", { items, value, currency, transactionId: number });
  }, [number, value, currency, items]);
  return null;
}
