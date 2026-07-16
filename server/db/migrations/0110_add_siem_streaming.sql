CREATE TABLE "siem_config" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"host" varchar(255) DEFAULT '' NOT NULL,
	"port" integer DEFAULT 6514 NOT NULL,
	"protocol" varchar(8) DEFAULT 'tls' NOT NULL,
	"tcp_framing" varchar(20) DEFAULT 'newline' NOT NULL,
	"source_identifier" varchar(255) DEFAULT 'praetor' NOT NULL,
	"facility" integer DEFAULT 16 NOT NULL,
	"runtime_level" varchar(8) DEFAULT 'info' NOT NULL,
	"include_runtime" boolean DEFAULT true NOT NULL,
	"include_audit" boolean DEFAULT true NOT NULL,
	"ca_pem" text DEFAULT '' NOT NULL,
	"server_name" varchar(255) DEFAULT '' NOT NULL,
	"client_cert_pem" text DEFAULT '' NOT NULL,
	"client_key" text DEFAULT '' NOT NULL,
	"retention_days" integer DEFAULT 30 NOT NULL,
	"max_events" integer DEFAULT 1000000 NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"tested_revision" integer,
	"last_test_at" timestamp,
	"last_test_success" boolean,
	"last_delivery_at" timestamp,
	"last_error_at" timestamp,
	"last_error" text,
	"dropped_retention" integer DEFAULT 0 NOT NULL,
	"dropped_capacity" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "siem_config_id_check" CHECK ("siem_config"."id" = 1),
	CONSTRAINT "siem_config_port_check" CHECK ("siem_config"."port" BETWEEN 1 AND 65535),
	CONSTRAINT "siem_config_protocol_check" CHECK ("siem_config"."protocol" IN ('udp', 'tcp', 'tls')),
	CONSTRAINT "siem_config_tcp_framing_check" CHECK ("siem_config"."tcp_framing" IN ('newline', 'octet-counting')),
	CONSTRAINT "siem_config_facility_check" CHECK ("siem_config"."facility" BETWEEN 0 AND 23),
	CONSTRAINT "siem_config_runtime_level_check" CHECK ("siem_config"."runtime_level" IN ('trace', 'debug', 'info', 'warn', 'error', 'fatal')),
	CONSTRAINT "siem_config_retention_days_check" CHECK ("siem_config"."retention_days" BETWEEN 1 AND 30),
	CONSTRAINT "siem_config_max_events_check" CHECK ("siem_config"."max_events" BETWEEN 10000 AND 1000000)
);
--> statement-breakpoint
CREATE TABLE "siem_outbox" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"claim_token" varchar(100),
	"claimed_at" timestamp,
	"last_error" text
);
--> statement-breakpoint
CREATE INDEX "idx_siem_outbox_available" ON "siem_outbox" USING btree ("available_at","created_at");--> statement-breakpoint
CREATE INDEX "idx_siem_outbox_claimed_at" ON "siem_outbox" USING btree ("claimed_at");--> statement-breakpoint
CREATE INDEX "idx_siem_outbox_created_at" ON "siem_outbox" USING btree ("created_at");
--> statement-breakpoint
INSERT INTO "siem_config" ("id") VALUES (1) ON CONFLICT ("id") DO NOTHING;