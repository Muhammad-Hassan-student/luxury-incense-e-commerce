import { AccountingTabs } from "@/components/admin/accounting/tabs";
import { AccountingSettingsForm } from "@/components/admin/accounting/forms";
import { PageHeader, Section } from "@/components/admin/ui";
import { requirePermission } from "@/server/roles";
import { getAccountingSettings, setupProblems } from "@/server/accounting/settings";
import { getSettings } from "@/server/settings";
import { formatDocNumber, financialYear, stateName } from "@/lib/gst";

export const dynamic = "force-dynamic";
export const metadata = { title: "Accounting settings" };

export default async function AccountingSettingsPage() {
  await requirePermission("accounting.manage");
  const [s, store] = await Promise.all([getAccountingSettings(), getSettings()]);
  const missing = setupProblems(s);
  const fy = financialYear(new Date());

  return (
    <>
      <PageHeader eyebrow="Finance" title="Accounting settings">
        Registered business details printed on GST invoices and used for CGST/SGST vs IGST.
      </PageHeader>
      <AccountingTabs active="settings" canManage />

      <div className="mb-8 grid gap-px sm:grid-cols-3">
        <div className="border border-line bg-bg-elev px-5 py-4 text-sm">
          <p className="eyebrow">Next numbers look like</p>
          <p className="mt-2 font-mono text-fg">{formatDocNumber(s.invoicePrefix, fy, 1)}</p>
          <p className="font-mono text-muted">{formatDocNumber(s.creditNotePrefix, fy, 1)}</p>
          <p className="mt-2 text-xs text-subtle">16 characters — the GST / e-invoice limit. Restarts at 1 every April.</p>
        </div>
        <div className="border border-line bg-bg-elev px-5 py-4 text-sm">
          <p className="eyebrow">Place of business</p>
          <p className="mt-2 text-fg">{s.stateCode ? `${s.stateCode} · ${stateName(s.stateCode)}` : "Not set"}</p>
          <p className="mt-2 text-xs text-subtle">Deliveries in this state: CGST + SGST. Elsewhere in India: IGST.</p>
        </div>
        <div className="border border-line bg-bg-elev px-5 py-4 text-sm">
          <p className="eyebrow">GST rate</p>
          <p className="mt-2 text-fg">
            {store.taxRatePercent}% {store.taxInclusive ? "included in prices" : "added at checkout"}
          </p>
          <p className="mt-2 text-xs text-subtle">{missing.length ? `Still needed: ${missing.join(", ")}` : s.enabled ? "Issuing documents" : "Ready — tick the box to start issuing"}</p>
        </div>
      </div>

      <Section title="Business & numbering">
        <AccountingSettingsForm initial={s} />
      </Section>
    </>
  );
}
