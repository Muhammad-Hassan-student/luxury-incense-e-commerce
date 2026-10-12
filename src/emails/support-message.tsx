import { Button, Heading, Section, Text } from "@react-email/components";
import { EmailLayout, button, colors, h1, p, siteUrl } from "./layout";

/** Support desk email: an intro line, the message itself (line breaks kept) and an optional button. */
export function SupportMessageEmail({ preview, title, intro, message, cta }: { preview: string; title: string; intro: string; message?: string; cta?: { label: string; path: string } }) {
  return (
    <EmailLayout preview={preview}>
      <Heading style={h1}>{title}</Heading>
      <Text style={p}>{intro}</Text>
      {message ? (
        <Section style={{ borderLeft: `2px solid ${colors.gold}`, padding: "4px 0 4px 16px", margin: "0 0 20px" }}>
          <Text style={{ ...p, color: colors.fg, whiteSpace: "pre-line", margin: 0 }}>{message}</Text>
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
