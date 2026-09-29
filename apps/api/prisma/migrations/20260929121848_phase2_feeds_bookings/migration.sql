/*
  Warnings:

  - You are about to drop the column `isOwnerBlock` on the `Booking` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[feedId,externalUid]` on the table `Booking` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[propertyId,confirmationCode]` on the table `Booking` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[accountId,type,propertyId,year]` on the table `Notification` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `accountId` to the `Booking` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `Booking` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "BookingClassification" AS ENUM ('BOOKING', 'OWNER_BLOCK', 'UNCERTAIN');

-- CreateEnum
CREATE TYPE "ClassifiedBy" AS ENUM ('AUTO', 'MANUAL');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('CONFIRMED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FeedStatus" AS ENUM ('NEVER', 'OK', 'ERROR');

-- DropIndex
DROP INDEX "Booking_propertyId_externalUid_key";

-- AlterTable
ALTER TABLE "Booking" DROP COLUMN "isOwnerBlock",
ADD COLUMN     "accountId" TEXT NOT NULL,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "classification" "BookingClassification" NOT NULL DEFAULT 'BOOKING',
ADD COLUMN     "classifiedBy" "ClassifiedBy" NOT NULL DEFAULT 'AUTO',
ADD COLUMN     "confirmationCode" TEXT,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "feedId" TEXT,
ADD COLUMN     "importBatchId" TEXT,
ADD COLUMN     "status" "BookingStatus" NOT NULL DEFAULT 'CONFIRMED',
ADD COLUMN     "summary" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "year" INTEGER;

-- CreateTable
CREATE TABLE "IcalFeed" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "platform" "BookingSource" NOT NULL,
    "url" TEXT NOT NULL,
    "lastSyncedAt" TIMESTAMP(3),
    "lastStatus" "FeedStatus" NOT NULL DEFAULT 'NEVER',
    "lastError" TEXT,
    "eventCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IcalFeed_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "importedCount" INTEGER NOT NULL,
    "errorCount" INTEGER NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IcalFeed_accountId_idx" ON "IcalFeed"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "IcalFeed_propertyId_platform_key" ON "IcalFeed"("propertyId", "platform");

-- CreateIndex
CREATE INDEX "ImportBatch_accountId_idx" ON "ImportBatch"("accountId");

-- CreateIndex
CREATE INDEX "ImportBatch_propertyId_idx" ON "ImportBatch"("propertyId");

-- CreateIndex
CREATE INDEX "Booking_accountId_idx" ON "Booking"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_feedId_externalUid_key" ON "Booking"("feedId", "externalUid");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_propertyId_confirmationCode_key" ON "Booking"("propertyId", "confirmationCode");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_accountId_type_propertyId_year_key" ON "Notification"("accountId", "type", "propertyId", "year");

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_feedId_fkey" FOREIGN KEY ("feedId") REFERENCES "IcalFeed"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IcalFeed" ADD CONSTRAINT "IcalFeed_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IcalFeed" ADD CONSTRAINT "IcalFeed_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Day-counter thresholds live in RuleConfig (rule 1 in CLAUDE.md): not validated by counsel yet.
INSERT INTO "RuleConfig" ("key", "value", "validatedBy", "validatedAt", "updatedAt")
VALUES ('day_counter.thresholds', '{"amber": 90, "red": 110, "cap": 120, "period": "CALENDAR_YEAR"}', NULL, NULL, NOW())
ON CONFLICT ("key") DO NOTHING;
