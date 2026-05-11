CREATE TABLE "mcp_tokens" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"user_id" varchar(50) NOT NULL,
	"name" varchar(120) NOT NULL,
	"token_prefix" varchar(32) NOT NULL,
	"token_hash" varchar(128) NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	"last_used_at" timestamp,
	"revoked_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "mcp_tokens" ADD CONSTRAINT "mcp_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "idx_mcp_tokens_token_hash_unique" ON "mcp_tokens" USING btree ("token_hash");
--> statement-breakpoint
CREATE INDEX "idx_mcp_tokens_user_id" ON "mcp_tokens" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "idx_mcp_tokens_active_user" ON "mcp_tokens" USING btree ("user_id","revoked_at");
