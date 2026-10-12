import { PageHeader, Section } from "@/components/admin/ui";
import { IntegrationCard, type IntegrationField } from "@/components/admin/integration-card";
import { requirePermission } from "@/server/roles";
import { getIntegration, maskedIntegration, PROVIDER_KEYS, type ProviderKey } from "@/server/integrations";
import { getRegion } from "@/server/region";

export const dynamic = "force-dynamic";
export const metadata = { title: "Integrations" };

async function isConnected(p: ProviderKey) {
  switch (p) {
    case "email": {
      const c = await getIntegration("email");
      return Boolean((c.smtpUser && c.smtpPassword) || c.resendApiKey);
    }
    case "stripe":
      return Boolean((await getIntegration("stripe")).secretKey);
    case "razorpay": {
      const c = await getIntegration("razorpay");
      return Boolean(c.keyId && c.keySecret);
    }
    case "whatsapp": {
      const c = await getIntegration("whatsapp");
      return c.enabled && Boolean(c.phoneNumberId && c.accessToken);
    }
    case "courier": {
      const c = await getIntegration("courier");
      return c.enabled && Boolean(c.email && c.password);
    }
    case "pixels": {
      const c = await getIntegration("pixels");
      return c.enabled && Boolean(c.ga4MeasurementId || c.metaPixelId);
    }
    case "ai": {
      const c = await getIntegration("ai");
      return c.enabled && Boolean(c.apiKey);
    }
    case "push": {
      const c = await getIntegration("push");
      return c.enabled && Boolean(c.vapidPublicKey && c.vapidPrivateKey);
    }
    case "monitoring": {
      const c = await getIntegration("monitoring");
      return c.alertEmail || c.alertWhatsApp || c.backupDestination !== "off";
    }
  }
}

export default async function IntegrationsPage() {
  const user = await requirePermission("settings.manage");
  const region = await getRegion();
  const cards = await Promise.all(PROVIDER_KEYS.map(async (p) => ({ ...(await maskedIntegration(p)), connected: await isConnected(p) })));

  return (
    <>
      <PageHeader eyebrow="Owner" title="Integrations">
        API keys for email, payments, WhatsApp, courier and analytics. Keys are encrypted in the database and never shown again
        after saving; a value saved here overrides the matching environment variable.
      </PageHeader>
      <div className="space-y-8">
        {cards.map((c) => (
          <Section key={c.provider} title={c.title}>
            <p className="border-b border-line px-5 py-3 text-sm text-muted">{c.blurb}</p>
            {c.provider === "courier" && region.country !== "IN" && (
              <p className="border-b border-line bg-gold/5 px-5 py-3 text-sm text-gold" data-courier-india-only>Shiprocket only ships within India. Your store&apos;s country is {region.country}, so courier booking and live courier rates stay off — use your shipping rates table and add tracking numbers by hand.</p>
            )}
            {c.provider === "razorpay" && region.baseCurrency !== "INR" && (
              <p className="border-b border-line bg-gold/5 px-5 py-3 text-sm text-gold" data-razorpay-inr-only>Razorpay is set up to charge INR only, and your base currency is {region.baseCurrency} — it is hidden at checkout. Stripe charges shoppers in their own currency.</p>
            )}
            <IntegrationCard
              provider={c.provider}
              fields={c.fields as IntegrationField[]}
              connected={c.connected}
              canTestEmail={c.provider === "email"}
              defaultTestTo={user.email ?? ""}
              connectionTest={c.provider === "stripe" || c.provider === "razorpay" ? "Test connection" : c.provider === "pixels" ? "Send Meta test event" : undefined}
            />
          </Section>
        ))}
      </div>
    </>
  );
}
