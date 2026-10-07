import { Button, Heading, Text } from "@react-email/components";
import { EmailLayout, button, colors, h1, p, siteUrl } from "./layout";

export type VisitStaffEmailProps = {
  event: "new" | "cancelled" | "rescheduled";
  id: string;
  reference: string;
  name: string;
  email: string;
  phone: string;
  company: string | null;
  purpose: string;
  groupSize: number;
  when: string;
  status: string;
  message: string | null;
};

const titles = { new: "New visit booking", cancelled: "Visit cancelled by the visitor", rescheduled: "Visit rescheduled by the visitor" };

/** Heads-up for staff with visits.manage. */
export function VisitStaffEmail(v: VisitStaffEmailProps) {
  return (
    <EmailLayout preview={`${titles[v.event]}: ${v.reference}`}>
      <Heading style={h1}>{titles[v.event]}</Heading>
      <Text style={p}>
        <span style={{ color: colors.gold }}>{v.reference}</span> · {v.status}
        <br />
        {v.when}
        <br />
        {v.purpose} · party of {v.groupSize}
      </Text>
      <Text style={p}>
        {v.name}
        {v.company ? ` (${v.company})` : ""}
        <br />
        {v.email} · {v.phone}
      </Text>
      {v.message ? <Text style={{ ...p, fontStyle: "italic", color: colors.fg }}>“{v.message}”</Text> : null}
      <Button href={`${siteUrl()}/admin/visits/${v.id}`} style={button}>
        Open in admin
      </Button>
    </EmailLayout>
  );
}
