-- DropForeignKey
ALTER TABLE "Booking" DROP CONSTRAINT "Booking_propertyId_fkey";

-- DropForeignKey
ALTER TABLE "IcalFeed" DROP CONSTRAINT "IcalFeed_propertyId_fkey";

-- DropForeignKey
ALTER TABLE "ImportBatch" DROP CONSTRAINT "ImportBatch_propertyId_fkey";

-- DropForeignKey
ALTER TABLE "Property" DROP CONSTRAINT "Property_ownerId_fkey";

-- CreateIndex
CREATE UNIQUE INDEX "Property_id_accountId_key" ON "Property"("id", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "PropertyOwner_id_accountId_key" ON "PropertyOwner"("id", "accountId");

-- AddForeignKey
ALTER TABLE "Property" ADD CONSTRAINT "Property_ownerId_accountId_fkey" FOREIGN KEY ("ownerId", "accountId") REFERENCES "PropertyOwner"("id", "accountId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_propertyId_accountId_fkey" FOREIGN KEY ("propertyId", "accountId") REFERENCES "Property"("id", "accountId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IcalFeed" ADD CONSTRAINT "IcalFeed_propertyId_accountId_fkey" FOREIGN KEY ("propertyId", "accountId") REFERENCES "Property"("id", "accountId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_propertyId_accountId_fkey" FOREIGN KEY ("propertyId", "accountId") REFERENCES "Property"("id", "accountId") ON DELETE CASCADE ON UPDATE CASCADE;

