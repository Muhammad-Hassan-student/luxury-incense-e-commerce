-- CreateTable
CREATE TABLE "ContentTranslation" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "fields" JSONB NOT NULL DEFAULT '{}',
    "published" JSONB,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "source" TEXT NOT NULL DEFAULT 'ai',
    "sourceHash" TEXT,
    "sourceText" JSONB,
    "publishedHash" TEXT,
    "queuedAt" TIMESTAMP(3),
    "lockedUntil" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "model" TEXT,
    "translatedAt" TIMESTAMP(3),
    "translatedById" TEXT,
    "publishedAt" TIMESTAMP(3),
    "publishedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentTranslation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContentTranslation_locale_entityType_idx" ON "ContentTranslation"("locale", "entityType");

-- CreateIndex
CREATE INDEX "ContentTranslation_queuedAt_idx" ON "ContentTranslation"("queuedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ContentTranslation_entityType_entityId_locale_key" ON "ContentTranslation"("entityType", "entityId", "locale");
