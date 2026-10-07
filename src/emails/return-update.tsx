import { Button, Heading, Section, Text } from "@react-email/components";
import { brand } from "@/config/brand";
import { formatMoney } from "@/lib/money";
import { refundMethodText } from "@/lib/returns";
import { EmailLayout, button, colors, h1, p, serif, siteUrl } from "./layout";

export type ReturnEmailKind = "requested" | "approved" | "rejected" | "received" | "refunded" | "credited" | "exchanged";

export type ReturnEmailProps = {
  kind: ReturnEmailKind;
  number: string;
  orderNumber: string;
  items: { name: string; label: string; quantity: number }[];
  /** Refunded / credited amount (minor units) */
  amount?: number;
  fee?: number;
  refundMethod?: string | null;
  rejectionReason?: string | null;
  giftCardCode?: string | null;
  exchangeOrderNumber?: string | null;
};

const titles: Record<ReturnEmailKind, string> = {
  requested: "We’ve received your return request",
  approved: "Your return is approved",
  rejected: "About your return request",
  received: "Your return has arrived",
  refunded: "Your refund is on its way",
  credited: "Your store credit is ready",
  exchanged: "Your replacement is being prepared",
};

/** Customer emails for every step of a return, one template with variants. */
export function ReturnEmail(r: ReturnEmailProps) {
  const strong = { color: colors.fg };
  return (
    <EmailLayout preview={`${r.number} · ${titles[r.kind]}`}>
      <Heading style={h1}>{titles[r.kind]}</Heading>
      <Text style={p}>
        Return <strong style={strong}>{r.number}</strong> for order <strong style={strong}>{r.orderNumber}</strong>
      </Text>
      <Text style={p}>
        {r.items.map((i) => (
          <span key={`${i.name}-${i.label}`}>
            {i.quantity} × {i.name} <span style={{ color: colors.muted }}>({i.label})</span>
            <br />
          </span>
        ))}
      </Text>

      {r.kind === "requested" && <Text style={p}>Our concierge will review your request within two working days and write to you with next steps. Please keep the pieces in their original packaging until then.</Text>}
      {r.kind === "approved" && (
        <Text style={p}>
          Please pack the pieces securely, write <strong style={strong}>{r.number}</strong> on the parcel and send it to our atelier. Reply to this email if you’d like us to arrange a pickup. We’ll let you know as soon as it arrives.
        </Text>
      )}
      {r.kind === "rejected" && (
        <>
          <Text style={p}>We’re sorry — we can’t accept this return.</Text>
          {r.rejectionReason && <Text style={{ ...p, fontFamily: serif, fontSize: 18, fontStyle: "italic", color: colors.fg }}>“{r.rejectionReason}”</Text>}
          <Text style={p}>If you think we’ve got this wrong, reply to this email and we’ll take another look.</Text>
        </>
      )}
      {r.kind === "received" && <Text style={p}>Your parcel has reached the atelier and has been inspected. We’ll complete your return shortly.</Text>}
      {r.kind === "refunded" && r.amount !== undefined && (
        <Text style={p}>
          We’ve refunded <strong style={strong}>{formatMoney(r.amount)}</strong>
          {r.refundMethod ? ` (${refundMethodText(r.refundMethod)})` : ""}.
          {r.fee ? ` A restocking fee of ${formatMoney(r.fee)} was deducted.` : ""}
          {r.refundMethod?.includes("MANUAL") ? " Our team will be in touch to arrange the transfer." : " Banks usually take 5–7 working days to show it."}
        </Text>
      )}
      {r.kind === "credited" && r.amount !== undefined && (
        <>
          <Text style={p}>
            We’ve issued <strong style={strong}>{formatMoney(r.amount)}</strong> in store credit{r.fee ? ` (after a ${formatMoney(r.fee)} restocking fee)` : ""}. Use this code at checkout:
          </Text>
          {r.giftCardCode && (
            <Section style={{ border: `1px solid ${colors.gold}`, padding: "20px 24px", margin: "20px 0", textAlign: "center" }}>
              <Text style={{ fontSize: 18, letterSpacing: "0.2em", color: colors.gold, margin: 0 }}>{r.giftCardCode}</Text>
            </Section>
          )}
        </>
      )}
      {r.kind === "exchanged" && (
        <Text style={p}>
          A replacement {r.exchangeOrderNumber ? <>(order <strong style={strong}>{r.exchangeOrderNumber}</strong>) </> : null}is being wrapped for you at no charge. We’ll email tracking as soon as it ships.
        </Text>
      )}

      <Button href={`${siteUrl()}/account/orders/${r.orderNumber}`} style={button}>
        View your order
      </Button>
      <Text style={{ ...p, marginTop: 24 }}>Questions? Reply to this email or write to {brand.email}.</Text>
    </EmailLayout>
  );
}

export type ReturnStaffEmailProps = {
  id: string;
  number: string;
  orderNumber: string;
  email: string;
  reason: string;
  preferred: string;
  note: string | null;
  items: { name: string; label: string; quantity: number }[];
};

/** Heads-up for staff with returns.manage when a customer asks for a return. */
export function ReturnStaffEmail(r: ReturnStaffEmailProps) {
  return (
    <EmailLayout preview={`New return request ${r.number} on ${r.orderNumber}`}>
      <Heading style={h1}>New return request</Heading>
      <Text style={p}>
        <span style={{ color: colors.gold }}>{r.number}</span> · order {r.orderNumber}
        <br />
        {r.email}
        <br />
        {r.reason} · wants {r.preferred.toLowerCase()}
      </Text>
      <Text style={p}>
        {r.items.map((i) => (
          <span key={`${i.name}-${i.label}`}>
            {i.quantity} × {i.name} ({i.label})
            <br />
          </span>
        ))}
      </Text>
      {r.note ? <Text style={{ ...p, fontStyle: "italic", color: colors.fg }}>“{r.note}”</Text> : null}
      <Button href={`${siteUrl()}/admin/returns/${r.id}`} style={button}>
        Review in admin
      </Button>
    </EmailLayout>
  );
}
