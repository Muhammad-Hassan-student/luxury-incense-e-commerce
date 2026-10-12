import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireUser } from "@/server/roles";
import { orderChoices } from "@/server/support";
import { NewTicketForm } from "@/components/support/customer-support";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("support");
  return { title: t("new"), robots: { index: false } };
}

export default async function NewSupportTicketPage(props: PageProps<"/account/support/new">) {
  const user = await requireUser("/account/support/new");
  const sp = await props.searchParams;
  const [t, format, orders] = await Promise.all([getTranslations("support"), getFormatter(), orderChoices(user.id)]);
  return (
    <div className="space-y-8">
      <div>
        <Link href="/account/support" className="link-draw eyebrow !text-muted">
          ← {t("back")}
        </Link>
        <h2 className="display mt-4 text-3xl">{t("new")}</h2>
      </div>
      <NewTicketForm
        defaultOrder={typeof sp.order === "string" ? sp.order : null}
        orders={orders.map((o) => ({ number: o.number, label: `${o.number} · ${format.dateTime(o.placedAt, { dateStyle: "medium" })}` }))}
      />
    </div>
  );
}
