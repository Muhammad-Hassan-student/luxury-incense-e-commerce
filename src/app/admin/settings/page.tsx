import { FeatureFlagToggle } from "@/components/admin/toggles";
import { ShippingRates, StoreSettingsForm } from "@/components/admin/settings-forms";
import { Empty, PageHeader, Section } from "@/components/admin/ui";
import { db } from "@/server/db";
import { requirePermission } from "@/server/roles";
import { getSettings } from "@/server/settings";
import { getPolicy } from "@/server/security/state";
import { SecondStepPolicy } from "@/components/admin/second-step-policy";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  await requirePermission("settings.manage");
  const [settings, flags, rates, secondStep] = await Promise.all([
    getSettings(),
    db.featureFlag.findMany({ orderBy: { key: "asc" } }),
    db.shippingRate.findMany({ orderBy: [{ position: "asc" }, { name: "asc" }] }),
    getPolicy(),
  ]);

  return (
    <>
      <PageHeader eyebrow="Owner" title="Settings">
        Changes apply to the storefront immediately and are recorded in the audit log.
      </PageHeader>

      <div className="space-y-8">
        <Section title="Store">
          <StoreSettingsForm initial={settings} />
        </Section>

        <Section title="Require Face ID / phone lock">
          <SecondStepPolicy initial={secondStep.require} />
        </Section>

        <Section title="Feature flags">
          {flags.length ? (
            <ul className="divide-y divide-line">
              {flags.map((f) => (
                <li key={f.key} className="flex items-center justify-between gap-6 px-5 py-4">
                  <div>
                    <p className="font-mono text-sm text-fg">{f.key}</p>
                    <p className="text-xs text-muted">{f.description}</p>
                  </div>
                  <FeatureFlagToggle flagKey={f.key} enabled={f.enabled} />
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No feature flags defined.</Empty>
          )}
        </Section>

        <Section title="Shipping rates">
          <p className="px-5 pt-4 text-xs text-subtle">
            Checkout offers the rates matching the customer&apos;s country; rates with * apply only where no specific rate exists. Prices in rupees.
          </p>
          <ShippingRates rates={rates} />
        </Section>
      </div>
    </>
  );
}
