import { can, getAccess } from "@/server/roles";
import { audit } from "@/server/audit";
import { exportInventoryCsv } from "@/server/inventory-csv";

export const dynamic = "force-dynamic";

/** Stock sheet as CSV (sku, product, variant, barcode, stock, reserved, available, reorderPoint, reorderQty, costPrice ₹, supplier). */
export async function GET() {
  const access = await getAccess();
  if (!access) return new Response("Sign in required", { status: 401 });
  if (!can(access, "inventory.view")) return new Response("Not allowed", { status: 403 });
  const csv = await exportInventoryCsv();
  await audit(access.id, "inventory.export", "ProductVariant", null);
  const day = new Date().toISOString().slice(0, 10);
  return new Response("﻿" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="inventory-${day}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
