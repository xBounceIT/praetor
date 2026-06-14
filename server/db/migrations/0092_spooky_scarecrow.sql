CREATE TABLE "document_code_counters" (
	"module_id" varchar(50) NOT NULL,
	"year" integer NOT NULL,
	"next_sequence" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT "document_code_counters_module_id_year_pk" PRIMARY KEY("module_id","year"),
	CONSTRAINT "document_code_counters_year_check" CHECK ("document_code_counters"."year" >= 1 AND "document_code_counters"."year" <= 9999),
	CONSTRAINT "document_code_counters_next_sequence_check" CHECK ("document_code_counters"."next_sequence" >= 1)
);
--> statement-breakpoint
CREATE TABLE "document_code_templates" (
	"module_id" varchar(50) PRIMARY KEY NOT NULL,
	"prefix" varchar(20) NOT NULL,
	"template" varchar(120) NOT NULL,
	"sequence_padding" integer DEFAULT 4 NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT "document_code_templates_prefix_not_blank" CHECK (length(trim("document_code_templates"."prefix")) > 0),
	CONSTRAINT "document_code_templates_template_not_blank" CHECK (length(trim("document_code_templates"."template")) > 0),
	CONSTRAINT "document_code_templates_sequence_padding_check" CHECK ("document_code_templates"."sequence_padding" >= 1 AND "document_code_templates"."sequence_padding" <= 9)
);
--> statement-breakpoint
INSERT INTO "document_code_templates" ("module_id", "prefix", "template", "sequence_padding") VALUES
	('client_quote', 'PREV', '{PREFIX}_{YY}_{SEQ}', 4),
	('client_offer', 'OFF', '{PREFIX}_{YY}_{SEQ}', 4),
	('supplier_quote', 'FORN', '{PREFIX}_{YY}_{SEQ}', 4),
	('client_order', 'ORD', '{PREFIX}_{YY}_{SEQ}', 4),
	('supplier_order', 'SORD', '{PREFIX}_{YY}_{SEQ}', 4),
	('client_invoice', 'INV', '{PREFIX}_{YY}_{SEQ}', 4),
	('supplier_invoice', 'SINV', '{PREFIX}_{YY}_{SEQ}', 4)
ON CONFLICT ("module_id") DO NOTHING;
--> statement-breakpoint
ALTER TABLE "document_code_counters" ADD CONSTRAINT "document_code_counters_module_id_document_code_templates_module_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."document_code_templates"("module_id") ON DELETE cascade ON UPDATE cascade;
