/*
  Warnings:

  - A unique constraint covering the columns `[propertyId,source,confirmationCode]` on the table `Booking` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "Booking_propertyId_confirmationCode_key";

-- CreateIndex
CREATE UNIQUE INDEX "Booking_propertyId_source_confirmationCode_key" ON "Booking"("propertyId", "source", "confirmationCode");
