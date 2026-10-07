import { Button, Column, Heading, Hr, Row, Section, Text } from "@react-email/components";
import { EmailLayout, button, colors, h1, p, siteUrl } from "./layout";

/**
 * Every trade notification (application received/approved/rejected, suspension, staff alerts,
 * invoice issued/paid): a title, a few paragraphs, optional key/value details and one call to action.
 */
export function TradeNoticeEmail({
  preview,
  eyebrow = "Maison Oud Trade",
  title,
  paragraphs,
  details,
  cta,
}: {
  preview: string;
  eyebrow?: string;
  title: string;
  paragraphs: string[];
  details?: [string, string][];
  cta?: { label: string; path: string };
}) {
  return (
    <EmailLayout preview={preview}>
      <Text style={{ fontSize: 10, letterSpacing: "0.3em", textTransform: "uppercase", color: colors.gold, margin: "0 0 12px" }}>{eyebrow}</Text>
      <Heading style={h1}>{title}</Heading>
      {paragraphs.map((t, i) => (
        <Text key={i} style={p}>
          {t}
        </Text>
      ))}
      {details?.length ? (
        <Section style={{ margin: "8px 0 24px" }}>
          <Hr style={{ borderColor: colors.line, margin: "0 0 8px" }} />
          {details.map(([k, v]) => (
            <Row key={k}>
              <Column style={{ fontSize: 12, color: colors.muted, padding: "6px 0", letterSpacing: "0.04em" }}>{k}</Column>
              <Column style={{ fontSize: 13, color: colors.fg, padding: "6px 0", textAlign: "right" }}>{v}</Column>
            </Row>
          ))}
          <Hr style={{ borderColor: colors.line, margin: "8px 0 0" }} />
        </Section>
      ) : null}
      {cta ? (
        <Button href={`${siteUrl()}${cta.path}`} style={button}>
          {cta.label}
        </Button>
      ) : null}
    </EmailLayout>
  );
}
