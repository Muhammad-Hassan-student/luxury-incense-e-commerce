import { Button, Heading, Section, Text } from "@react-email/components";
import { EmailLayout, button, colors, h1, p, serif, siteUrl } from "./layout";

export type VisitEmailKind = "received" | "confirmed" | "declined" | "cancelled" | "cancelled-by-visitor" | "rescheduled" | "reminder" | "trade-invite";

export type VisitEmailPass = {
  reference: string;
  name: string;
  groupSize: number;
  day: string;
  time: string;
  address: string;
  token: string;
  status: string;
};

const copy: Record<VisitEmailKind, { subject: (ref: string) => string; title: string; body: string }> = {
  received: {
    subject: (r) => `We’ve received your visit request · ${r}`,
    title: "Your request is with us",
    body: "Thank you for asking to visit the atelier. A member of the house will confirm your time shortly, usually within one working day. Your request is below.",
  },
  confirmed: {
    subject: (r) => `Your visit is confirmed · ${r}`,
    title: "We look forward to welcoming you",
    body: "Your visit to the atelier is confirmed. Please show this pass at the gate (on your phone is fine). Wear closed shoes; the still room is warm and the floors are stone.",
  },
  declined: {
    subject: (r) => `About your visit request · ${r}`,
    title: "We can’t host this visit",
    body: "Thank you for your interest in the atelier. Unfortunately we aren’t able to host the visit you requested.",
  },
  cancelled: {
    subject: (r) => `Your visit has been cancelled · ${r}`,
    title: "Your visit has been cancelled",
    body: "We’re sorry: we’ve had to cancel your visit to the atelier. We’d be glad to welcome you another day.",
  },
  "cancelled-by-visitor": {
    subject: (r) => `Visit cancelled · ${r}`,
    title: "Your visit is cancelled",
    body: "As you asked, we’ve cancelled your visit. The places have been released. We hope to welcome you another time.",
  },
  rescheduled: {
    subject: (r) => `Your visit has a new time · ${r}`,
    title: "Your visit has moved",
    body: "Your visit to the atelier now has the time shown below.",
  },
  reminder: {
    subject: (r) => `See you tomorrow · ${r}`,
    title: "Until tomorrow",
    body: "A gentle reminder of your visit to the atelier. Wear closed shoes, leave strong perfume at home so you can smell ours, and allow a little time for the drive in.",
  },
  "trade-invite": {
    subject: () => "An invitation to open a trade account",
    title: "Trade with the house",
    body: "Thank you for visiting us. As a wholesale buyer you’re welcome to open a trade account: tiered pricing, small-batch allocations and terms for approved partners.",
  },
};

export const visitEmailSubject = (kind: VisitEmailKind, reference: string) => copy[kind].subject(reference);

const label = { fontSize: 10, letterSpacing: "0.24em", textTransform: "uppercase" as const, color: colors.muted, margin: "0 0 4px" };
const value = { fontSize: 15, color: colors.fg, margin: "0 0 14px" };

function Pass({ pass }: { pass: VisitEmailPass }) {
  return (
    <Section style={{ border: `1px solid ${colors.gold}`, padding: "24px 24px 10px", margin: "8px 0 24px" }}>
      <Text style={{ ...label, color: colors.gold }}>Visitor pass · {pass.status}</Text>
      <Text style={{ fontFamily: serif, fontSize: 30, color: colors.fg, margin: "4px 0 18px", letterSpacing: "0.08em" }}>{pass.reference}</Text>
      <Text style={label}>Guest</Text>
      <Text style={value}>
        {pass.name} · party of {pass.groupSize}
      </Text>
      <Text style={label}>When</Text>
      <Text style={value}>
        {pass.day}, {pass.time}
      </Text>
      <Text style={label}>Where</Text>
      <Text style={{ ...value, whiteSpace: "pre-line" }}>{pass.address}</Text>
    </Section>
  );
}

/** Every visitor-facing visit email: received, confirmed, declined, cancelled, rescheduled, reminder and trade invite. */
export function VisitEmail({ kind, pass, reason }: { kind: VisitEmailKind; pass: VisitEmailPass; reason?: string | null }) {
  const c = copy[kind];
  const manage = `${siteUrl()}/visit/${pass.token}`;
  const showPass = kind !== "declined" && kind !== "trade-invite";
  return (
    <EmailLayout preview={c.title}>
      <Heading style={h1}>{c.title}</Heading>
      <Text style={p}>Dear {pass.name},</Text>
      <Text style={p}>{c.body}</Text>
      {reason ? <Text style={{ ...p, color: colors.fg, fontStyle: "italic" }}>“{reason}”</Text> : null}
      {showPass ? <Pass pass={pass} /> : null}
      {kind === "trade-invite" ? (
        <Button href={`${siteUrl()}/trade`} style={button}>
          Open a trade account
        </Button>
      ) : kind === "declined" || kind === "cancelled" || kind === "cancelled-by-visitor" ? (
        <Button href={`${siteUrl()}/visit`} style={button}>
          Choose another day
        </Button>
      ) : (
        <Button href={manage} style={button}>
          View, change or cancel
        </Button>
      )}
    </EmailLayout>
  );
}
