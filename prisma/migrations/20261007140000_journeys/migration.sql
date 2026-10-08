-- CreateEnum
CREATE TYPE "JourneyEnrollmentStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'EXITED', 'CONVERTED');

-- CreateEnum
CREATE TYPE "JourneyMessageStatus" AS ENUM ('SENDING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "Journey" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "trigger" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Journey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JourneyEnrollment" (
    "id" TEXT NOT NULL,
    "journeyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "entryKey" TEXT NOT NULL,
    "status" "JourneyEnrollmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "step" INTEGER NOT NULL DEFAULT 0,
    "nextRunAt" TIMESTAMP(3),
    "enteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "exitedAt" TIMESTAMP(3),
    "exitReason" TEXT,
    "context" JSONB,
    "convertedOrderId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JourneyEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JourneyMessage" (
    "id" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "step" INTEGER NOT NULL,
    "template" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "status" "JourneyMessageStatus" NOT NULL DEFAULT 'SENDING',
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "couponCode" TEXT,
    "couponExpiresAt" TIMESTAMP(3),
    "points" INTEGER,
    "convertedOrderId" TEXT,
    "revenue" INTEGER,
    "convertedAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "JourneyMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerSegment" (
    "userId" TEXT NOT NULL,
    "segment" TEXT NOT NULL,
    "since" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerSegment_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "MarketingPreference" (
    "email" TEXT NOT NULL,
    "journeys" BOOLEAN NOT NULL DEFAULT true,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingPreference_pkey" PRIMARY KEY ("email")
);

-- CreateIndex
CREATE UNIQUE INDEX "Journey_key_key" ON "Journey"("key");

-- CreateIndex
CREATE INDEX "JourneyEnrollment_status_nextRunAt_idx" ON "JourneyEnrollment"("status", "nextRunAt");

-- CreateIndex
CREATE INDEX "JourneyEnrollment_userId_status_idx" ON "JourneyEnrollment"("userId", "status");

-- CreateIndex
CREATE INDEX "JourneyEnrollment_journeyId_enteredAt_idx" ON "JourneyEnrollment"("journeyId", "enteredAt");

-- CreateIndex
CREATE UNIQUE INDEX "JourneyEnrollment_journeyId_userId_entryKey_key" ON "JourneyEnrollment"("journeyId", "userId", "entryKey");

-- CreateIndex
CREATE UNIQUE INDEX "JourneyMessage_couponCode_key" ON "JourneyMessage"("couponCode");

-- CreateIndex
CREATE UNIQUE INDEX "JourneyMessage_convertedOrderId_key" ON "JourneyMessage"("convertedOrderId");

-- CreateIndex
CREATE INDEX "JourneyMessage_userId_sentAt_idx" ON "JourneyMessage"("userId", "sentAt");

-- CreateIndex
CREATE INDEX "JourneyMessage_sentAt_idx" ON "JourneyMessage"("sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "JourneyMessage_enrollmentId_step_key" ON "JourneyMessage"("enrollmentId", "step");

-- CreateIndex
CREATE INDEX "CustomerSegment_segment_since_idx" ON "CustomerSegment"("segment", "since");

-- AddForeignKey
ALTER TABLE "JourneyEnrollment" ADD CONSTRAINT "JourneyEnrollment_journeyId_fkey" FOREIGN KEY ("journeyId") REFERENCES "Journey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JourneyEnrollment" ADD CONSTRAINT "JourneyEnrollment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JourneyMessage" ADD CONSTRAINT "JourneyMessage_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "JourneyEnrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JourneyMessage" ADD CONSTRAINT "JourneyMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerSegment" ADD CONSTRAINT "CustomerSegment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
