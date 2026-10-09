-- CreateEnum
CREATE TYPE "RenewalStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'SKIPPED');

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "customerRef" TEXT,
ADD COLUMN     "discountPercent" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "email" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "failureCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "intervalMonths" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "lastError" TEXT,
ADD COLUMN     "originOrderId" TEXT,
ADD COLUMN     "pauseReason" TEXT,
ADD COLUMN     "pausedAt" TIMESTAMP(3),
ADD COLUMN     "paymentMethodRef" TEXT,
ADD COLUMN     "provider" "PaymentProvider",
ADD COLUMN     "reminderFor" TIMESTAMP(3),
ADD COLUMN     "retryAt" TIMESTAMP(3),
ADD COLUMN     "shippingAddress" JSONB,
ADD COLUMN     "shippingRateId" TEXT;

-- CreateTable
CREATE TABLE "SubscriptionRenewal" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "status" "RenewalStatus" NOT NULL DEFAULT 'PENDING',
    "orderId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "SubscriptionRenewal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionRenewal_orderId_key" ON "SubscriptionRenewal"("orderId");

-- CreateIndex
CREATE INDEX "SubscriptionRenewal_status_idx" ON "SubscriptionRenewal"("status");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionRenewal_subscriptionId_dueAt_attempt_key" ON "SubscriptionRenewal"("subscriptionId", "dueAt", "attempt");

-- CreateIndex
CREATE INDEX "Subscription_status_nextRunAt_idx" ON "Subscription"("status", "nextRunAt");

-- CreateIndex
CREATE INDEX "Subscription_userId_idx" ON "Subscription"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_originOrderId_variantId_key" ON "Subscription"("originOrderId", "variantId");

-- AddForeignKey
ALTER TABLE "SubscriptionRenewal" ADD CONSTRAINT "SubscriptionRenewal_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

