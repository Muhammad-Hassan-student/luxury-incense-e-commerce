import { Button, Heading, Text } from "@react-email/components";
import { EmailLayout, button, h1, p, siteUrl } from "./layout";

/** Abandoned-bag reminder, back-in-stock alert, newsletter welcome: same shape, different words. */
export function SimpleEmail({ preview, title, body, cta }: { preview: string; title: string; body: string; cta?: { label: string; path: string } }) {
  return (
    <EmailLayout preview={preview}>
      <Heading style={h1}>{title}</Heading>
      <Text style={p}>{body}</Text>
      {cta && (
        <Button href={`${siteUrl()}${cta.path}`} style={button}>
          {cta.label}
        </Button>
      )}
    </EmailLayout>
  );
}
