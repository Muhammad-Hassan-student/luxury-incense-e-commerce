import { Button, Column, Heading, Hr, Row, Text } from "@react-email/components";
import type { Order, OrderItem } from "@/generated/prisma/client";
import { formatMoney } from "@/lib/money";
import { EmailLayout, button, colors, h1, p, siteUrl } from "./layout";

const line = (label: string, value: string, strong = false) => (
  <Row>
    <Column style={{ fontSize: 13, color: strong ? colors.fg : colors.muted, padding: "4px 0" }}>{label}</Column>
    <Column style={{ fontSize: 13, color: colors.fg, textAlign: "right", fontWeight: strong ? 600 : 400 }}>{value}</Column>
  </Row>
);

export function OrderConfirmationEmail({ order }: { order: Order & { items: OrderItem[] } }) {
  const addr = order.shippingAddress as { fullName: string; line1: string; city: string; postalCode: string; country: string };
  return (
    <EmailLayout preview={`Order ${order.number} is confirmed`}>
      <Heading style={h1}>Thank you, {addr.fullName.split(" ")[0]}</Heading>
      <Text style={p}>
        Order <strong style={{ color: colors.fg }}>{order.number}</strong> is confirmed. We’ll wrap it by hand and write again
        when it ships.
      </Text>
      {order.items.map((i) => (
        <Row key={i.id}>
          <Column style={{ fontSize: 14, color: colors.fg, padding: "8px 0" }}>
            {i.name}
            <br />
            <span style={{ fontSize: 12, color: colors.muted }}>
              {i.label} × {i.quantity}
              {(i.meta as { giftCard?: { recipientName: string } } | null)?.giftCard && ` · emailed to ${(i.meta as { giftCard: { recipientName: string } }).giftCard.recipientName}`}
            </span>
          </Column>
          <Column style={{ fontSize: 14, textAlign: "right", color: colors.fg }}>{formatMoney(i.unitPrice * i.quantity)}</Column>
        </Row>
      ))}
      <Hr style={{ borderColor: colors.line }} />
      {line("Subtotal", formatMoney(order.subtotal))}
      {order.discount > 0 && line(`Discount${order.couponCode ? ` (${order.couponCode})` : ""}`, `−${formatMoney(order.discount)}`)}
      {order.pointsRedeemed > 0 && line("Points", `−${formatMoney(order.pointsRedeemed * 100)}`)}
      {line("Shipping & wrapping", order.shipping ? formatMoney(order.shipping) : "Complimentary")}
      {line("Total", formatMoney(order.total), true)}
      {order.giftCardAmount > 0 && line("Paid by gift card", `−${formatMoney(order.giftCardAmount)}`)}
      {order.giftCardAmount > 0 && line("Charged", formatMoney(order.total - order.giftCardAmount), true)}
      <Text style={{ ...p, fontSize: 12 }}>Includes {formatMoney(order.tax)} tax.</Text>
      <Text style={p}>
        Shipping to {addr.line1}, {addr.city} {addr.postalCode}, {addr.country}
      </Text>
      <Button href={`${siteUrl()}/account/orders/${order.number}`} style={button}>
        View order
      </Button>
    </EmailLayout>
  );
}
