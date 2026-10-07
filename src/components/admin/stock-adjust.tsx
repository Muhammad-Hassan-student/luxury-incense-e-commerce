"use client";

import { useState } from "react";
import { adjustInventory } from "@/actions/admin-inventory";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { useAdminAction } from "./use-admin-action";

/** ± stock adjustment. With `stock`/`reserved` it also refuses (client-side) to drop below what's held for orders; the server always checks. */
export function StockAdjust({ variantId, sku, stock, reserved }: { variantId: string; sku: string; stock?: number; reserved?: number }) {
  const { pending, run } = useAdminAction();
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState<"RESTOCK" | "ADJUST">("RESTOCK");
  const n = Number(delta);
  const belowReserved = stock !== undefined && reserved !== undefined && stock + n < reserved;
  const valid = delta.trim() !== "" && Number.isInteger(n) && n !== 0 && !(reason === "RESTOCK" && n < 0) && !belowReserved;

  return (
    <form
      className="flex items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        run(() => adjustInventory({ variantId, delta: n, reason }), { onSuccess: () => setDelta("") });
      }}
    >
      <label className="w-20">
        <span className="sr-only">Change in stock for {sku}</span>
        <Input type="number" step={1} inputMode="numeric" placeholder="±0" value={delta} onChange={(e) => setDelta(e.target.value)} className="py-1.5 tabular-nums" aria-invalid={belowReserved || undefined} title={belowReserved ? `Can't go below ${reserved} reserved` : undefined} />
      </label>
      <label className="w-28">
        <span className="sr-only">Reason for {sku}</span>
        <Select value={reason} onChange={(e) => setReason(e.target.value as "RESTOCK" | "ADJUST")} className="py-1.5 text-xs">
          <option value="RESTOCK">Restock</option>
          <option value="ADJUST">Adjust</option>
        </Select>
      </label>
      <Button type="submit" size="sm" variant="outline" disabled={!valid || pending} className="h-8 px-3">
        Apply
      </Button>
    </form>
  );
}
