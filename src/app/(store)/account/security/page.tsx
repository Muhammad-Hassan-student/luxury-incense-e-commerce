import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireUser } from "@/server/roles";
import { SecuritySettings } from "@/components/security/settings";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("security");
  return { title: t("metaTitle"), robots: { index: false } };
}
export const dynamic = "force-dynamic";

export default async function SecurityPage() {
  const user = await requireUser("/account/security");
  const t = await getTranslations("security");

  return (
    <div className="space-y-4">
      <p className="eyebrow">{t("eyebrow")}</p>
      <h2 className="display text-4xl md:text-5xl">{t("heading")}</h2>
      <p className="max-w-xl text-sm text-muted">
        {t("intro")}
      </p>
      <SecuritySettings userId={user.id} email={user.email ?? ""} />
    </div>
  );
}
