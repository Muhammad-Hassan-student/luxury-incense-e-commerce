import Link from "next/link";
import { db } from "@/server/db";
import { requireUser } from "@/server/roles";
import { Price } from "@/components/money";
import { OrderStatusBadge } from "@/components/account/order-status";

export default async function OrdersPage() {
  const user = await requireUser("/account/orders");
  // Hide orders still awaiting online payment; they appear once confirmed.
  const orders = await db.order.findMany({
    where: { userId: user.id, reservedUntil: null, NOT: { status: "CANCELLED", payments: { every: { status: { in: ["FAILED", "CREATED"] } } } } },
    orderBy: { placedAt: "desc" },
    include: { items: { select: { name: true, quantity: true } } },
  });
  if (!orders.length) {
    return (
      <p className="text-muted">
        No orders yet. <Link href="/shop" className="link-draw text-gold">Explore the house</Link>
      </p>
    );
  }
  return (
    <ul className="divide-y divide-line border-y border-line">
      {orders.map((o) => (
        <li key={o.id}>
          <Link href={`/account/orders/${o.number}`} className="grid gap-3 py-6 transition-colors hover:text-gold md:grid-cols-[10rem_1fr_auto_auto] md:items-center md:gap-8">
            <span className="font-display text-2xl">{o.number}</span>
            <span className="truncate text-sm text-muted">
              {o.placedAt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })} · {o.items.map((i) => `${i.name} × ${i.quantity}`).join(", ")}
            </span>
            <OrderStatusBadge status={o.status} />
            <Price amount={o.total} />
          </Link>
        </li>
      ))}
    </ul>
  );
}
