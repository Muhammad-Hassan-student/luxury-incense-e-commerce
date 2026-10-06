import { env } from "@/env";
import { db } from "@/server/db";
import { releaseExpired } from "@/server/orders";
import { sendEmail } from "@/server/email";
import { SimpleEmail } from "@/emails/simple";
import { productHref } from "@/lib/product-href";

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
      const names = c.items.map((i) => i.variant.product.name).slice(0, 3).join(", ");
      await sendEmail({
        to,
        subject: "Your bag is waiting",
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
};

export async function GET(req: Request, ctx: RouteContext<"/api/cron/[job]">) {
  if (req.headers.get("authorization") !== `Bearer ${env.CRON_SECRET}`) return new Response("Unauthorized", { status: 401 });
  const { job } = await ctx.params;
  const run = jobs[job];
  if (!run) return new Response("Unknown job", { status: 404 });
  return Response.json({ job, ...(await run() as object) });
}
