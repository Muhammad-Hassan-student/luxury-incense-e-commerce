import type { NextRequest } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/server/roles";
import { audit } from "@/server/audit";
import { ordersCsv } from "@/server/invoices";

const ymd = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), "Invalid date");

const querySchema = z.object({
  status: z.enum(["PENDING", "PAID", "PACKED", "SHIPPED", "DELIVERED", "CANCELLED", "REFUNDED"]).optional(),
  from: ymd.optional(),
  to: ymd.optional(),
});

/** GET ?status=&from=YYYY-MM-DD&to=YYYY-MM-DD → orders CSV (max 10k rows, newest first). Dates are inclusive, in IST. */
export async function GET(req: NextRequest) {
  const access = await requirePermission("orders.export");
  const params = Object.fromEntries([...req.nextUrl.searchParams].filter(([, v]) => v !== ""));
  const parsed = querySchema.safeParse(params);
  if (!parsed.success) return Response.json({ error: "Invalid filters. Use status=PAID&from=2026-01-01&to=2026-01-31." }, { status: 400 });
  const { status, from, to } = parsed.data;

  const { csv, count, truncated } = await ordersCsv({
    status,
    from: from ? new Date(`${from}T00:00:00+05:30`) : undefined,
    to: to ? new Date(`${to}T23:59:59.999+05:30`) : undefined,
  });
  await audit(access.id, "orders.export", "Order", null, { status: status ?? null, from: from ?? null, to: to ?? null, count }).catch(() => {});

  const name = ["orders", status?.toLowerCase(), from, to].filter(Boolean).join("_");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}.csv"`,
      "Cache-Control": "private, no-store",
      "X-Row-Count": String(count),
      ...(truncated && { "X-Truncated": "true" }),
    },
  });
}
