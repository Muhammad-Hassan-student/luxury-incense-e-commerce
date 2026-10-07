import Link from "next/link";
import type { TradeStatus } from "@/generated/prisma/enums";
import { brand } from "@/config/brand";
import { Badge } from "@/components/ui/field";
import { TRADE_STATUS_LABEL, businessTypeLabel, tradeStatusTone } from "./trade-rules";

const copy: Record<TradeStatus, { title: string; body: string }> = {
  PENDING: {
    title: "Your application is with our trade desk",
    body: "We review every application by hand and usually reply within two working days. We’ll email you as soon as there’s news.",
  },
  APPROVED: { title: "Your trade account is open", body: "Your prices, terms and the quick-order grid are waiting in the trade portal." },
  REJECTED: { title: "We couldn’t open an account just now", body: "You’re always welcome to shop with us at retail, and to write to us if your circumstances change." },
  SUSPENDED: { title: "Your trade account is on hold", body: "New orders and quotes are paused. Existing orders and invoices are unaffected. Please contact the trade desk to resolve this." },
};

/** What a buyer sees about their own application/account when they can't use the portal (or have already applied). */
export function TradeStatusPanel({
  account,
}: {
  account: { status: TradeStatus; businessName: string; businessType: string; createdAt: Date; rejectionReason: string | null };
}) {
  const c = copy[account.status];
  return (
    <section className="mx-auto max-w-3xl border border-line bg-bg-elev p-8 md:p-14" aria-labelledby="trade-status">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <p className="eyebrow">{account.businessName}</p>
        <Badge tone={tradeStatusTone(account.status)}>{TRADE_STATUS_LABEL[account.status]}</Badge>
      </div>
      <h2 id="trade-status" className="display text-4xl md:text-5xl">
        {c.title}
      </h2>
      <p className="mt-6 max-w-xl leading-relaxed text-muted">{c.body}</p>
      {account.status === "REJECTED" && account.rejectionReason ? (
        <blockquote className="mt-8 border-l border-gold/60 pl-6 font-display text-xl italic text-fg">{account.rejectionReason}</blockquote>
      ) : null}
      <dl className="mt-10 grid gap-6 border-t border-line pt-8 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-[0.625rem] uppercase tracking-[0.2em] text-subtle">Business type</dt>
          <dd className="mt-1">{businessTypeLabel(account.businessType)}</dd>
        </div>
        <div>
          <dt className="text-[0.625rem] uppercase tracking-[0.2em] text-subtle">Applied</dt>
          <dd className="mt-1">{account.createdAt.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</dd>
        </div>
      </dl>
      <div className="mt-10 flex flex-wrap gap-6">
        {account.status === "APPROVED" ? (
          <Link href="/trade/portal" className="link-draw eyebrow">
            Open the trade portal
          </Link>
        ) : (
          <a href={`mailto:${brand.email}?subject=${encodeURIComponent(`Trade account — ${account.businessName}`)}`} className="link-draw eyebrow">
            Write to the trade desk
          </a>
        )}
        <Link href="/shop" className="link-draw eyebrow !text-muted">
          Shop at retail
        </Link>
      </div>
    </section>
  );
}
