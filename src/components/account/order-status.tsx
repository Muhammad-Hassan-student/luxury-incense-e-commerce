import type { OrderStatus } from "@/generated/prisma/enums";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/field";

/** Customer-facing status. Orders still awaiting online payment are hidden from account lists. */
export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const t = useTranslations("orderStatus");
  const tone = status === "CANCELLED" || status === "REFUNDED" ? "ember" : status === "DELIVERED" ? "muted" : "gold";
  return <Badge tone={tone}>{t(status)}</Badge>;
}
