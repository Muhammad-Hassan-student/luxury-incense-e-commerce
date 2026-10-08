import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader, Section } from "@/components/admin/ui";
import { CreateTradeAccountForm } from "@/components/admin/trade/create-account-form";
import { db } from "@/server/db";
import { requirePermission } from "@/server/roles";
import { MAX_STAFF_CREDIT } from "@/server/trade-schemas";

export const dynamic = "force-dynamic";
export const metadata = { title: "New trade account" };

export default async function NewTradeAccountPage() {
  await requirePermission("trade.manage");
  const tiers = await db.priceTier.findMany({ orderBy: { discountPercent: "asc" }, select: { id: true, name: true, discountPercent: true, minOrderValue: true } });

  return (
    <>
      <Link href="/admin/trade" className="mb-4 inline-flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-muted hover:text-gold">
        <ArrowLeft className="size-3.5" aria-hidden /> Trade accounts
      </Link>
      <PageHeader eyebrow="Trade" title="New trade account">
        Open an account for a buyer you’ve spoken to — no application needed.
      </PageHeader>
      <Section title="Account details" className="max-w-4xl">
        <CreateTradeAccountForm tiers={tiers} maxCredit={MAX_STAFF_CREDIT} />
      </Section>
    </>
  );
}
