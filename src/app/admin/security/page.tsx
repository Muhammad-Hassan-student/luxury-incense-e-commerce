import { PageHeader, Section } from "@/components/admin/ui";
import { SecondStepPolicy } from "@/components/admin/second-step-policy";
import { SecuritySettings } from "@/components/security/settings";
import { can, requireStaff } from "@/server/roles";
import { getPolicy } from "@/server/security/state";

export const dynamic = "force-dynamic";
export const metadata = { title: "Security lock" };

export default async function AdminSecurityPage() {
  const user = await requireStaff();
  const policy = await getPolicy();
  return <>
    <PageHeader eyebrow={user.roleName} title="Security lock">
      Protect your admin account with Face ID, your device lock or a camera face check. Use Lock now whenever you leave this device.
    </PageHeader>
    <Section title="Your security lock">
      <SecuritySettings userId={user.id} email={user.email} />
    </Section>
    {can(user, "settings.manage") && <Section title="Require a security lock for your team">
      <SecondStepPolicy initial={policy.require} />
    </Section>}
  </>;
}
