import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { brand } from "@/config/brand";
import { db } from "./db";

/*
 * Customer data rights: export everything we hold about a user, and erase it on request.
 * Orders are kept (tax records) but detached from the person.
 */

export class PrivacyError extends Error {}

export const DELETED_LABEL = "Deleted";
export const deletedEmailFor = (userId: string) => `deleted-${userId}@deleted.invalid`;

/** Everything personal we hold for one user. Every query is keyed by that user's id (or their own email). */
export async function exportUserData(userId: string) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      emailVerified: true,
      phone: true,
      image: true,
      loyaltyPoints: true,
      referralCode: true,
      createdAt: true,
      updatedAt: true,
      addresses: { orderBy: { createdAt: "asc" }, omit: { userId: true } },
      orders: {
        where: { reservedUntil: null },
        orderBy: { placedAt: "desc" },
        omit: { userId: true, reservedUntil: true },
        include: {
          items: { omit: { orderId: true } },
          payments: { select: { provider: true, status: true, amount: true, currency: true, createdAt: true } },
          events: { orderBy: { createdAt: "asc" }, select: { status: true, message: true, createdAt: true } },
          returns: {
            orderBy: { requestedAt: "asc" },
            select: {
              number: true,
              status: true,
              reason: true,
              customerNote: true,
              rejectionReason: true,
              resolution: true,
              refundAmount: true,
              requestedAt: true,
              resolvedAt: true,
              items: { select: { quantity: true, orderItem: { select: { name: true, label: true, sku: true } } } },
            },
          },
        },
      },
      reviews: { orderBy: { createdAt: "desc" }, omit: { userId: true }, include: { product: { select: { name: true, slug: true } } } },
      wishlist: { orderBy: { createdAt: "desc" }, select: { createdAt: true, product: { select: { name: true, slug: true } } } },
      loyaltyLedger: { orderBy: { createdAt: "asc" }, select: { points: true, reason: true, createdAt: true } },
      subscriptions: { omit: { userId: true }, include: { variant: { select: { sku: true, label: true } } } },
      _count: { select: { referrals: true } },
    },
  });
  if (!user) throw new PrivacyError("Account not found.");
  const [newsletter, stockAlerts, marketing, journeys] = await Promise.all([
    db.newsletterSubscriber.findUnique({ where: { email: user.email }, select: { email: true, locale: true, createdAt: true } }),
    db.stockAlert.findMany({ where: { email: user.email }, select: { createdAt: true, notifiedAt: true, product: { select: { name: true, slug: true } } } }),
    db.marketingPreference.findUnique({ where: { email: user.email.toLowerCase() }, select: { journeys: true, source: true, updatedAt: true } }),
    db.journeyEnrollment.findMany({
      where: { userId },
      orderBy: { enteredAt: "asc" },
      select: {
        journey: { select: { name: true } },
        status: true,
        enteredAt: true,
        exitedAt: true,
        exitReason: true,
        messages: { orderBy: { sentAt: "asc" }, select: { template: true, email: true, status: true, sentAt: true, couponCode: true, couponExpiresAt: true, points: true } },
      },
    }),
  ]);
  const { addresses, orders, reviews, wishlist, loyaltyLedger, subscriptions, _count, ...profile } = user;
  return {
    exportedAt: new Date().toISOString(),
    store: brand.name,
    note: "Money values are in minor units (paise) of INR.",
    profile: { ...profile, referrals: _count.referrals },
    addresses,
    orders,
    reviews,
    wishlist,
    loyaltyLedger,
    subscriptions,
    newsletter: newsletter ? { subscribed: true, ...newsletter } : { subscribed: false },
    stockAlerts,
    marketing: { journeyEmails: marketing?.journeys ?? true, changedAt: marketing?.updatedAt ?? null, via: marketing?.source ?? null },
    journeys: journeys.map(({ journey, ...j }) => ({ journey: journey.name, ...j })),
  };
}

export type UserDataExport = Awaited<ReturnType<typeof exportUserData>>;

/**
 * Erases a customer's personal data in one transaction. Orders stay for tax records,
 * but are detached and their personal fields replaced. Staff must lose staff access first.
 */
export async function deleteAccount(userId: string, confirm: { email: string; phrase: string }) {
  const user = await db.user.findUnique({ where: { id: userId }, select: { id: true, email: true, role: true } });
  if (!user) throw new PrivacyError("Account not found.");
  if (user.role !== "CUSTOMER") throw new PrivacyError("This is a staff account — ask the owner to remove your staff access first.");
  if (confirm.phrase !== "DELETE") throw new PrivacyError("Type DELETE to confirm.");
  if (confirm.email.trim().toLowerCase() !== user.email.toLowerCase()) throw new PrivacyError("That email doesn’t match your account.");

  const email = user.email;
  const scrubbed = deletedEmailFor(user.id);

  await db.$transaction(async (tx) => {
    // Reviews: delete, then recompute the ratings that approved ones contributed to.
    const reviewed = await tx.review.findMany({ where: { userId, approved: true }, select: { productId: true } });
    await tx.review.deleteMany({ where: { userId } });
    for (const productId of new Set(reviewed.map((r) => r.productId))) {
      const agg = await tx.review.aggregate({ where: { productId, approved: true }, _avg: { rating: true }, _count: { _all: true } });
      await tx.product.update({ where: { id: productId }, data: { ratingAvg: Math.round((agg._avg.rating ?? 0) * 10) / 10, ratingCount: agg._count._all } });
    }

    await tx.address.deleteMany({ where: { userId } });
    await tx.session.deleteMany({ where: { userId } });
    await tx.account.deleteMany({ where: { userId } });
    await tx.verificationToken.deleteMany({ where: { identifier: { equals: email, mode: "insensitive" } } });
    await tx.wishlistItem.deleteMany({ where: { userId } });
    await tx.subscription.deleteMany({ where: { userId } });
    await tx.cart.deleteMany({ where: { OR: [{ userId }, { email: { equals: email, mode: "insensitive" } }] } });
    await tx.stockAlert.deleteMany({ where: { email: { equals: email, mode: "insensitive" } } });
    await tx.newsletterSubscriber.deleteMany({ where: { email: { equals: email, mode: "insensitive" } } });
    await tx.loyaltyEntry.deleteMany({ where: { userId } });
    // Sign-in security: saved faces (encrypted embeddings), phone locks, codes, tickets, links.
    await tx.faceTemplate.deleteMany({ where: { userId } });
    await tx.passkey.deleteMany({ where: { userId } });
    await tx.securityEmailCode.deleteMany({ where: { userId } });
    await tx.securityTicket.deleteMany({ where: { userId } });
    await tx.webAuthnChallenge.deleteMany({ where: { userId } });
    await tx.enrollmentLink.deleteMany({ where: { userId } });
    await tx.securitySettings.deleteMany({ where: { userId } });

    // Customer journeys: stop runs, drop consent and segment, keep anonymous send/attribution counts, retire unused codes.
    await tx.marketingPreference.deleteMany({ where: { email: { equals: email, mode: "insensitive" } } });
    await tx.customerSegment.deleteMany({ where: { userId } });
    await tx.journeyEnrollment.updateMany({ where: { userId }, data: { context: Prisma.DbNull } });
    await tx.journeyEnrollment.updateMany({ where: { userId, status: "ACTIVE" }, data: { status: "EXITED", exitReason: "account deleted", exitedAt: new Date(), nextRunAt: null } });
    const codes = await tx.journeyMessage.findMany({ where: { userId, couponCode: { not: null } }, select: { couponCode: true } });
    await tx.coupon.updateMany({ where: { code: { in: codes.flatMap((c) => (c.couponCode ? [c.couponCode] : [])) }, usedCount: 0 }, data: { isActive: false } });
    await tx.journeyMessage.updateMany({ where: { userId }, data: { email: scrubbed } });

    // WhatsApp: forget the phone's consent record and scrub the message log (kept only as counts).
    const waPhones = (
      await tx.whatsAppContact.findMany({ where: { OR: [{ userId }, { email: { equals: email, mode: "insensitive" } }] }, select: { phone: true } })
    ).map((c) => c.phone);
    await tx.whatsAppMessage.updateMany({
      where: { OR: [{ userId }, { phone: { in: waPhones } }] },
      data: { phone: "deleted", vars: Prisma.DbNull, body: null, userId: null },
    });
    await tx.whatsAppContact.deleteMany({ where: { phone: { in: waPhones } } });

    // Returns: keep the records with their orders, drop the link and the customer's own words.
    await tx.returnRequest.updateMany({ where: { userId }, data: { userId: null, customerNote: null } });

    // Orders: keep the money, drop the person.
    const orders = await tx.order.findMany({
      where: { OR: [{ userId }, { email: { equals: email, mode: "insensitive" } }] },
      select: { id: true, shippingAddress: true },
    });
    for (const o of orders) {
      const addr = o.shippingAddress && typeof o.shippingAddress === "object" && !Array.isArray(o.shippingAddress) ? o.shippingAddress : {};
      const shippingAddress: Prisma.InputJsonObject = {
        ...addr,
        fullName: DELETED_LABEL,
        phone: DELETED_LABEL,
        line1: DELETED_LABEL,
        ...("line2" in addr && addr.line2 ? { line2: DELETED_LABEL } : {}),
      };
      await tx.order.update({
        where: { id: o.id },
        data: { userId: null, email: scrubbed, shippingAddress, giftNote: null, notes: null },
      });
    }

    await tx.user.update({
      where: { id: userId },
      data: {
        email: scrubbed,
        name: null,
        phone: null,
        image: null,
        emailVerified: null,
        loyaltyPoints: 0,
        referredById: null,
        deletionRequestedAt: new Date(),
      },
    });
  });
}
