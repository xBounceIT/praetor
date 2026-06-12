ALTER TABLE "tasks" ADD COLUMN "duration" numeric(10, 2) DEFAULT '1' NOT NULL;--> statement-breakpoint
UPDATE "tasks"
SET "duration" = ROUND("expected_effort" / "monthly_effort", 2)
WHERE COALESCE("expected_effort", 0) > 0
  AND COALESCE("monthly_effort", 0) > 0;--> statement-breakpoint
UPDATE "tasks"
SET "revenue" = ROUND("revenue" / "duration", 2)
WHERE COALESCE("revenue", 0) > 0
  AND COALESCE("duration", 0) > 0
  AND "duration" <> 1;--> statement-breakpoint
UPDATE "tasks"
SET "monthly_effort" = "expected_effort"
WHERE ("monthly_effort" IS NULL OR "monthly_effort" = 0)
  AND COALESCE("expected_effort", 0) > 0;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_duration_non_negative_check" CHECK ("tasks"."duration" >= 0);
