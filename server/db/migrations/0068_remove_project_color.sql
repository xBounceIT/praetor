DROP INDEX IF EXISTS "idx_projects_color_unique";--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN IF EXISTS "color";