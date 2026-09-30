-- Phase 6.1: licensing checklist, team management and messaging model.
-- ChecklistItem was never written by any code (it held a free-text step name and a document URL);
-- clearing it lets the new NOT NULL columns be added.
DELETE FROM "ChecklistItem";

-- CreateEnum
CREATE TYPE "MessageChannel" AS ENUM ('WHATSAPP', 'EMAIL');

-- CreateEnum
CREATE TYPE "MessageSubject" AS ENUM ('CHECKIN_LINK', 'ALERT', 'SHARE_LINK');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'FELL_BACK');

-- CreateEnum
CREATE TYPE "PreferredChannel" AS ENUM ('WHATSAPP', 'EMAIL', 'BOTH', 'NONE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.
ALTER TYPE "ChecklistStatus" ADD VALUE 'IN_PROGRESS';
ALTER TYPE "ChecklistStatus" ADD VALUE 'NOT_APPLICABLE';

-- AlterEnum
ALTER TYPE "StoredObjectKind" ADD VALUE 'LICENSE_DOCUMENT';

-- DropForeignKey
ALTER TABLE "ChecklistItem" DROP CONSTRAINT "ChecklistItem_propertyId_fkey";

-- DropIndex
DROP INDEX "ChecklistItem_propertyId_idx";

-- AlterTable
ALTER TABLE "ChecklistItem" DROP COLUMN "cityScope",
DROP COLUMN "condition",
DROP COLUMN "documentUrl",
DROP COLUMN "licenseTypeScope",
DROP COLUMN "stepName",
ADD COLUMN     "accountId" TEXT NOT NULL,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "documentObjectId" TEXT,
ADD COLUMN     "dueDate" DATE,
ADD COLUMN     "note" TEXT,
ADD COLUMN     "templateStepId" TEXT NOT NULL,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "updatedBy" TEXT;

-- AlterTable
ALTER TABLE "Invitation" ADD COLUMN     "resendCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "resentAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ChecklistTemplateStep" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "cityScope" TEXT NOT NULL DEFAULT 'Marrakech',
    "licenseTypeScope" "LicenseType",
    "condition" TEXT,
    "position" INTEGER NOT NULL,
    "nameFr" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "validatedBy" TEXT,
    "validatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChecklistTemplateStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageDelivery" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "channel" "MessageChannel" NOT NULL,
    "template" TEXT NOT NULL,
    "subjectType" "MessageSubject" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "status" "MessageStatus" NOT NULL DEFAULT 'QUEUED',
    "providerMessageId" TEXT,
    "failureCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MessageDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "alertType" TEXT NOT NULL,
    "channel" "PreferredChannel" NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChecklistTemplateStep_cityScope_licenseTypeScope_position_idx" ON "ChecklistTemplateStep"("cityScope", "licenseTypeScope", "position");

-- CreateIndex
CREATE UNIQUE INDEX "ChecklistTemplateStep_cityScope_code_key" ON "ChecklistTemplateStep"("cityScope", "code");

-- CreateIndex
CREATE INDEX "MessageDelivery_accountId_subjectType_subjectId_idx" ON "MessageDelivery"("accountId", "subjectType", "subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "MessageDelivery_id_accountId_key" ON "MessageDelivery"("id", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "MessageDelivery_channel_providerMessageId_key" ON "MessageDelivery"("channel", "providerMessageId");

-- CreateIndex
CREATE INDEX "NotificationPreference_accountId_idx" ON "NotificationPreference"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationPreference_userId_alertType_key" ON "NotificationPreference"("userId", "alertType");

-- CreateIndex
CREATE INDEX "ChecklistItem_accountId_idx" ON "ChecklistItem"("accountId");

-- CreateIndex
CREATE INDEX "ChecklistItem_documentObjectId_idx" ON "ChecklistItem"("documentObjectId");

-- CreateIndex
CREATE UNIQUE INDEX "ChecklistItem_propertyId_templateStepId_key" ON "ChecklistItem"("propertyId", "templateStepId");

-- CreateIndex
CREATE UNIQUE INDEX "ChecklistItem_id_accountId_key" ON "ChecklistItem"("id", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "User_id_accountId_key" ON "User"("id", "accountId");

-- AddForeignKey
ALTER TABLE "ChecklistItem" ADD CONSTRAINT "ChecklistItem_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistItem" ADD CONSTRAINT "ChecklistItem_propertyId_accountId_fkey" FOREIGN KEY ("propertyId", "accountId") REFERENCES "Property"("id", "accountId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistItem" ADD CONSTRAINT "ChecklistItem_templateStepId_fkey" FOREIGN KEY ("templateStepId") REFERENCES "ChecklistTemplateStep"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistItem" ADD CONSTRAINT "ChecklistItem_documentObjectId_accountId_fkey" FOREIGN KEY ("documentObjectId", "accountId") REFERENCES "StoredObject"("id", "accountId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageDelivery" ADD CONSTRAINT "MessageDelivery_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_accountId_fkey" FOREIGN KEY ("userId", "accountId") REFERENCES "User"("id", "accountId") ON DELETE CASCADE ON UPDATE CASCADE;


-- Rules as data (rule 1 in CLAUDE.md). None is validated: validatedBy stays NULL.
-- retention.license_documents_days: no default, counsel decides; nothing is deleted until a validated period exists.
-- whatsapp.templates: names come from Meta's approval, so they are empty until the templates exist; a missing name means "send by e-mail".
-- messaging.quiet_hours / messaging.daily_cap: the plan's proposals (no sends 22:00 to 07:00 Africa/Casablanca except urgent alerts; a daily cap per account).
INSERT INTO "RuleConfig" ("key", "value", "validatedBy", "validatedAt", "updatedAt")
VALUES
  ('retention.license_documents_days', '{"days": null}', NULL, NULL, NOW()),
  ('whatsapp.templates', '{"checkin_link": {"name": null, "language": "fr"}, "day_counter_alert": {"name": null, "language": "fr"}, "share_link": {"name": null, "language": "fr"}}', NULL, NULL, NOW()),
  ('messaging.quiet_hours', '{"start": "22:00", "end": "07:00", "timezone": "Africa/Casablanca"}', NULL, NULL, NOW()),
  ('messaging.daily_cap', '{"messages": 200}', NULL, NULL, NOW())
ON CONFLICT ("key") DO NOTHING;
