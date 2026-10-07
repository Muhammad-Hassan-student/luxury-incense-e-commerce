import { auth } from "@/auth";
import { getTradeAccountByUser, priceListCsv } from "@/server/trade";
import { rateLimit } from "@/server/rate-limit";

export const dynamic = "force-dynamic";

/** The signed-in approved buyer's price list as CSV (SKU, product, variant, case size, min qty, retail, trade price, available). */
export async function GET() {
  const session = await auth();
  if (!session?.user) return new Response("Sign in required", { status: 401 });
  const account = await getTradeAccountByUser(session.user.id);
  if (!account || account.status !== "APPROVED") return new Response("An approved trade account is required", { status: 403 });
  if (!(await rateLimit("trade-price-list", 20, 300)).ok) return new Response("Too many requests", { status: 429 });
  const { csv } = await priceListCsv(account.tier);
  const day = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="maison-oud-trade-prices-${day}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
