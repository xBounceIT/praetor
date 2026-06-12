CREATE TABLE IF NOT EXISTS "quote_communication_channels" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT "quote_communication_channels_name_unique" UNIQUE("name")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_quote_communication_channels_name" ON "quote_communication_channels" USING btree ("name");--> statement-breakpoint
INSERT INTO "quote_communication_channels" ("id", "name")
VALUES
	('qcc_email', 'Email'),
	('qcc_telefono', 'Telefono'),
	('qcc_whatsapp', 'WhatsApp')
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "communication_channel_id" varchar(50);--> statement-breakpoint
ALTER TABLE "supplier_quotes" ADD COLUMN "communication_channel_id" varchar(50);--> statement-breakpoint
UPDATE "quotes"
SET "communication_channel_id" = 'qcc_email'
WHERE "communication_channel_id" IS NULL;--> statement-breakpoint
UPDATE "supplier_quotes"
SET "communication_channel_id" = 'qcc_email'
WHERE "communication_channel_id" IS NULL;--> statement-breakpoint
ALTER TABLE "quotes" ALTER COLUMN "communication_channel_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_quotes" ALTER COLUMN "communication_channel_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_communication_channel_id_quote_communication_channels_id_fk" FOREIGN KEY ("communication_channel_id") REFERENCES "public"."quote_communication_channels"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "supplier_quotes" ADD CONSTRAINT "supplier_quotes_communication_channel_id_quote_communication_channels_id_fk" FOREIGN KEY ("communication_channel_id") REFERENCES "public"."quote_communication_channels"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_quotes_communication_channel_id" ON "quotes" USING btree ("communication_channel_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_supplier_quotes_communication_channel_id" ON "supplier_quotes" USING btree ("communication_channel_id");
