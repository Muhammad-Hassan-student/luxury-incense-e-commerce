-- CreateEnum
CREATE TYPE "MediaType" AS ENUM ('IMAGE', 'VIDEO');

-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "heroImage" TEXT,
ADD COLUMN     "heroVideo" TEXT;

-- AlterTable
ALTER TABLE "ProductImage" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "poster" TEXT,
ADD COLUMN     "type" "MediaType" NOT NULL DEFAULT 'IMAGE';

-- CreateIndex
CREATE INDEX "ProductImage_productId_position_idx" ON "ProductImage"("productId", "position");
