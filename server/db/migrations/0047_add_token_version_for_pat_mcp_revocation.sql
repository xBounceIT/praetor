ALTER TABLE "mcp_tokens" ADD COLUMN "token_version_at_issue" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "personal_access_tokens" ADD COLUMN "token_version_at_issue" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "token_version" integer DEFAULT 1 NOT NULL;