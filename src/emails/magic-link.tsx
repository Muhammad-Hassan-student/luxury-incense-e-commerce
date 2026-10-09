import { Button, Heading, Text } from "@react-email/components";
import { EmailLayout, button, h1, p } from "./layout";

export function MagicLinkEmail({ url, email }: { url: string; email?: string }) {
  return (
    <EmailLayout preview="Your Maison Oud sign-in link — it works once and expires in 24 hours.">
      <Heading style={h1}>Sign in to Maison Oud</Heading>
      <Text style={p}>
        Hello{email ? ` — this link signs in ${email}` : ""}. You asked to sign in to your Maison Oud account. Press the button below to
        continue; there’s no password to remember.
      </Text>
      <Button href={url} style={button}>
        Sign in to my account
      </Button>
      <Text style={{ ...p, marginTop: 24 }}>The link works once and expires in 24 hours.</Text>
      <Text style={{ ...p, fontSize: 12 }}>
        If the button doesn’t work, copy this address into your browser:
        <br />
        <span style={{ wordBreak: "break-all", color: "#c8a46a" }}>{url}</span>
      </Text>
      <Text style={{ ...p, marginTop: 24, fontSize: 12 }}>If you didn’t ask for this, you can safely ignore this email — your account stays as it is.</Text>
    </EmailLayout>
  );
}
