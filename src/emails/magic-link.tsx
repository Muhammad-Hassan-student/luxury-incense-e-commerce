import { Button, Heading, Text } from "@react-email/components";
import { EmailLayout, button, h1, p } from "./layout";

export function MagicLinkEmail({ url }: { url: string }) {
  return (
    <EmailLayout preview="Your sign-in link">
      <Heading style={h1}>Welcome back</Heading>
      <Text style={p}>Use the button below to sign in. The link works once and expires in 24 hours.</Text>
      <Button href={url} style={button}>
        Sign in
      </Button>
      <Text style={{ ...p, marginTop: 24, fontSize: 12 }}>If you didn’t ask for this, you can ignore this email.</Text>
    </EmailLayout>
  );
}
