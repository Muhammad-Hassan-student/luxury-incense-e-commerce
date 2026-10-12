import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireUser } from "@/server/roles";
import { getCustomerTicket } from "@/server/support";
import { Badge } from "@/components/ui/field";
import { Thread } from "@/components/support/thread";
import { CustomerReplyForm } from "@/components/support/customer-support";

export const metadata: Metadata = { title: "Support request", robots: { index: false } };

export default async function SupportTicketPage(props: PageProps<"/account/support/[number]">) {
  const { number } = await props.params;
  const user = await requireUser(`/account/support/${number}`);
  const n = Number(number);
  if (!Number.isInteger(n) || n <= 0 || n > 2 ** 31) notFound();
  // Only the owner's own tickets (by account); internal notes are never loaded.
  const ticket = await getCustomerTicket(user.id, n);
  if (!ticket) notFound();
  const t = await getTranslations("support");
  return (
    <div className="space-y-8">
      <div>
        <Link href="/account/support" className="link-draw eyebrow !text-muted">
          ← {t("back")}
        </Link>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <h2 className="display min-w-0 break-words text-3xl">{ticket.subject}</h2>
          <Badge tone={ticket.status === "RESOLVED" ? "muted" : ticket.status === "PENDING" ? "ember" : "gold"}>{t(`status_${ticket.status}`)}</Badge>
        </div>
        <p className="mt-2 text-xs text-subtle">
          #{ticket.number}
          {ticket.order ? (
            <>
              {" · "}
              <Link href={`/account/orders/${ticket.order.number}`} className="link-draw text-gold">
                {ticket.order.number}
              </Link>
            </>
          ) : null}
        </p>
      </div>
      <Thread messages={ticket.messages} labels={{ you: t("you"), team: t("team") }} />
      {ticket.status === "RESOLVED" ? <p className="text-xs text-subtle">{t("resolvedNote")}</p> : null}
      <CustomerReplyForm number={ticket.number} />
    </div>
  );
}
