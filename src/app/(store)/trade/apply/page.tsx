import type { Metadata } from "next";
import { db } from "@/server/db";
import { portalAccount } from "@/server/trade-portal";
import { MaskedHeading } from "@/components/motion/reveal";
import { TradeApplyForm } from "@/components/trade/apply-form";
import { TradeStatusPanel } from "@/components/trade/status-panel";

export const metadata: Metadata = { title: "Apply for a trade account", robots: { index: false } };

export default async function TradeApplyPage() {
  const { user, account } = await portalAccount("/trade/apply");

  if (account) {
    return (
      <div className="container-luxe py-24 md:py-32">
        <TradeStatusPanel account={account} />
      </div>
    );
  }

  const [profile, address] = await Promise.all([
    db.user.findUnique({ where: { id: user.id }, select: { name: true, phone: true } }),
    db.address.findFirst({ where: { userId: user.id }, orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }] }),
  ]);

  return (
    <div className="container-luxe grid gap-16 py-24 md:py-32 lg:grid-cols-[1fr_1.6fr]">
      <header className="lg:sticky lg:top-32 lg:self-start">
        <p className="eyebrow mb-6">Trade application</p>
        <MaskedHeading as="h1" text={"Tell us about\nyour house"} italicLine={1} className="text-5xl md:text-6xl" />
        <p className="mt-8 max-w-sm leading-relaxed text-muted">
          A few details so our trade desk can set up the right prices and terms. Every application is read by a person, usually within two working days.
        </p>
      </header>
      <TradeApplyForm
        defaults={{
          contactName: profile?.name ?? "",
          phone: profile?.phone ?? address?.phone ?? "",
          line1: address?.line1 ?? "",
          line2: address?.line2 ?? "",
          city: address?.city ?? "",
          state: address?.state ?? "",
          postalCode: address?.postalCode ?? "",
          country: address?.country ?? "IN",
        }}
      />
    </div>
  );
}
