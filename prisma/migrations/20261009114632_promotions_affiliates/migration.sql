-- CreateEnum
CREATE TYPE "PromotionType" AS ENUM ('FLASH_SALE', 'BUY_X_GET_Y', 'MULTI_BUY', 'FIXED_BUNDLE', 'TIERED');

-- CreateEnum
CREATE TYPE "AffiliateStatus" AS ENUM ('INVITED', 'PENDING', 'APPROVED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "CommissionStatus" AS ENUM ('ATTRIBUTED', 'PENDING', 'APPROVED', 'PAID', 'REVERSED', 'REJECTED');

-- CreateTable
CREATE TABLE "Promotion" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "PromotionType" NOT NULL,
    "badge" TEXT,
    "config" JSONB NOT NULL,
    "productIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "categoryIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "stackable" BOOLEAN NOT NULL DEFAULT true,
    "allowCoupon" BOOLEAN NOT NULL DEFAULT true,
    "includeTrade" BOOLEAN NOT NULL DEFAULT false,
    "includeSubscriptions" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Promotion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderPromotion" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "promotionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "PromotionType" NOT NULL,
    "discount" INTEGER NOT NULL,
    "revenue" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderPromotion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PreorderVariant" (
    "variantId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "shipDate" TIMESTAMP(3) NOT NULL,
    "cap" INTEGER,
    "sold" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PreorderVariant_pkey" PRIMARY KEY ("variantId")
);

-- CreateTable
CREATE TABLE "Affiliate" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "userId" TEXT,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "status" "AffiliateStatus" NOT NULL DEFAULT 'PENDING',
    "commissionBps" INTEGER,
    "couponCode" TEXT,
    "payoutDetails" TEXT,
    "ipHashes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "deviceIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Affiliate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AffiliateClick" (
    "id" TEXT NOT NULL,
    "affiliateId" TEXT NOT NULL,
    "ipHash" TEXT,
    "deviceId" TEXT,
    "path" TEXT,
    "referrer" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AffiliateClick_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AffiliateCommission" (
    "id" TEXT NOT NULL,
    "affiliateId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "clickedAt" TIMESTAMP(3),
    "status" "CommissionStatus" NOT NULL DEFAULT 'ATTRIBUTED',
    "rateBps" INTEGER NOT NULL,
    "base" INTEGER NOT NULL DEFAULT 0,
    "amount" INTEGER NOT NULL DEFAULT 0,
    "flags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ipHash" TEXT,
    "deviceId" TEXT,
    "clawback" INTEGER NOT NULL DEFAULT 0,
    "clawbackPayoutId" TEXT,
    "payoutId" TEXT,
    "note" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "reversedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AffiliateCommission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AffiliatePayout" (
    "id" TEXT NOT NULL,
    "batch" TEXT NOT NULL,
    "affiliateId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "commissions" INTEGER NOT NULL,
    "clawback" INTEGER NOT NULL DEFAULT 0,
    "reference" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AffiliatePayout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Promotion_isActive_startsAt_endsAt_idx" ON "Promotion"("isActive", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "OrderPromotion_promotionId_idx" ON "OrderPromotion"("promotionId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderPromotion_orderId_promotionId_key" ON "OrderPromotion"("orderId", "promotionId");

-- CreateIndex
CREATE UNIQUE INDEX "Affiliate_code_key" ON "Affiliate"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Affiliate_userId_key" ON "Affiliate"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Affiliate_couponCode_key" ON "Affiliate"("couponCode");

-- CreateIndex
CREATE INDEX "Affiliate_email_idx" ON "Affiliate"("email");

-- CreateIndex
CREATE INDEX "AffiliateClick_affiliateId_createdAt_idx" ON "AffiliateClick"("affiliateId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AffiliateCommission_orderId_key" ON "AffiliateCommission"("orderId");

-- CreateIndex
CREATE INDEX "AffiliateCommission_affiliateId_status_idx" ON "AffiliateCommission"("affiliateId", "status");

-- CreateIndex
CREATE INDEX "AffiliateCommission_status_confirmedAt_idx" ON "AffiliateCommission"("status", "confirmedAt");

-- CreateIndex
CREATE INDEX "AffiliatePayout_batch_idx" ON "AffiliatePayout"("batch");

-- CreateIndex
CREATE INDEX "AffiliatePayout_affiliateId_idx" ON "AffiliatePayout"("affiliateId");
