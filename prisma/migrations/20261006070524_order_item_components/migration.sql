-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "components" TEXT[] DEFAULT ARRAY[]::TEXT[];
