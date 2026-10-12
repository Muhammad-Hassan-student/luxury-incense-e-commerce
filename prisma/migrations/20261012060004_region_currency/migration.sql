-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "chargeAmount" INTEGER,
ADD COLUMN     "chargeCurrency" TEXT,
ADD COLUMN     "fxRate" DOUBLE PRECISION,
ADD COLUMN     "fxRounding" TEXT;

-- CreateTable
CREATE TABLE "ExchangeRate" (
    "id" TEXT NOT NULL,
    "base" TEXT NOT NULL,
    "quote" TEXT NOT NULL,
    "rate" DOUBLE PRECISION NOT NULL,
    "manualRate" DOUBLE PRECISION,
    "source" TEXT NOT NULL DEFAULT 'auto',
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExchangeRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CurrencyConversion" (
    "id" TEXT NOT NULL,
    "fromCurrency" TEXT NOT NULL,
    "toCurrency" TEXT NOT NULL,
    "rate" DOUBLE PRECISION NOT NULL,
    "rounding" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "summary" JSONB,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "undoneAt" TIMESTAMP(3),
    "undoneById" TEXT,

    CONSTRAINT "CurrencyConversion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExchangeRate_base_quote_key" ON "ExchangeRate"("base", "quote");

-- CreateIndex
CREATE INDEX "CurrencyConversion_createdAt_idx" ON "CurrencyConversion"("createdAt");
