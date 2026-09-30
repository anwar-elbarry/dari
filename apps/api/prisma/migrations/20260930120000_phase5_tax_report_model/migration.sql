-- Phase 5.0: monthly tax report model, exports as encrypted StoredObjects, BETA rule defaults.
-- TaxReport was never written by any code (it only held placeholder URLs); clearing it lets the new NOT NULL columns be added.
DELETE FROM "TaxReport";

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StoredObjectKind" ADD VALUE 'TAX_REPORT_PDF';
ALTER TYPE "StoredObjectKind" ADD VALUE 'TAX_REPORT_XLSX';

-- DropForeignKey
ALTER TABLE "TaxReport" DROP CONSTRAINT "TaxReport_propertyId_fkey";

-- AlterTable
ALTER TABLE "TaxReport" DROP COLUMN "createdAt",
DROP COLUMN "excelUrl",
DROP COLUMN "localTaxStatementUrl",
DROP COLUMN "pdfUrl",
ADD COLUMN     "accountId" TEXT NOT NULL,
ADD COLUMN     "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "generatedBy" TEXT NOT NULL,
ADD COLUMN     "inputDigest" TEXT NOT NULL,
ADD COLUMN     "lines" JSONB NOT NULL,
ADD COLUMN     "pdfObjectId" TEXT NOT NULL,
ADD COLUMN     "problems" JSONB NOT NULL,
ADD COLUMN     "ruleVersions" JSONB NOT NULL,
ADD COLUMN     "templateVersion" TEXT NOT NULL,
ADD COLUMN     "unvalidated" BOOLEAN NOT NULL,
ADD COLUMN     "xlsxObjectId" TEXT NOT NULL;

-- One rule per commune, licence type and effective date: the local-tax lookup takes the latest one and must never tie.
DROP INDEX IF EXISTS "TaxRule_commune_licenseType_effectiveFrom_idx";
CREATE UNIQUE INDEX "TaxRule_commune_licenseType_effectiveFrom_key" ON "TaxRule"("commune", "licenseType", "effectiveFrom");

-- CreateIndex
CREATE INDEX "TaxReport_accountId_idx" ON "TaxReport"("accountId");

-- CreateIndex
CREATE INDEX "TaxReport_pdfObjectId_idx" ON "TaxReport"("pdfObjectId");

-- CreateIndex
CREATE INDEX "TaxReport_xlsxObjectId_idx" ON "TaxReport"("xlsxObjectId");

-- CreateIndex
CREATE UNIQUE INDEX "TaxReport_id_accountId_key" ON "TaxReport"("id", "accountId");

-- AddForeignKey
ALTER TABLE "TaxReport" ADD CONSTRAINT "TaxReport_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxReport" ADD CONSTRAINT "TaxReport_propertyId_accountId_fkey" FOREIGN KEY ("propertyId", "accountId") REFERENCES "Property"("id", "accountId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxReport" ADD CONSTRAINT "TaxReport_pdfObjectId_accountId_fkey" FOREIGN KEY ("pdfObjectId", "accountId") REFERENCES "StoredObject"("id", "accountId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxReport" ADD CONSTRAINT "TaxReport_xlsxObjectId_accountId_fkey" FOREIGN KEY ("xlsxObjectId", "accountId") REFERENCES "StoredObject"("id", "accountId") ON DELETE RESTRICT ON UPDATE CASCADE;


-- BETA defaults supplied by the founder (2026-09-30), NOT validated by a fiduciaire (validatedBy stays NULL).
-- They are data, not code (rule 1 in CLAUDE.md): a fiduciaire replaces them and sets validatedBy / validatedAt.
-- While any rule in use is unvalidated, every report, PDF and Excel export carries the BETA watermark.
INSERT INTO "RuleConfig" ("key", "value", "validatedBy", "validatedAt", "updatedAt")
VALUES
  ('tax.property_income', '{"thresholdCentimes": 12000000, "belowBps": 1000, "aboveBps": 1500, "mode": "WHOLE"}', NULL, NULL, NOW()),
  ('tax.vat', '{"rateBps": 1000, "basis": "INCLUSIVE"}', NULL, NULL, NOW()),
  ('tax.rounding', '{"mode": "HALF_UP", "scope": "LINE"}', NULL, NULL, NOW()),
  ('tax.stay_month', '{"rule": "CHECKOUT_MONTH"}', NULL, NULL, NOW()),
  ('tax.disclaimer.beta.en', '{"version": "beta-1", "banner": "BETA ESTIMATE - UNVERIFIED", "text": "BETA ESTIMATE - UNVERIFIED. This is a mathematical projection only and has NOT been validated by a licensed accountant. Do not use for official DGI declarations without consulting your Fiduciaire."}', NULL, NULL, NOW()),
  ('tax.disclaimer.beta.fr', '{"version": "beta-1", "banner": "ESTIMATION BÊTA - NON VÉRIFIÉE", "text": "ESTIMATION BÊTA - NON VÉRIFIÉE. Il s''agit d''une simple projection mathématique, qui n''a PAS été validée par un expert-comptable agréé. Ne pas utiliser pour des déclarations officielles à la DGI sans consulter votre fiduciaire."}', NULL, NULL, NOW()),
  ('tax.disclaimer.standard.en', '{"version": "std-1", "banner": "ESTIMATE ONLY", "text": "Estimate only - confirm with your accountant."}', NULL, NULL, NOW()),
  ('tax.disclaimer.standard.fr', '{"version": "std-1", "banner": "ESTIMATION UNIQUEMENT", "text": "Estimation uniquement - à confirmer avec votre comptable."}', NULL, NULL, NOW())
ON CONFLICT ("key") DO NOTHING;
