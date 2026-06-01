CREATE TABLE "saved_view_shares" (
	"view_id" varchar(50) NOT NULL,
	"user_id" varchar(50) NOT NULL,
	"permission" varchar(10) DEFAULT 'read' NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT "saved_view_shares_view_id_user_id_pk" PRIMARY KEY("view_id","user_id"),
	CONSTRAINT "saved_view_shares_permission_check" CHECK ("saved_view_shares"."permission" IN ('read', 'write'))
);
--> statement-breakpoint
CREATE TABLE "saved_views" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"owner_id" varchar(50) NOT NULL,
	"kind" varchar(20) NOT NULL,
	"scope_key" varchar(150) NOT NULL,
	"name" varchar(255) NOT NULL,
	"config" jsonb NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT "saved_views_kind_check" CHECK ("saved_views"."kind" IN ('table', 'dashboard'))
);
--> statement-breakpoint
ALTER TABLE "saved_view_shares" ADD CONSTRAINT "saved_view_shares_view_id_saved_views_id_fk" FOREIGN KEY ("view_id") REFERENCES "public"."saved_views"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_view_shares" ADD CONSTRAINT "saved_view_shares_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_saved_view_shares_user_id" ON "saved_view_shares" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_saved_views_owner_kind_scope" ON "saved_views" USING btree ("owner_id","kind","scope_key");--> statement-breakpoint
CREATE INDEX "idx_saved_views_kind_scope" ON "saved_views" USING btree ("kind","scope_key");