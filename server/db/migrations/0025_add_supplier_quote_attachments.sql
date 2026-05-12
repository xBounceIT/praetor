CREATE TABLE "supplier_quote_attachments" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"quote_id" varchar(100) NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"stored_name" varchar(255) NOT NULL,
	"mime_type" varchar(100) NOT NULL,
	"file_size" integer NOT NULL,
	"uploaded_by_user_id" varchar(50),
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
ALTER TABLE "supplier_quote_attachments" ADD CONSTRAINT "supplier_quote_attachments_quote_id_supplier_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."supplier_quotes"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "supplier_quote_attachments" ADD CONSTRAINT "supplier_quote_attachments_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_supplier_quote_attachments_quote_id" ON "supplier_quote_attachments" USING btree ("quote_id");