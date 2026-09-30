-- Phase 7.2: access tokens can be cut off (sessionsRevokedAt) and a refresh chain has an absolute lifetime (familyStartedAt).
ALTER TABLE "User" ADD COLUMN "sessionsRevokedAt" TIMESTAMP(3);
ALTER TABLE "RefreshToken" ADD COLUMN "familyStartedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
