/*
  Warnings:

  - Added the required column `updatedAt` to the `GiftCard` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
ALTER TYPE "Model3D" ADD VALUE 'CARD';

-- AlterTable
ALTER TABLE "Cart" ADD COLUMN     "giftCardCode" TEXT;

-- AlterTable
ALTER TABLE "GiftCard" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "recipientEmail" TEXT,
ADD COLUMN     "senderName" TEXT,
ADD COLUMN     "sourceOrderId" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "giftCardAmount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "giftCardCode" TEXT;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "meta" JSONB;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "isGiftCard" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "GiftCard_sourceOrderId_idx" ON "GiftCard"("sourceOrderId");
