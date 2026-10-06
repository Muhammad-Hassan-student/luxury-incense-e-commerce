import { Button, Heading, Text } from "@react-email/components";
import type { Order } from "@/generated/prisma/client";
import { EmailLayout, button, colors, h1, p, siteUrl } from "./layout";

const copy: Record<string, { title: string; body: string }> = {
  SHIPPED: { title: "It’s on its way", body: "Your order has left the atelier." },
  DELIVERED: { title: "Delivered", body: "Your order has arrived. We hope it brings a slower, warmer evening." },
};

export function OrderStatusEmail({ order }: { order: Order }) {
  const c = copy[order.status] ?? { title: "An update on your order", body: `Status: ${order.status.toLowerCase()}.` };
  return (
    <EmailLayout preview={`${order.number}: ${c.title}`}>
      <Heading style={h1}>{c.title}</Heading>
      <Text style={p}>{c.body}</Text>
      {order.trackingNumber && (
        <Text style={p}>
          {order.carrier ? `${order.carrier} · ` : ""}Tracking <strong style={{ color: colors.fg }}>{order.trackingNumber}</strong>
        </Text>
      )}
      <Button href={`${siteUrl()}/account/orders/${order.number}`} style={button}>
        Track order
      </Button>
    </EmailLayout>
  );
}
