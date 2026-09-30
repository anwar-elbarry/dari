-- DropForeignKey
ALTER TABLE "Booking" DROP CONSTRAINT "Booking_feedId_fkey";

-- DropForeignKey
ALTER TABLE "Booking" DROP CONSTRAINT "Booking_importBatchId_fkey";

-- DropForeignKey
ALTER TABLE "Notification" DROP CONSTRAINT "Notification_propertyId_fkey";

-- CreateIndex
CREATE UNIQUE INDEX "IcalFeed_id_accountId_key" ON "IcalFeed"("id", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "ImportBatch_id_accountId_key" ON "ImportBatch"("id", "accountId");

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_feedId_accountId_fkey" FOREIGN KEY ("feedId", "accountId") REFERENCES "IcalFeed"("id", "accountId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_importBatchId_accountId_fkey" FOREIGN KEY ("importBatchId", "accountId") REFERENCES "ImportBatch"("id", "accountId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_propertyId_accountId_fkey" FOREIGN KEY ("propertyId", "accountId") REFERENCES "Property"("id", "accountId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_bookingId_accountId_fkey" FOREIGN KEY ("bookingId", "accountId") REFERENCES "Booking"("id", "accountId") ON DELETE CASCADE ON UPDATE CASCADE;

