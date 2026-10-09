import { env } from "@/env";
import { db } from "@/server/db";
import { releaseExpired } from "@/server/orders";
import { sendEmail } from "@/server/email";
import { SimpleEmail } from "@/emails/simple";
import { productHref } from "@/lib/product-href";
import { sendLowStockDigest } from "@/server/stock-report";
import { sendVisitReminders } from "@/server/visits";
import { runJourneys } from "@/server/automations";
import { syncActiveShipments } from "@/server/courier/fulfilment";
import { runSubscriptions } from "@/server/subscriptions";
import { isMailableEmail, journeyEmailsAllowed, listUnsubscribeHeaders } from "@/server/marketing";
import { runCodSweep } from "@/server/cod";
import { sendAbandonedBagWhatsApp } from "@/server/whatsapp/abandoned";

const ABANDONED_AFTER_MS = 3 * 60 * 60 * 1000;

const jobs: Record<string, () => Promise<unknown>> = {
  /** Cancel unpaid orders whose stock hold has lapsed. Run every 5–10 minutes. */
  async release() {
    return { released: await releaseExpired() };
  },

  /** One gentle reminder per bag, 3h after it was last touched. Run hourly. */
  async abandoned() {
    const carts = await db.cart.findMany({
      where: {
        remindedAt: null,
        updatedAt: { lt: new Date(Date.now() - ABANDONED_AFTER_MS) },
        items: { some: {} },
        OR: [{ email: { not: null } }, { user: { isNot: null } }],
      },
      include: { user: { select: { email: true } }, items: { include: { variant: { include: { product: { select: { name: true } } } } } } },
      take: 100,
    });
    for (const c of carts) {
      const to = c.user?.email ?? c.email;
      if (!to) continue;
      // A marketing nudge: honour the same opt-out as journey emails (still mark it so we don't re-check every hour).
      if (!isMailableEmail(to) || !(await journeyEmailsAllowed(to))) {
        await db.cart.update({ where: { id: c.id }, data: { remindedAt: new Date() } });
        continue;
      }
      const names = c.items.map((i) => i.variant.product.name).slice(0, 3).join(", ");
      await sendEmail({
        to,
        subject: "Your bag is waiting",
        headers: listUnsubscribeHeaders(to),
        react: SimpleEmail({ preview: "Still thinking it over?", title: "Still thinking it over?", body: `We’ve kept ${names} aside for you. Small batches go quickly.`, cta: { label: "Return to bag", path: "/cart" } }),
      });
      await db.cart.update({ where: { id: c.id }, data: { remindedAt: new Date() } });
    }
    return { reminded: carts.length };
  },

  /** Emails people waiting on products that now have free stock. Run hourly. */
  async "stock-alerts"() {
    const alerts = await db.stockAlert.findMany({
      where: { notifiedAt: null },
      include: { product: { select: { name: true, slug: true, variants: { select: { stock: true, reserved: true } } } } },
      take: 200,
    });
    let sent = 0;
    for (const a of alerts) {
      if (!a.product.variants.some((v) => v.stock - v.reserved > 0)) continue;
      await sendEmail({
        to: a.email,
        subject: `${a.product.name} is back`,
        react: SimpleEmail({ preview: "Back in stock", title: `${a.product.name} is back`, body: "A fresh batch just arrived. It went quickly last time.", cta: { label: "Shop now", path: productHref(a.product.slug) } }),
      });
      await db.stockAlert.update({ where: { id: a.id }, data: { notifiedAt: new Date() } });
      sent++;
    }
    return { sent };
  },

  /** Daily digest to staff with inventory.view: variants at/below reorder point. Safe to run hourly (sends once per day). */
  async "low-stock"() {
    return sendLowStockDigest();
  },

  /** Emails CONFIRMED atelier visitors whose visit starts in 20–28h, once each. Run hourly. */
  async "visit-reminders"() {
    return sendVisitReminders();
  },

  /** Customer journeys: segment entries, conversions, due steps. Idempotent and safe to overlap. Run hourly. */
  async journeys() {
    return runJourneys();
  },

  /** COD confirmation: reminders before the deadline, then auto-cancel (stock released). Run hourly. */
  async cod() {
    return runCodSweep();
  },

  /** Abandoned-bag WhatsApp (consented phones only, frequency-capped). Run hourly. */
  async "whatsapp-abandoned"() {
    return sendAbandonedBagWhatsApp();
  },
};

// Subscribe & Save: settle paid/expired renewals, create due renewal orders (charge saved card or email a pay
// link), and send "renews in 3 days" reminders. Idempotent across reruns. Run daily.
jobs.subscriptions = () => runSubscriptions();

// Courier tracking fallback for missed webhooks; also advances test-mode parcels (src/server/courier). Run hourly.
jobs["courier-sync"] = () => syncActiveShipments();

export async function GET(req: Request, ctx: RouteContext<"/api/cron/[job]">) {
  if (req.headers.get("authorization") !== `Bearer ${env.CRON_SECRET}`) return new Response("Unauthorized", { status: 401 });
  const { job } = await ctx.params;
  const run = jobs[job];
  if (!run) return new Response("Unknown job", { status: 404 });
  return Response.json({ job, ...(await run() as object) });
}
