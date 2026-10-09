import "server-only";
import { db } from "../db";
import { getIntegration } from "../integrations";
import { journeyEmailsAllowed } from "../marketing";
import { getRiskSettings } from "../risk";
import { canMessage, sendWhatsApp } from "./messages";
import { normalizePhone } from "./phone";

const AFTER_MS = 3 * 3600_000;
const UNTIL_MS = 48 * 3600_000;

/**
 * Abandoned-bag reminder on WhatsApp (a marketing message). Sent at most once per bag, only to phones that opted in at
 * checkout and haven't replied STOP, only when the email marketing opt-out allows it, and never more than one marketing
 * message per phone per `marketingCapDays`. Bags idle 3–48 hours. Idempotent; run hourly.
 */
export async function sendAbandonedBagWhatsApp(now = new Date(), only?: { cartIds: string[] }) {
  const s = await getRiskSettings();
  if (!s.abandonedWhatsApp) return { sent: 0, skipped: 0 };
  const carts = await db.cart.findMany({
    where: { ...(only ? { id: { in: only.cartIds } } : {}), updatedAt: { lt: new Date(now.getTime() - AFTER_MS), gt: new Date(now.getTime() - UNTIL_MS) }, items: { some: {} }, OR: [{ email: { not: null } }, { user: { isNot: null } }] },
    include: { user: { select: { id: true, email: true, name: true, phone: true } }, items: { include: { variant: { include: { product: { select: { name: true } } } } } } },
    take: 200,
  });
  const c = await getIntegration("whatsapp");
  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
  let sent = 0;
  let skipped = 0;
  for (const cart of carts) {
    const email = (cart.user?.email ?? cart.email ?? "").toLowerCase();
    if (!email) continue;
    if (await db.whatsAppMessage.count({ where: { cartId: cart.id, kind: "abandoned_bag" } })) continue;
    // A phone that consented: the account's own number, else one given with consent at an earlier checkout.
    const contact = await db.whatsAppContact.findFirst({
      where: { optedIn: true, consentAt: { not: null }, OR: [{ email }, ...(cart.user ? [{ userId: cart.user.id }] : [])] },
      orderBy: { consentAt: "desc" },
    });
    const phone = (cart.user?.phone && normalizePhone(cart.user.phone)) || contact?.phone;
    if (!phone || !(await canMessage(phone, "marketing")) || !(await journeyEmailsAllowed(email))) {
      skipped++;
      continue;
    }
    const recent = await db.whatsAppMessage.count({ where: { phone, kind: "abandoned_bag", createdAt: { gte: new Date(now.getTime() - s.marketingCapDays * 864e5) } } });
    if (recent) {
      skipped++;
      continue;
    }
    const names = cart.items.map((i) => i.variant.product.name).slice(0, 3).join(", ");
    const name = (cart.user?.name ?? "").split(" ")[0] || "there";
    const r = await sendWhatsApp({
      phone,
      kind: "abandoned_bag",
      consent: "marketing",
      message: { type: "template", name: c.templateAbandonedBag, language: c.templateLanguage, bodyVars: [name, names, `${site}/cart`] },
      userId: cart.user?.id ?? null,
      cartId: cart.id,
    });
    if (r.sent) sent++;
    else skipped++;
  }
  return { sent, skipped };
}
