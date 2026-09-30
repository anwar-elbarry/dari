-- Digest of the input of a generated register, to tell when it is outdated. Existing rows (none in production: the feature is new)
-- get '' which never equals a digest, so they read as outdated and are regenerated.
ALTER TABLE "PoliceRegister" ADD COLUMN "inputDigest" TEXT NOT NULL DEFAULT '';
ALTER TABLE "PoliceRegister" ALTER COLUMN "inputDigest" DROP DEFAULT;
