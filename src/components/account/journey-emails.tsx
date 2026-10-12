import { getTranslations } from "next-intl/server";
import { db } from "@/server/db";
import { requireUser } from "@/server/roles";
import { journeyEmailsAllowed } from "@/server/marketing";
import { JourneyEmailsToggle } from "./journey-emails-toggle";

/** "Journey emails" preference on the account overview (loads its own data). */
export async function JourneyEmails() {
  const session = await requireUser();
  const user = await db.user.findUnique({ where: { id: session.id }, select: { email: true } });
  if (!user) return null;
  const allowed = await journeyEmailsAllowed(user.email);
  const t = await getTranslations("journeyEmails");
  return (
    <section aria-labelledby="journey-emails">
      <h2 id="journey-emails" className="mb-6 font-display text-3xl">
        {t("heading")}
      </h2>
      <div className="flex flex-col gap-6 border border-line bg-bg p-8 sm:flex-row sm:items-center sm:justify-between">
        <div className="max-w-xl">
          <p className="eyebrow mb-3">{t("title")}</p>
          <p className="text-sm text-muted">{t("body")}</p>
        </div>
        <JourneyEmailsToggle allowed={allowed} />
      </div>
    </section>
  );
}
