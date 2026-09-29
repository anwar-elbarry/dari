-- AlterTable
ALTER TABLE "GuestCheckIn" ADD COLUMN     "uploadCount" INTEGER NOT NULL DEFAULT 0,
ALTER COLUMN "guestIndex" DROP NOT NULL;

