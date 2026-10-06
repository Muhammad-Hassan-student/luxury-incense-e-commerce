import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/server/db";
import { GiftCardBuilder } from "@/components/product/gift-card-builder";
import { VALIDITY_DAYS } from "@/server/gift-cards";

export const metadata: Metadata = {
  title: "Gift card",
  description: "A Maison Oud gift card, delivered by email with your message. Redeemable on anything in the house for a year.",
};

export default async function GiftCardPage() {
  const product = await db.product.findFirst({
    where: { isGiftCard: true, isActive: true },
    include: { variants: { orderBy: { position: "asc" } } },
  });
  if (!product) notFound();
  const session = await auth();
  return (
    <GiftCardBuilder
      palette={product.palette}
      amounts={product.variants.map((v) => ({ variantId: v.id, label: v.label, price: v.price }))}
      senderName={session?.user?.name ?? ""}
      validityDays={VALIDITY_DAYS}
    />
  );
}
