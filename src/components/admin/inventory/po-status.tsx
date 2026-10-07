import type { PurchaseOrderStatus } from "@/generated/prisma/enums";
import { Badge } from "@/components/ui/field";

export const PO_STATUSES: PurchaseOrderStatus[] = ["DRAFT", "ORDERED", "PARTIAL", "RECEIVED", "CANCELLED"];

export const PO_STATUS_LABEL: Record<PurchaseOrderStatus, string> = {
  DRAFT: "Draft",
  ORDERED: "Ordered",
  PARTIAL: "Part received",
  RECEIVED: "Received",
  CANCELLED: "Cancelled",
};

export function PoStatusBadge({ status }: { status: PurchaseOrderStatus }) {
  const tone = status === "CANCELLED" ? "ember" : status === "RECEIVED" || status === "DRAFT" ? "muted" : "gold";
  return <Badge tone={tone}>{PO_STATUS_LABEL[status]}</Badge>;
}
