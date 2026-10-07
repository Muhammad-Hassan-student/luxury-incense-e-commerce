import { Button, Column, Heading, Hr, Row, Section, Text } from "@react-email/components";
import { formatMoney } from "@/lib/money";
import { EmailLayout, button, colors, h1, p, siteUrl } from "./layout";

export type TradeQuoteEmailLine = { description: string; quantity: number; quotedPrice: number | null };

const head = { fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase" as const, color: colors.muted, padding: "0 0 8px", borderBottom: `1px solid ${colors.line}` };
const cell = { fontSize: 13, color: colors.fg, padding: "8px 0", borderBottom: `1px solid ${colors.line}` };
const num = { textAlign: "right" as const, width: 96 };

/** Our reply to a request for quotation: per-line prices, validity and a note. */
export function TradeQuoteEmail({
  number,
  businessName,
  lines,
  validUntil,
  message,
}: {
  number: string;
  businessName: string;
  lines: TradeQuoteEmailLine[];
  validUntil: string | null;
  message: string | null;
}) {
  const total = lines.reduce((s, l) => s + (l.quotedPrice ?? 0) * l.quantity, 0);
  return (
    <EmailLayout preview={`Your quote ${number} is ready`}>
      <Text style={{ fontSize: 10, letterSpacing: "0.3em", textTransform: "uppercase", color: colors.gold, margin: "0 0 12px" }}>Maison Oud Trade</Text>
      <Heading style={h1}>Quote {number}</Heading>
      <Text style={p}>
        Prepared for {businessName}.{validUntil ? ` These prices hold until ${validUntil}.` : ""} Accept it from your trade portal and we’ll raise the order at these prices.
      </Text>
      {message ? <Text style={{ ...p, color: colors.fg, fontStyle: "italic" }}>“{message}”</Text> : null}
      <Section>
        <Row>
          <Column style={head}>Item</Column>
          <Column style={{ ...head, ...num }}>Qty</Column>
          <Column style={{ ...head, ...num }}>Unit</Column>
        </Row>
        {lines.map((l, i) => (
          <Row key={i}>
            <Column style={cell}>{l.description}</Column>
            <Column style={{ ...cell, ...num }}>{l.quantity}</Column>
            <Column style={{ ...cell, ...num, color: colors.gold }}>{l.quotedPrice != null ? formatMoney(l.quotedPrice) : "—"}</Column>
          </Row>
        ))}
      </Section>
      <Hr style={{ borderColor: colors.line }} />
      <Text style={{ ...p, color: colors.fg, textAlign: "right" }}>Goods total {formatMoney(total)} · shipping and tax added at acceptance</Text>
      <Button href={`${siteUrl()}/trade/portal/quotes/${number}`} style={button}>
        Review quote
      </Button>
    </EmailLayout>
  );
}
