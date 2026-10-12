import Link from "next/link";
import { PageHeader, Section, linkClass } from "@/components/admin/ui";
import { MacroEditor } from "@/components/support/admin-support";
import { requirePermission } from "@/server/roles";
import { listMacros } from "@/server/support";

export const dynamic = "force-dynamic";
export const metadata = { title: "Canned replies" };

export default async function MacrosPage() {
  await requirePermission("support.manage");
  const macros = await listMacros();
  return (
    <>
      <PageHeader
        eyebrow="Support"
        title="Canned replies"
        actions={
          <Link href="/admin/support" className={linkClass}>
            ← Inbox
          </Link>
        }
      >
        Saved answers the team can insert into a reply and adjust before sending.
      </PageHeader>
      <div className="grid gap-8 lg:grid-cols-2">
        <Section title="New canned reply">
          <MacroEditor />
        </Section>
        {macros.map((m) => (
          <Section key={m.id} title={m.title}>
            <MacroEditor macro={{ id: m.id, title: m.title, body: m.body }} />
          </Section>
        ))}
      </div>
    </>
  );
}
