import type { OrderStatus } from "@/generated/prisma/enums";
import { Badge } from "@/components/ui/field";

const label: Record<OrderStatus, string> = {
  PENDING: "Confirmed",
  PAID: "Confirmed",
  PACKED: "Packed",
  SHIPPED: "Shipped",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
  REFUNDED: "Refunded",
};

/** Customer-facing status. Orders still awaiting online payment are hidden from account lists. */
export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const tone = status === "CANCELLED" || status === "REFUNDED" ? "ember" : status === "DELIVERED" ? "muted" : "gold";
  return <Badge tone={tone}>{label[status]}</Badge>;
}
