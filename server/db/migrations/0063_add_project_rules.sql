CREATE TABLE "project_rules" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"project_id" varchar(50) NOT NULL,
	"name" varchar(255) NOT NULL,
	"field" varchar(50) NOT NULL,
	"operator" varchar(30) NOT NULL,
	"value" varchar(255) NOT NULL,
	"action_type" varchar(30) DEFAULT 'notify' NOT NULL,
	"action_config" jsonb DEFAULT '{"recipientUserIds":[],"recipientRoleIds":[]}'::jsonb NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"condition_met" boolean DEFAULT false NOT NULL,
	"last_triggered_at" timestamp,
	"created_by" varchar(50),
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
ALTER TABLE "project_rules" ADD CONSTRAINT "project_rules_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_rules" ADD CONSTRAINT "project_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_project_rules_project_id" ON "project_rules" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "idx_project_rules_enabled" ON "project_rules" USING btree ("is_enabled");--> statement-breakpoint
CREATE INDEX "idx_project_rules_condition_met" ON "project_rules" USING btree ("condition_met");