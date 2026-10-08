import { Button, Heading, Link, Section, Text } from "@react-email/components";
import { EmailLayout, button, colors, h1, p, serif, siteUrl } from "./layout";

export type JourneyEmailProps = {
  preview: string;
  title: string;
  paragraphs: string[];
  cta?: { label: string; path: string };
  /** Personal single-use code. */
  coupon?: { code: string; percent: number; expires: string };
  /** Bonus loyalty points granted with this message. */
  points?: { amount: number; name: string };
  products?: { name: string; path: string; note?: string | null }[];
  /** Signed one-click link — every journey email carries it. */
  unsubscribeUrl: string;
};

const small = { fontSize: 11, lineHeight: "18px", color: colors.muted, margin: "24px 0 0", textAlign: "center" as const };

/** Customer journey emails (welcome, review request, win-back, VIP, lapsed): one shape, different words. */
export function JourneyEmail({ preview, title, paragraphs, cta, coupon, points, products, unsubscribeUrl }: JourneyEmailProps) {
  return (
    <EmailLayout preview={preview}>
      <Heading style={h1}>{title}</Heading>
      {paragraphs.map((t, i) => (
        <Text key={i} style={p}>
          {t}
        </Text>
      ))}
      {points ? (
        <Section style={{ border: `1px solid ${colors.line}`, padding: "20px 24px", margin: "8px 0 24px", textAlign: "center" }}>
          <Text style={{ ...p, margin: 0, fontSize: 11, letterSpacing: "0.2em", textTransform: "uppercase" }}>Added to your account</Text>
          <Text style={{ fontFamily: serif, fontSize: 36, color: colors.gold, margin: "8px 0 0" }}>
            +{points.amount} {points.name}
          </Text>
        </Section>
      ) : null}
      {coupon ? (
        <Section style={{ border: `1px solid ${colors.gold}`, padding: "20px 24px", margin: "8px 0 24px", textAlign: "center" }}>
          <Text style={{ ...p, margin: 0, fontSize: 11, letterSpacing: "0.2em", textTransform: "uppercase" }}>{coupon.percent}% off · just for you</Text>
          <Text style={{ fontFamily: serif, fontSize: 30, letterSpacing: "0.12em", color: colors.gold, margin: "8px 0 4px" }}>{coupon.code}</Text>
          <Text style={{ ...p, margin: 0, fontSize: 12 }}>Single use, for this email address only · expires {coupon.expires}</Text>
        </Section>
      ) : null}
      {products?.length ? (
        <Section style={{ margin: "0 0 24px" }}>
          {products.map((x) => (
            <Text key={x.path} style={{ ...p, margin: "0 0 8px" }}>
              <Link href={`${siteUrl()}${x.path}`} style={{ color: colors.gold, textDecoration: "none" }}>
                {x.name}
              </Link>
              {x.note ? <span style={{ color: colors.muted }}> — {x.note}</span> : null}
            </Text>
          ))}
        </Section>
      ) : null}
      {cta ? (
        <Button href={`${siteUrl()}${cta.path}`} style={button}>
          {cta.label}
        </Button>
      ) : null}
      <Text style={small}>
        You’re receiving this because you shop with us. Prefer fewer letters?{" "}
        <Link href={unsubscribeUrl} style={{ color: colors.muted, textDecoration: "underline" }}>
          Unsubscribe from these emails
        </Link>
        . Order and delivery updates are not affected.
      </Text>
    </EmailLayout>
  );
}
