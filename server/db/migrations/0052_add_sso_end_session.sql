CREATE TABLE "sso_user_sessions" (
	"user_id" varchar(50) PRIMARY KEY NOT NULL,
	"provider_id" varchar(50) NOT NULL,
	"id_token" text NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
ALTER TABLE "sso_providers" ADD COLUMN "end_session_enabled" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "sso_user_sessions" ADD CONSTRAINT "sso_user_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sso_user_sessions" ADD CONSTRAINT "sso_user_sessions_provider_id_sso_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."sso_providers"("id") ON DELETE cascade ON UPDATE no action;