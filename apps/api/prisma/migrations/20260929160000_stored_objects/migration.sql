-- CreateEnum
CREATE TYPE "StoredObjectKind" AS ENUM ('ID_IMAGE', 'FICHE_PDF');

-- CreateTable
CREATE TABLE "StoredObject" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "kind" "StoredObjectKind" NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "wrappedKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "StoredObject_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StoredObject_key_key" ON "StoredObject"("key");

-- CreateIndex
CREATE INDEX "StoredObject_accountId_idx" ON "StoredObject"("accountId");

-- CreateIndex
CREATE INDEX "StoredObject_deletedAt_expiresAt_idx" ON "StoredObject"("deletedAt", "expiresAt");

-- AddForeignKey
ALTER TABLE "StoredObject" ADD CONSTRAINT "StoredObject_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

