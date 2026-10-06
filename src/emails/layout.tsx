import type { ReactNode } from "react";
import { Body, Container, Head, Hr, Html, Preview, Section, Text } from "@react-email/components";
import { brand } from "@/config/brand";

export const colors = { bg: "#0b0a09", panel: "#14110f", fg: "#f3ede4", muted: "#a89d8e", gold: "#c8a46a", line: "#2a2520" };
export const serif = "'Cormorant Garamond', Georgia, 'Times New Roman', serif";
export const sans = "Inter, -apple-system, 'Segoe UI', Arial, sans-serif";

export const siteUrl = () => process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export function EmailLayout({ preview, children }: { preview: string; children: ReactNode }) {
  return (
    <Html>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={{ background: colors.bg, margin: 0, padding: "40px 0", fontFamily: sans, color: colors.fg }}>
        <Container style={{ maxWidth: 560, background: colors.panel, padding: "48px 40px", border: `1px solid ${colors.line}` }}>
          <Text style={{ fontFamily: serif, fontSize: 28, letterSpacing: "0.2em", textAlign: "center", color: colors.gold, margin: 0 }}>
            {brand.name.toUpperCase()}
          </Text>
          <Hr style={{ borderColor: colors.line, margin: "28px 0" }} />
          <Section>{children}</Section>
          <Hr style={{ borderColor: colors.line, margin: "32px 0 20px" }} />
          <Text style={{ fontSize: 11, color: colors.muted, textAlign: "center", letterSpacing: "0.12em" }}>
            {brand.tagline} · {brand.email}
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export const h1 = { fontFamily: serif, fontSize: 32, fontWeight: 300, margin: "0 0 12px", color: colors.fg };
export const p = { fontSize: 14, lineHeight: "24px", color: colors.muted, margin: "0 0 16px" };
export const button = {
  background: colors.gold,
  color: colors.bg,
  padding: "14px 28px",
  fontSize: 12,
  letterSpacing: "0.24em",
  textTransform: "uppercase" as const,
  textDecoration: "none",
};
