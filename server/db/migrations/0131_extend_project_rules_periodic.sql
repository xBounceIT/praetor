ALTER TABLE "project_rules" ALTER COLUMN "value" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "project_rules" ADD COLUMN "evaluation_mode" varchar(20) DEFAULT 'continuous' NOT NULL;--> statement-breakpoint
ALTER TABLE "project_rules" ADD COLUMN "schedule_config" jsonb DEFAULT '{"frequency":"monthly","userIds":[],"taskIds":[]}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "project_rules" ADD COLUMN "last_evaluated_period" varchar(160);--> statement-breakpoint
ALTER TABLE "project_rules" ADD COLUMN "config_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_project_rules_evaluation_mode" ON "project_rules" USING btree ("evaluation_mode");
