-- Guest check-in model (Phase 3.2). The old GuestCheckIn / FicheDePolice tables were never written by any
-- code, so adding NOT NULL columns is safe on every environment; if this fails on a table that has rows,
-- stop and investigate rather than deleting them.
--
-- CreateEnum
CREATE TYPE "GuestCheckInStatus" AS ENUM ('PENDING', 'SUBMITTED', 'VERIFIED');

-- DropForeignKey
ALTER TABLE "FicheDePolice" DROP CONSTRAINT "FicheDePolice_guestCheckInId_fkey";

-- DropForeignKey
ALTER TABLE "GuestCheckIn" DROP CONSTRAINT "GuestCheckIn_bookingId_fkey";

-- DropIndex
DROP INDEX "GuestCheckIn_expiresAt_idx";

-- DropIndex
DROP INDEX "GuestCheckIn_tokenHash_key";

-- AlterTable
ALTER TABLE "FicheDePolice" DROP COLUMN "pdfUrl",
ADD COLUMN     "accountId" TEXT NOT NULL,
ADD COLUMN     "pdfObjectId" TEXT NOT NULL,
ADD COLUMN     "sha256" TEXT NOT NULL,
ADD COLUMN     "templateVersion" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "GuestCheckIn" DROP COLUMN "consentVersion",
DROP COLUMN "docFileUrl",
DROP COLUMN "expiresAt",
DROP COLUMN "tokenHash",
ADD COLUMN     "accountId" TEXT NOT NULL,
ADD COLUMN     "consentTextId" TEXT,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "docExpiryDate" DATE,
ADD COLUMN     "docImageId" TEXT,
ADD COLUMN     "guestIndex" INTEGER NOT NULL,
ADD COLUMN     "linkId" TEXT NOT NULL,
ADD COLUMN     "ocrFieldsFlagged" JSONB,
ADD COLUMN     "propertyId" TEXT NOT NULL,
ADD COLUMN     "status" "GuestCheckInStatus" NOT NULL DEFAULT 'PENDING';

-- CreateTable
CREATE TABLE "CheckInLink" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "guestsSubmitted" INTEGER NOT NULL DEFAULT 0,
    "maxGuests" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CheckInLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentText" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsentText_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CheckInLink_tokenHash_key" ON "CheckInLink"("tokenHash");

-- CreateIndex
CREATE INDEX "CheckInLink_accountId_idx" ON "CheckInLink"("accountId");

-- CreateIndex
CREATE INDEX "CheckInLink_bookingId_idx" ON "CheckInLink"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "CheckInLink_id_accountId_key" ON "CheckInLink"("id", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "ConsentText_version_locale_key" ON "ConsentText"("version", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_id_accountId_key" ON "Booking"("id", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_id_propertyId_accountId_key" ON "Booking"("id", "propertyId", "accountId");

-- CreateIndex
CREATE INDEX "FicheDePolice_accountId_idx" ON "FicheDePolice"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "FicheDePolice_guestCheckInId_accountId_key" ON "FicheDePolice"("guestCheckInId", "accountId");

-- CreateIndex
CREATE INDEX "GuestCheckIn_accountId_idx" ON "GuestCheckIn"("accountId");

-- CreateIndex
CREATE INDEX "GuestCheckIn_linkId_idx" ON "GuestCheckIn"("linkId");

-- CreateIndex
CREATE UNIQUE INDEX "GuestCheckIn_id_accountId_key" ON "GuestCheckIn"("id", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "GuestCheckIn_bookingId_guestIndex_key" ON "GuestCheckIn"("bookingId", "guestIndex");

-- CreateIndex
CREATE UNIQUE INDEX "StoredObject_id_accountId_key" ON "StoredObject"("id", "accountId");

-- AddForeignKey
ALTER TABLE "CheckInLink" ADD CONSTRAINT "CheckInLink_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckInLink" ADD CONSTRAINT "CheckInLink_bookingId_accountId_fkey" FOREIGN KEY ("bookingId", "accountId") REFERENCES "Booking"("id", "accountId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestCheckIn" ADD CONSTRAINT "GuestCheckIn_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestCheckIn" ADD CONSTRAINT "GuestCheckIn_bookingId_propertyId_accountId_fkey" FOREIGN KEY ("bookingId", "propertyId", "accountId") REFERENCES "Booking"("id", "propertyId", "accountId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestCheckIn" ADD CONSTRAINT "GuestCheckIn_linkId_accountId_fkey" FOREIGN KEY ("linkId", "accountId") REFERENCES "CheckInLink"("id", "accountId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestCheckIn" ADD CONSTRAINT "GuestCheckIn_docImageId_accountId_fkey" FOREIGN KEY ("docImageId", "accountId") REFERENCES "StoredObject"("id", "accountId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestCheckIn" ADD CONSTRAINT "GuestCheckIn_consentTextId_fkey" FOREIGN KEY ("consentTextId") REFERENCES "ConsentText"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FicheDePolice" ADD CONSTRAINT "FicheDePolice_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FicheDePolice" ADD CONSTRAINT "FicheDePolice_guestCheckInId_accountId_fkey" FOREIGN KEY ("guestCheckInId", "accountId") REFERENCES "GuestCheckIn"("id", "accountId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FicheDePolice" ADD CONSTRAINT "FicheDePolice_pdfObjectId_accountId_fkey" FOREIGN KEY ("pdfObjectId", "accountId") REFERENCES "StoredObject"("id", "accountId") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Retention and link lifetime are legal/operational parameters: data, not code (rule 1 in CLAUDE.md).
-- Not validated by counsel yet (validatedBy stays NULL); the values are the plan's defaults.
INSERT INTO "RuleConfig" ("key", "value", "validatedBy", "validatedAt", "updatedAt")
VALUES
  ('retention.id_images_days', '{"days": 30}', NULL, NULL, NOW()),
  ('checkin.link_grace_hours', '{"hours": 48}', NULL, NULL, NOW())
ON CONFLICT ("key") DO NOTHING;
