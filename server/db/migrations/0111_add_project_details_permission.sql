INSERT INTO "role_permissions" ("role_id", "permission")
SELECT "roles"."id", 'projects.details.view'
FROM "roles"
WHERE "roles"."id" IN ('manager', 'top_manager')
  AND COALESCE("roles"."is_system", false) = true
ON CONFLICT ("role_id", "permission") DO NOTHING;
