-- CreateEnum
CREATE TYPE "ImageDisplay" AS ENUM ('AUTO', 'CUTOUT', 'PHOTO');

-- AlterTable
ALTER TABLE "ProductImage" ADD COLUMN     "cutoutUrl" TEXT,
ADD COLUMN     "display" "ImageDisplay" NOT NULL DEFAULT 'AUTO',
ADD COLUMN     "edgeColor" TEXT,
ADD COLUMN     "height" INTEGER,
ADD COLUMN     "width" INTEGER;

