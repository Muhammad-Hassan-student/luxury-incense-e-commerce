-- CreateEnum
CREATE TYPE "CodStatus" AS ENUM ('AWAITING', 'CONFIRMED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WhatsAppStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'RECEIVED');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "codConfirmBy" TIMESTAMP(3),
ADD COLUMN     "codConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "codConfirmedVia" TEXT,
ADD COLUMN     "codReminderSentAt" TIMESTAMP(3),
ADD COLUMN     "codStatus" "CodStatus",
ADD COLUMN     "codTokenHash" TEXT,
ADD COLUMN     "riskReasons" JSONB,
ADD COLUMN     "riskScore" INTEGER,
ADD COLUMN     "whatsappOptIn" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "WhatsAppMessage" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'out',
    "kind" TEXT NOT NULL,
    "template" TEXT,
    "vars" JSONB,
    "body" TEXT,
    "status" "WhatsAppStatus" NOT NULL DEFAULT 'QUEUED',
    "waMessageId" TEXT,
    "error" TEXT,
    "test" BOOLEAN NOT NULL DEFAULT false,
    "orderId" TEXT,
    "userId" TEXT,
    "cartId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppContact" (
    "phone" TEXT NOT NULL,
    "optedIn" BOOLEAN NOT NULL DEFAULT false,
    "consentAt" TIMESTAMP(3),
    "optedOutAt" TIMESTAMP(3),
    "source" TEXT,
    "email" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppContact_pkey" PRIMARY KEY ("phone")
);

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppMessage_waMessageId_key" ON "WhatsAppMessage"("waMessageId");

-- CreateIndex
CREATE INDEX "WhatsAppMessage_phone_createdAt_idx" ON "WhatsAppMessage"("phone", "createdAt");

-- CreateIndex
CREATE INDEX "WhatsAppMessage_orderId_idx" ON "WhatsAppMessage"("orderId");

-- CreateIndex
CREATE INDEX "WhatsAppMessage_cartId_idx" ON "WhatsAppMessage"("cartId");

-- CreateIndex
CREATE INDEX "WhatsAppContact_email_idx" ON "WhatsAppContact"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Order_codTokenHash_key" ON "Order"("codTokenHash");

-- CreateIndex
CREATE INDEX "Order_codStatus_codConfirmBy_idx" ON "Order"("codStatus", "codConfirmBy");

-- AddForeignKey
ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

