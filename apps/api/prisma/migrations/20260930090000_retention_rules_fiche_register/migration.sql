-- Retention of the Fiche PDF and of the monthly police register is counsel's decision (phase-4.md, carried over from phase 3).
-- "days": null means no period is set: nothing is purged. A number is applied only once validatedBy is filled in.
INSERT INTO "RuleConfig" ("key", "value", "validatedBy", "validatedAt", "updatedAt")
VALUES
  ('retention.fiche_days', '{"days": null}', NULL, NULL, NOW()),
  ('retention.police_register_days', '{"days": null}', NULL, NULL, NOW())
ON CONFLICT ("key") DO NOTHING;
