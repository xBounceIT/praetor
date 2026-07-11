ALTER TABLE "quote_communication_channels" ADD COLUMN "icon" varchar(50) DEFAULT 'comments' NOT NULL;--> statement-breakpoint
ALTER TABLE "quote_communication_channels" ADD COLUMN "is_default" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "quote_communication_channels"
SET
	"icon" = CASE "id"
		WHEN 'qcc_email' THEN 'envelope'
		WHEN 'qcc_telefono' THEN 'phone'
		WHEN 'qcc_whatsapp' THEN 'whatsapp'
		ELSE "icon"
	END,
	"is_default" = true
WHERE "id" IN ('qcc_email', 'qcc_telefono', 'qcc_whatsapp');
