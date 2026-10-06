import { Button, Heading, Section, Text } from "@react-email/components";
import type { GiftCard } from "@/generated/prisma/client";
import { formatMoney } from "@/lib/money";
import { brand } from "@/config/brand";
import { EmailLayout, button, colors, h1, p, serif, siteUrl } from "./layout";

export function GiftCardEmail({ card }: { card: GiftCard }) {
  return (
    <EmailLayout preview={`A ${formatMoney(card.initial)} gift card${card.senderName ? ` from ${card.senderName}` : ""}`}>
      <Heading style={h1}>{card.recipient ? `For ${card.recipient}` : "A gift for you"}</Heading>
      <Text style={p}>
        {card.senderName ? `${card.senderName} has sent you` : "You’ve received"} a {brand.name} gift card, to spend on anything in the house.
      </Text>
      {card.message && (
        <Text style={{ ...p, fontFamily: serif, fontSize: 20, fontStyle: "italic", color: colors.fg, lineHeight: "30px" }}>“{card.message}”</Text>
      )}
      <Section style={{ border: `1px solid ${colors.gold}`, padding: "28px 24px", margin: "28px 0", textAlign: "center" }}>
        <Text style={{ fontFamily: serif, fontSize: 40, color: colors.gold, margin: "0 0 8px" }}>{formatMoney(card.initial)}</Text>
        <Text style={{ fontSize: 18, letterSpacing: "0.2em", color: colors.fg, margin: 0 }}>{card.code}</Text>
        {card.expiresAt && (
          <Text style={{ fontSize: 11, color: colors.muted, margin: "12px 0 0" }}>
            Valid until {card.expiresAt.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
          </Text>
        )}
      </Section>
      <Text style={p}>Enter the code at checkout. Any balance you don’t use stays on the card for next time.</Text>
      <Button href={`${siteUrl()}/shop`} style={button}>
        Explore the house
      </Button>
    </EmailLayout>
  );
}
