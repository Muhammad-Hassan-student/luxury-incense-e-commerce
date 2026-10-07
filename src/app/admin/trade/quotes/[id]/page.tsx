import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/field";
import { PageHeader, Section, Table, Td, Th, linkClass } from "@/components/admin/ui";
import { QuoteNotesForm, QuoteReplyForm, WithdrawQuoteButton } from "@/components/admin/trade/quote-reply";
import { QUOTE_STATUS_LABEL, TERMS_LABEL, TRADE_STATUS_LABEL, quoteStatusTone, tradeUnitPrice } from "@/components/trade/trade-rules";
import { db } from "@/server/db";
import { can, requireAnyPermission } from "@/server/roles";
import { COFFRET_SLUG } from "@/server/trade";
import { expireQuotes } from "@/server/trade-quotes";
import { formatMoney } from "@/lib/money";
import { fmtDate, fmtDateTime } from "@/lib/admin-shared";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: PageProps<"/admin/trade/quotes/[id]">) {
  const { id } = await props.params;
  const q = await db.quote.findUnique({ where: { id }, select: { number: true } });
  return { title: q ? `Quote ${q.number}` : "Quote" };
}

/** YYYY-MM-DD in store time (IST). */
const ymd = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
/** Default validity for a new quote: two weeks. */
const defaultValidUntil = () => ymd(new Date(Date.now() + 14 * 86_400_000));

export default async function TradeQuoteAdminPage(props: PageProps<"/admin/trade/quotes/[id]">) {
  const user = await requireAnyPermission("trade.view", "trade.manage");
  const canManage = can(user, "trade.manage");
  const { id } = await props.params;
  await expireQuotes({ id });
  const q = await db.quote.findUnique({
    where: { id },
    include: {
      items: { orderBy: { id: "asc" }, include: { variant: { select: { sku: true, label: true, product: { select: { name: true } } } } } },
      order: { select: { id: true, number: true, total: true } },
      tradeAccount: { include: { tier: true, user: { select: { email: true } } } },
    },
  });
  if (!q) notFound();
  const editable = canManage && (q.status === "REQUESTED" || q.status === "QUOTED" || q.status === "EXPIRED");
  const account = q.tradeAccount;

  const variants = editable
    ? await db.productVariant.findMany({
        where: { product: { isGiftCard: false, slug: { not: COFFRET_SLUG } } },
        orderBy: [{ product: { name: "asc" } }, { position: "asc" }],
        include: { product: { select: { name: true, isActive: true } }, tradePrices: account.tierId ? { where: { tierId: account.tierId } } : false },
      })
    : [];

  return (
    <>
      <Link href="/admin/trade/quotes" className="mb-4 inline-flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-muted hover:text-gold">
        <ArrowLeft className="size-3.5" aria-hidden /> Quotes
      </Link>
      <PageHeader
        eyebrow={`Requested ${fmtDateTime(q.createdAt)}`}
        title={q.number}
        actions={
          <div className="flex items-center gap-4">
            {canManage && (q.status === "REQUESTED" || q.status === "QUOTED" || q.status === "EXPIRED") ? <WithdrawQuoteButton quoteId={q.id} /> : null}
            <Badge tone={quoteStatusTone(q.status)}>{QUOTE_STATUS_LABEL[q.status]}</Badge>
          </div>
        }
      >
        <Link href={`/admin/trade/${account.id}`} className={linkClass}>
          {account.businessName}
        </Link>{" "}
        · {TRADE_STATUS_LABEL[account.status]} · {account.tier ? `${account.tier.name} (${account.tier.discountPercent}%)` : "no tier"} · {TERMS_LABEL[account.terms]}
      </PageHeader>

      <div className="grid gap-8 xl:grid-cols-[1fr_20rem]">
        <div className="space-y-8">
          {q.order ? (
            <p className="border border-gold/40 p-4 text-sm">
              Accepted — order{" "}
              <Link href={`/admin/orders/${q.order.id}`} className={linkClass}>
                {q.order.number}
              </Link>{" "}
              ({formatMoney(q.order.total)}).
            </p>
          ) : null}

          {editable ? (
            <Section title={q.status === "REQUESTED" ? "Price this request" : "Quote"}>
              <QuoteReplyForm
                quoteId={q.id}
                resend={q.status !== "REQUESTED"}
                lines={q.items.map((i) => ({ id: i.id, description: i.description, variantId: i.variantId, quantity: i.quantity, targetPrice: i.targetPrice, quotedPrice: i.quotedPrice }))}
                variants={variants.map((v) => ({
                  id: v.id,
                  label: `${v.product.name} — ${v.label} (${v.sku})${v.product.isActive ? "" : " · inactive"}`,
                  retail: v.price,
                  trade: tradeUnitPrice(v.price, account.tier?.discountPercent ?? 0, (v.tradePrices ?? [])[0]?.price ?? null),
                }))}
                validUntil={q.validUntil ? ymd(q.validUntil) : defaultValidUntil()}
                replyMessage={q.replyMessage ?? ""}
                staffNotes={q.staffNotes ?? ""}
              />
            </Section>
          ) : (
            <Section title="Lines">
              <Table>
                <thead>
                  <tr>
                    <Th>Item</Th>
                    <Th className="text-right">Qty</Th>
                    <Th className="text-right">Target</Th>
                    <Th className="text-right">Quoted</Th>
                  </tr>
                </thead>
                <tbody>
                  {q.items.map((i) => (
                    <tr key={i.id}>
                      <Td>
                        <p>{i.description}</p>
                        {i.variant ? <p className="font-mono text-xs text-subtle">{i.variant.sku}</p> : <p className="text-xs text-ember">Not mapped</p>}
                      </Td>
                      <Td className="text-right tabular-nums">{i.quantity}</Td>
                      <Td className="text-right tabular-nums text-muted">{i.targetPrice != null ? formatMoney(i.targetPrice) : "—"}</Td>
                      <Td className="text-right tabular-nums">{i.quotedPrice != null ? formatMoney(i.quotedPrice) : "—"}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              {q.replyMessage ? <p className="border-t border-line p-5 text-sm italic text-muted">“{q.replyMessage}”</p> : null}
            </Section>
          )}
        </div>

        <aside className="space-y-8">
          <Section title="Buyer’s message">
            <p className="whitespace-pre-wrap p-5 text-sm text-fg">{q.message || <span className="text-muted">No message.</span>}</p>
            <p className="border-t border-line px-5 py-3 text-xs text-muted">{account.user.email}</p>
          </Section>
          <Section title="Validity">
            <p className="p-5 text-sm">{q.validUntil ? `Until ${fmtDate(q.validUntil)}` : "Not quoted yet"}</p>
          </Section>
          {canManage && !editable ? (
            <Section title="Notes">
              <QuoteNotesForm quoteId={q.id} notes={q.staffNotes ?? ""} />
            </Section>
          ) : !canManage && q.staffNotes ? (
            <Section title="Notes">
              <p className="whitespace-pre-wrap p-5 text-sm text-muted">{q.staffNotes}</p>
            </Section>
          ) : null}
        </aside>
      </div>
    </>
  );
}
