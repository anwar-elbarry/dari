-- Seat limits per plan are a commercial parameter: data, not code (rule 1 in CLAUDE.md).
-- Founder's figures (2026-09-30): Starter 1 seat (1 Admin), Growth 3 (1 Admin + 2 Staff), Conciergerie 6 (1 Admin + 5 Staff).
-- The Accountant is a read-only external reader and does not use a seat: only the listed roles are counted.
-- ENTERPRISE has no figure yet, so it is absent: the account keeps whatever Account.seatLimit the operator sets.
-- validatedBy stays NULL: this is the founder's pricing, not a legal validation.
INSERT INTO "RuleConfig" ("key", "value", "validatedBy", "validatedAt", "updatedAt")
VALUES ('plan.seat_limits', '{"limits": {"STARTER": 1, "GROWTH": 3, "CONCIERGERIE": 6}, "countedRoles": ["OWNER_MANAGER", "STAFF"]}', NULL, NULL, NOW())
ON CONFLICT ("key") DO NOTHING;

-- Existing accounts on a paid plan still carry the column default (1).
UPDATE "Account" SET "seatLimit" = 3 WHERE "subscriptionTier" = 'GROWTH' AND "seatLimit" = 1;
UPDATE "Account" SET "seatLimit" = 6 WHERE "subscriptionTier" = 'CONCIERGERIE' AND "seatLimit" = 1;
