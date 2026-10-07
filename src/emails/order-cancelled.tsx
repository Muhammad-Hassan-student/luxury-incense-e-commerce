import { Button, Heading, Text } from "@react-email/components";
import type { Order } from "@/generated/prisma/client";
import { brand } from "@/config/brand";
import { formatMoney } from "@/lib/money";
import { EmailLayout, button, colors, h1, p, siteUrl } from "./layout";

/** Sent when a customer cancels their own order from their account. */
export function OrderCancelledEmail({ order, refunded, reason }: { order: Pick<Order, "number" | "total" | "giftCardAmount">; refunded: boolean; reason: string | null }) {
  const paid = order.total - order.giftCardAmount;
  return (
    <EmailLayout preview={`Order ${order.number} has been cancelled`}>
      <Heading style={h1}>Your order is cancelled</Heading>
      <Text style={p}>
        As you asked, we’ve cancelled order <strong style={{ color: colors.fg }}>{order.number}</strong>
        {reason ? ` (${reason.toLowerCase()})` : ""}. Nothing will be sent.
      </Text>
      {refunded && paid > 0 && (
        <Text style={p}>
          A full refund of <strong style={{ color: colors.fg }}>{formatMoney(paid)}</strong> is on its way to your original payment method. Banks usually take 5–7 working days to show it.
        </Text>
      )}
      {order.giftCardAmount > 0 && (
        <Text style={p}>The {formatMoney(order.giftCardAmount)} paid by gift card has been returned to the card’s balance.</Text>
      )}
      <Text style={p}>Any {brand.loyalty.name} earned or redeemed on this order have been reversed.</Text>
      <Button href={`${siteUrl()}/account/orders/${order.number}`} style={button}>
        View order
      </Button>
      <Text style={{ ...p, marginTop: 24 }}>Didn’t mean to cancel? Reply to this email or write to {brand.email} and we’ll help.</Text>
    </EmailLayout>
  );
}
