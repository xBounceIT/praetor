ALTER TABLE "saved_views" DROP CONSTRAINT IF EXISTS "saved_views_kind_check";--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'saved_views_kind_check'
  ) THEN
    ALTER TABLE "saved_views"
      ADD CONSTRAINT "saved_views_kind_check"
      CHECK ("kind" IN ('table', 'dashboard', 'report'));
  END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_saved_views_report_owner_scope_name_unique"
  ON "saved_views" USING btree ("owner_id", "kind", "scope_key", lower("name"))
  WHERE "kind" = 'report';--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT r.id, grants.permission
  FROM "roles" r
 CROSS JOIN (
   VALUES
     ('user', 'reports.time_report.view'),
     ('manager', 'reports.time_report.view'),
     ('manager', 'reports.time_report_all.view'),
     ('top_manager', 'reports.time_report.view'),
     ('top_manager', 'reports.time_report_all.view')
 ) AS grants(role_id, permission)
 WHERE r.id = grants.role_id
   AND COALESCE(r.is_system, false) = true
ON CONFLICT ("role_id", "permission") DO NOTHING;
