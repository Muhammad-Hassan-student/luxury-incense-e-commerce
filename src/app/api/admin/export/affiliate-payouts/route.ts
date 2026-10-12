import { can, getAccess } from "@/server/roles";
import { audit } from "@/server/audit";
import { payoutCsv } from "@/server/affiliates";

export const dynamic = "force-dynamic";

/** One payout batch as CSV (affiliate, payout details, amount) for the bank / UPI bulk upload. */
export async function GET(req: Request) {
  const access = await getAccess();
  if (!access) return new Response("Sign in required", { status: 401 });
  if (!can(access, "affiliates.manage")) return new Response("Not allowed", { status: 403 });
  const batch = new URL(req.url).searchParams.get("batch") ?? "";
  if (!/^PAY-\d{8}-[A-Z0-9]{6}$/.test(batch)) return new Response("Unknown batch", { status: 400 });
  const csv = await payoutCsv(batch);
  await audit(access.id, "affiliate.payout_export", "AffiliatePayout", batch);
  return new Response("﻿" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="affiliate-payouts-${batch}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
