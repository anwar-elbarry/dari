-- Phase 4.1: police register and Secure Share model.
-- PoliceRegister was never written by any code (it only held the placeholder pdfUrl); clearing it lets the new NOT NULL columns be added.
DELETE FROM "PoliceRegister";

-- AlterEnum
ALTER TYPE "StoredObjectKind" ADD VALUE 'POLICE_REGISTER_PDF';

-- DropForeignKey
ALTER TABLE "PoliceRegister" DROP CONSTRAINT "PoliceRegister_propertyId_fkey";

-- DropIndex
DROP INDEX "PoliceRegister_propertyId_month_idx";

-- AlterTable
ALTER TABLE "PoliceRegister" DROP COLUMN "pdfUrl",
ADD COLUMN     "accountId" TEXT NOT NULL,
ADD COLUMN     "guestCount" INTEGER NOT NULL,
ADD COLUMN     "pdfObjectId" TEXT NOT NULL,
ADD COLUMN     "sha256" TEXT NOT NULL,
ADD COLUMN     "templateVersion" TEXT NOT NULL,
ADD COLUMN     "validation" JSONB NOT NULL;

-- CreateTable
CREATE TABLE "ShareAccess" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "shareLinkId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userAgent" TEXT NOT NULL,

    CONSTRAINT "ShareAccess_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShareAccess_shareLinkId_at_idx" ON "ShareAccess"("shareLinkId", "at");

-- CreateIndex
CREATE INDEX "ShareAccess_accountId_idx" ON "ShareAccess"("accountId");

-- CreateIndex
CREATE INDEX "PoliceRegister_accountId_idx" ON "PoliceRegister"("accountId");

-- CreateIndex
CREATE INDEX "PoliceRegister_pdfObjectId_idx" ON "PoliceRegister"("pdfObjectId");

-- CreateIndex
CREATE UNIQUE INDEX "PoliceRegister_propertyId_month_key" ON "PoliceRegister"("propertyId", "month");

-- CreateIndex
CREATE UNIQUE INDEX "PoliceRegister_id_accountId_key" ON "PoliceRegister"("id", "accountId");

-- CreateIndex
CREATE INDEX "ShareLink_resourceType_resourceId_idx" ON "ShareLink"("resourceType", "resourceId");

-- CreateIndex
CREATE UNIQUE INDEX "ShareLink_id_accountId_key" ON "ShareLink"("id", "accountId");

-- AddForeignKey
ALTER TABLE "PoliceRegister" ADD CONSTRAINT "PoliceRegister_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoliceRegister" ADD CONSTRAINT "PoliceRegister_propertyId_accountId_fkey" FOREIGN KEY ("propertyId", "accountId") REFERENCES "Property"("id", "accountId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoliceRegister" ADD CONSTRAINT "PoliceRegister_pdfObjectId_accountId_fkey" FOREIGN KEY ("pdfObjectId", "accountId") REFERENCES "StoredObject"("id", "accountId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShareAccess" ADD CONSTRAINT "ShareAccess_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShareAccess" ADD CONSTRAINT "ShareAccess_shareLinkId_accountId_fkey" FOREIGN KEY ("shareLinkId", "accountId") REFERENCES "ShareLink"("id", "accountId") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Share lifetime bounds (hours) chosen by the manager at creation. Defaults from the plan, not validated by counsel.
INSERT INTO "RuleConfig" ("key", "value", "validatedBy", "validatedAt", "updatedAt")
VALUES
  ('share.min_hours', '{"hours": 24}', NULL, NULL, NOW()),
  ('share.max_hours', '{"hours": 72}', NULL, NULL, NOW())
ON CONFLICT ("key") DO NOTHING;
