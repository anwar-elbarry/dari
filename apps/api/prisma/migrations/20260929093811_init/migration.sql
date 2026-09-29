-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER_MANAGER', 'STAFF', 'ACCOUNTANT');

-- CreateEnum
CREATE TYPE "SubscriptionTier" AS ENUM ('STARTER', 'GROWTH', 'CONCIERGERIE', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "LicenseStatus" AS ENUM ('LICENSED', 'UNLICENSED', 'PENDING');

-- CreateEnum
CREATE TYPE "LicenseType" AS ENUM ('FURNISHED_APARTMENT', 'RIAD', 'MAISON_DHOTE', 'AUBERGE');

-- CreateEnum
CREATE TYPE "TaxRegime" AS ENUM ('PROPERTY_INCOME', 'PROFESSIONAL', 'COMPANY');

-- CreateEnum
CREATE TYPE "TaxeSejourMode" AS ENUM ('INCLUDED', 'COLLECTED');

-- CreateEnum
CREATE TYPE "Residency" AS ENUM ('RESIDENT', 'NON_RESIDENT', 'MRE');

-- CreateEnum
CREATE TYPE "BankAccountType" AS ENUM ('STANDARD', 'CONVERTIBLE_DIRHAM', 'FOREIGN_CURRENCY');

-- CreateEnum
CREATE TYPE "BookingSource" AS ENUM ('AIRBNB', 'BOOKING', 'DIRECT', 'OTHER');

-- CreateEnum
CREATE TYPE "DocType" AS ENUM ('PASSPORT', 'CIN');

-- CreateEnum
CREATE TYPE "MaritalStatus" AS ENUM ('REQUIRED', 'UPLOADED', 'VERIFIED', 'EXEMPT');

-- CreateEnum
CREATE TYPE "ShareResourceType" AS ENUM ('FICHE_DE_POLICE', 'POLICE_REGISTER');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('INFO', 'AMBER', 'RED');

-- CreateEnum
CREATE TYPE "ChecklistStatus" AS ENUM ('TODO', 'DONE');

-- CreateEnum
CREATE TYPE "VendorType" AS ENUM ('TRANSPORT', 'CATERING', 'GUIDE', 'OTHER');

-- CreateEnum
CREATE TYPE "AddOnType" AS ENUM ('TRANSFER', 'MEAL', 'ALCOHOL', 'TOUR', 'OTHER');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED');

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "subscriptionTier" "SubscriptionTier" NOT NULL DEFAULT 'STARTER',
    "billingStatus" TEXT NOT NULL DEFAULT 'trial',
    "seatLimit" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "role" "Role" NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "lastLoginAt" TIMESTAMP(3),
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "replacedById" TEXT,
    "userAgent" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "invitedBy" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PropertyOwner" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "taxId" TEXT,
    "residency" "Residency" NOT NULL,
    "bankAccountType" "BankAccountType" NOT NULL DEFAULT 'STANDARD',

    CONSTRAINT "PropertyOwner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Property" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "commune" TEXT NOT NULL,
    "licenseStatus" "LicenseStatus" NOT NULL DEFAULT 'UNLICENSED',
    "licenseType" "LicenseType" NOT NULL,
    "taxRegime" "TaxRegime" NOT NULL DEFAULT 'PROPERTY_INCOME',
    "taxeSejourMode" "TaxeSejourMode" NOT NULL DEFAULT 'COLLECTED',
    "icalUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Property_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Booking" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "checkIn" DATE NOT NULL,
    "checkOut" DATE NOT NULL,
    "partySize" INTEGER,
    "nightlyRevenue" DECIMAL(12,2),
    "cleaningFee" DECIMAL(12,2),
    "addonRevenue" DECIMAL(12,2),
    "discounts" DECIMAL(12,2),
    "refunds" DECIMAL(12,2),
    "platformCommission" DECIMAL(12,2),
    "taxeSejourAmount" DECIMAL(12,2),
    "source" "BookingSource" NOT NULL,
    "externalUid" TEXT,
    "isOwnerBlock" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuestCheckIn" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "fullName" TEXT,
    "nationality" TEXT,
    "declaredMoroccanNationality" BOOLEAN NOT NULL DEFAULT false,
    "docType" "DocType",
    "docNumber" TEXT,
    "dob" DATE,
    "docFileUrl" TEXT,
    "ocrConfidence" DOUBLE PRECISION,
    "entryStampNumber" TEXT,
    "cityOfOrigin" TEXT,
    "nextDestination" TEXT,
    "profession" TEXT,
    "consentAt" TIMESTAMP(3),
    "consentVersion" TEXT,
    "submittedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "GuestCheckIn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaritalDocument" (
    "id" TEXT NOT NULL,
    "guestCheckInId" TEXT NOT NULL,
    "fileUrl" TEXT,
    "status" "MaritalStatus" NOT NULL DEFAULT 'REQUIRED',
    "verifiedBy" TEXT,
    "exemptReason" TEXT,
    "uploadedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "MaritalDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FicheDePolice" (
    "id" TEXT NOT NULL,
    "guestCheckInId" TEXT NOT NULL,
    "pdfUrl" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FicheDePolice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PoliceRegister" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "pdfUrl" TEXT NOT NULL,
    "generatedBy" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PoliceRegister_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShareLink" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "resourceType" "ShareResourceType" NOT NULL,
    "resourceId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "recipientLabel" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "maxViews" INTEGER,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShareLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxRule" (
    "id" TEXT NOT NULL,
    "commune" TEXT NOT NULL,
    "licenseType" "LicenseType" NOT NULL,
    "taxeSejourRate" DECIMAL(8,2) NOT NULL,
    "tptRate" DECIMAL(8,2) NOT NULL,
    "basis" TEXT NOT NULL DEFAULT 'PER_PERSON_NIGHT',
    "effectiveFrom" DATE NOT NULL,
    "validatedBy" TEXT,
    "validatedAt" TIMESTAMP(3),

    CONSTRAINT "TaxRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RuleConfig" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "validatedBy" TEXT,
    "validatedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RuleConfig_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "TaxReport" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "regime" "TaxRegime" NOT NULL,
    "nightsRevenue" DECIMAL(12,2) NOT NULL,
    "addonRevenue" DECIMAL(12,2) NOT NULL,
    "grossBase" DECIMAL(12,2) NOT NULL,
    "taxeSejourDeducted" DECIMAL(12,2) NOT NULL,
    "vatTotal" DECIMAL(12,2) NOT NULL,
    "incomeTaxTotal" DECIMAL(12,2) NOT NULL,
    "localTaxTotal" DECIMAL(12,2) NOT NULL,
    "bankAccountType" "BankAccountType",
    "localTaxStatementUrl" TEXT,
    "pdfUrl" TEXT,
    "excelUrl" TEXT,
    "disclaimerVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaxReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChecklistItem" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "stepName" TEXT NOT NULL,
    "status" "ChecklistStatus" NOT NULL DEFAULT 'TODO',
    "documentUrl" TEXT,
    "cityScope" TEXT NOT NULL DEFAULT 'Marrakech',
    "licenseTypeScope" "LicenseType",
    "condition" TEXT,

    CONSTRAINT "ChecklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" "Severity" NOT NULL DEFAULT 'INFO',
    "propertyId" TEXT,
    "bookingId" TEXT,
    "message" TEXT NOT NULL,
    "sentVia" TEXT[],
    "readAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vendor" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "type" "VendorType" NOT NULL,
    "companyName" TEXT NOT NULL,
    "licenseNumber" TEXT,
    "driverPhone" TEXT,
    "docUrl" TEXT,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AddOnService" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "type" "AddOnType" NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "vendorId" TEXT,
    "licenseDocUrl" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "AddOnService_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AddOnOrder" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "commission" DECIMAL(12,2) NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',

    CONSTRAINT "AddOnOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_accountId_idx" ON "User"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_tokenHash_key" ON "Invitation"("tokenHash");

-- CreateIndex
CREATE INDEX "Invitation_accountId_idx" ON "Invitation"("accountId");

-- CreateIndex
CREATE INDEX "Invitation_email_idx" ON "Invitation"("email");

-- CreateIndex
CREATE INDEX "PropertyOwner_accountId_idx" ON "PropertyOwner"("accountId");

-- CreateIndex
CREATE INDEX "Property_accountId_idx" ON "Property"("accountId");

-- CreateIndex
CREATE INDEX "Booking_propertyId_checkIn_idx" ON "Booking"("propertyId", "checkIn");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_propertyId_externalUid_key" ON "Booking"("propertyId", "externalUid");

-- CreateIndex
CREATE UNIQUE INDEX "GuestCheckIn_tokenHash_key" ON "GuestCheckIn"("tokenHash");

-- CreateIndex
CREATE INDEX "GuestCheckIn_bookingId_idx" ON "GuestCheckIn"("bookingId");

-- CreateIndex
CREATE INDEX "GuestCheckIn_expiresAt_idx" ON "GuestCheckIn"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "MaritalDocument_guestCheckInId_key" ON "MaritalDocument"("guestCheckInId");

-- CreateIndex
CREATE UNIQUE INDEX "FicheDePolice_guestCheckInId_key" ON "FicheDePolice"("guestCheckInId");

-- CreateIndex
CREATE INDEX "PoliceRegister_propertyId_month_idx" ON "PoliceRegister"("propertyId", "month");

-- CreateIndex
CREATE UNIQUE INDEX "ShareLink_tokenHash_key" ON "ShareLink"("tokenHash");

-- CreateIndex
CREATE INDEX "ShareLink_accountId_idx" ON "ShareLink"("accountId");

-- CreateIndex
CREATE INDEX "TaxRule_commune_licenseType_effectiveFrom_idx" ON "TaxRule"("commune", "licenseType", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "TaxReport_propertyId_month_key" ON "TaxReport"("propertyId", "month");

-- CreateIndex
CREATE INDEX "ChecklistItem_propertyId_idx" ON "ChecklistItem"("propertyId");

-- CreateIndex
CREATE INDEX "Notification_accountId_resolvedAt_idx" ON "Notification"("accountId", "resolvedAt");

-- CreateIndex
CREATE INDEX "AuditLog_accountId_createdAt_idx" ON "AuditLog"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "Vendor_accountId_idx" ON "Vendor"("accountId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyOwner" ADD CONSTRAINT "PropertyOwner_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Property" ADD CONSTRAINT "Property_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Property" ADD CONSTRAINT "Property_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "PropertyOwner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestCheckIn" ADD CONSTRAINT "GuestCheckIn_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaritalDocument" ADD CONSTRAINT "MaritalDocument_guestCheckInId_fkey" FOREIGN KEY ("guestCheckInId") REFERENCES "GuestCheckIn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FicheDePolice" ADD CONSTRAINT "FicheDePolice_guestCheckInId_fkey" FOREIGN KEY ("guestCheckInId") REFERENCES "GuestCheckIn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoliceRegister" ADD CONSTRAINT "PoliceRegister_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShareLink" ADD CONSTRAINT "ShareLink_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxReport" ADD CONSTRAINT "TaxReport_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistItem" ADD CONSTRAINT "ChecklistItem_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vendor" ADD CONSTRAINT "Vendor_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AddOnService" ADD CONSTRAINT "AddOnService_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AddOnService" ADD CONSTRAINT "AddOnService_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AddOnOrder" ADD CONSTRAINT "AddOnOrder_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AddOnOrder" ADD CONSTRAINT "AddOnOrder_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "AddOnService"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
