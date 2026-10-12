import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireUser } from "@/server/roles";
import { listCustomerTickets } from "@/server/support";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/field";

export const metadata: Metadata = { title: "Help & support", robots: { index: false } };

export default async function SupportPage() {
  const user = await requireUser("/account/support");
  const [t, format, tickets] = await Promise.all([getTranslations("support"), getFormatter(), listCustomerTickets(user.id)]);
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow mb-3">{t("title")}</p>
          <p className="max-w-xl text-sm text-muted">{t("intro")}</p>
        </div>
        <Button asChild size="sm">
          <Link href="/account/support/new">{t("new")}</Link>
        </Button>
      </div>
      <section className="space-y-3">
        <p className="eyebrow">{t("yourRequests")}</p>
        {tickets.length === 0 ? (
          <p className="text-sm text-muted">{t("none")}</p>
        ) : (
          <ul className="divide-y divide-line border-y border-line">
            {tickets.map((k) => (
              <li key={k.id}>
                <Link href={`/account/support/${k.number}`} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-4 transition-colors hover:text-gold">
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-fg">{k.subject}</span>
                    <span className="text-xs text-subtle">
                      #{k.number} · {t("updated", { date: format.dateTime(k.updatedAt, { dateStyle: "medium" }) })}
                    </span>
                  </span>
                  <Badge tone={k.status === "RESOLVED" ? "muted" : k.status === "PENDING" ? "ember" : "gold"}>{t(`status_${k.status}`)}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
