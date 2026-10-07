import type { NextRequest } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/server/roles";
import { audit } from "@/server/audit";
import { getSalesSeries, getTopProducts, resolveRange, storeTimeZone } from "@/server/analytics";
import { csvRow, rupees } from "@/server/invoices";

const querySchema = z.object({
  range: z.string().max(10).optional(),
  from: z.string().max(10).optional(),
  to: z.string().max(10).optional(),
  type: z.enum(["daily", "products"]).default("daily"),
});

const pct = (v: number | null) => (v == null ? "" : (v * 100).toFixed(1));

/**
 * GET ?range=7d|30d|90d|12m (or range=custom&from=YYYY-MM-DD&to=YYYY-MM-DD) &type=daily|products → CSV.
 * daily: net revenue and orders per day (per week over 90 days); products: top 200 products by revenue with margin.
 */
export async function GET(req: NextRequest) {
  const access = await requirePermission("reports.view");
  const params = Object.fromEntries([...req.nextUrl.searchParams].filter(([, v]) => v !== ""));
  const parsed = querySchema.safeParse(params);
  if (!parsed.success) return Response.json({ error: "Invalid parameters. Use range=30d&type=daily or type=products." }, { status: 400 });
  const { type, ...rangeParams } = parsed.data;
  const range = resolveRange(rangeParams, await storeTimeZone());

  let lines: string[];
  if (type === "daily") {
    const series = await getSalesSeries(range);
    lines = [
      csvRow([range.granularity === "week" ? "Week starting" : "Date", "Orders", "Net revenue"]),
      ...series.map((p) => csvRow([p.date, p.orders, rupees(p.revenue)])),
    ];
  } else {
    const products = await getTopProducts(range, 200);
    lines = [
      csvRow(["Rank", "Product", "Units", "Orders", "Revenue", "Costed revenue", "Cost", "Gross profit", "Margin %"]),
      ...products.map((p, i) =>
        csvRow([i + 1, p.name, p.units, p.orders, rupees(p.revenue), rupees(p.costedRevenue), rupees(p.cost), p.margin == null ? "" : rupees(p.margin), pct(p.marginRate)]),
      ),
    ];
  }
  await audit(access.id, "reports.export", "Report", null, { type, from: range.from, to: range.to, rows: lines.length - 1 }).catch(() => {});

  const name = `sales_${type}_${range.from}_${range.to}`;
  // BOM so Excel opens UTF-8 correctly; CRLF per RFC 4180.
  return new Response("﻿" + lines.join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}.csv"`,
      "Cache-Control": "private, no-store",
      "X-Row-Count": String(lines.length - 1),
    },
  });
}
