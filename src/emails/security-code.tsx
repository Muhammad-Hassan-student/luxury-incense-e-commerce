import { Heading, Text } from "@react-email/components";
import { EmailLayout, h1, p } from "./layout";

export function SecurityCodeEmail({ code, reason }: { code: string; reason: string }) {
  return (
    <EmailLayout preview={`Your security code: ${code}`}>
      <Heading style={h1}>Your security code</Heading>
      <Text style={p}>Enter this code {reason}. It works once and expires in 10 minutes.</Text>
      <Text style={{ ...p, fontSize: 32, letterSpacing: 8, fontWeight: 600, margin: "24px 0" }}>{code}</Text>
      <Text style={{ ...p, fontSize: 12 }}>
        If you didn’t ask for this, someone may be trying to change your account’s security. Don’t share this code, and
        consider signing out of other devices.
      </Text>
    </EmailLayout>
  );
}
