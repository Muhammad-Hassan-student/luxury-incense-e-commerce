import { Button, Heading, Text } from "@react-email/components";
import { EmailLayout, button, colors, h1, p } from "./layout";

/** Courier milestones the order-status email doesn't cover (out for delivery). */
export function ShipmentUpdateEmail({
  number,
  title,
  body,
  courier,
  awb,
  trackUrl,
  codDue,
}: {
  number: string;
  title: string;
  body: string;
  courier: string | null;
  awb: string | null;
  trackUrl: string;
  /** Formatted amount to pay on delivery, if any */
  codDue: string | null;
}) {
  return (
    <EmailLayout preview={`${number}: ${title}`}>
      <Heading style={h1}>{title}</Heading>
      <Text style={p}>{body}</Text>
      {awb && (
        <Text style={p}>
          {courier ? `${courier} · ` : ""}AWB <strong style={{ color: colors.fg }}>{awb}</strong>
        </Text>
      )}
      {codDue && (
        <Text style={p}>
          Please keep <strong style={{ color: colors.fg }}>{codDue}</strong> ready — cash on delivery.
        </Text>
      )}
      <Button href={trackUrl} style={button}>
        Track parcel
      </Button>
    </EmailLayout>
  );
}
