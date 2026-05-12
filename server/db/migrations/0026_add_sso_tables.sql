CREATE TABLE "external_identities" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"provider_id" varchar(50) NOT NULL,
	"protocol" varchar(20) NOT NULL,
	"issuer" varchar(1000) NOT NULL,
	"subject" varchar(500) NOT NULL,
	"user_id" varchar(50) NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT "external_identities_protocol_check" CHECK ("external_identities"."protocol" IN ('oidc', 'saml'))
);
--> statement-breakpoint
CREATE TABLE "sso_login_tickets" (
	"ticket" varchar(255) PRIMARY KEY NOT NULL,
	"user_id" varchar(50) NOT NULL,
	"active_role" varchar(50) NOT NULL,
	"expires_at" timestamp NOT NULL,
	"consumed_at" timestamp,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE "sso_providers" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"protocol" varchar(20) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"name" varchar(255) NOT NULL,
	"enabled" boolean DEFAULT false,
	"issuer_url" varchar(1000) DEFAULT '',
	"client_id" varchar(255) DEFAULT '',
	"client_secret" text DEFAULT '',
	"scopes" varchar(500) DEFAULT 'openid profile email',
	"metadata_url" varchar(1000) DEFAULT '',
	"metadata_xml" text DEFAULT '',
	"entry_point" varchar(1000) DEFAULT '',
	"idp_issuer" varchar(1000) DEFAULT '',
	"idp_cert" text DEFAULT '',
	"sp_issuer" varchar(1000) DEFAULT '',
	"private_key" text DEFAULT '',
	"public_cert" text DEFAULT '',
	"username_attribute" varchar(255) DEFAULT 'preferred_username',
	"name_attribute" varchar(255) DEFAULT 'name',
	"email_attribute" varchar(255) DEFAULT 'email',
	"groups_attribute" varchar(255) DEFAULT 'groups',
	"role_mappings" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT "sso_providers_protocol_check" CHECK ("sso_providers"."protocol" IN ('oidc', 'saml'))
);
--> statement-breakpoint
CREATE TABLE "sso_states" (
	"state" varchar(255) PRIMARY KEY NOT NULL,
	"provider_id" varchar(50) NOT NULL,
	"protocol" varchar(20) NOT NULL,
	"code_verifier" text DEFAULT '',
	"relay_state" text DEFAULT '',
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT "sso_states_protocol_check" CHECK ("sso_states"."protocol" IN ('oidc', 'saml'))
);
--> statement-breakpoint
ALTER TABLE "external_identities" ADD CONSTRAINT "external_identities_provider_id_sso_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."sso_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_identities" ADD CONSTRAINT "external_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sso_login_tickets" ADD CONSTRAINT "sso_login_tickets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sso_states" ADD CONSTRAINT "sso_states_provider_id_sso_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."sso_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_external_identities_identity_unique" ON "external_identities" USING btree ("provider_id","protocol","issuer","subject");--> statement-breakpoint
CREATE INDEX "idx_external_identities_user_id" ON "external_identities" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_sso_login_tickets_user_id" ON "sso_login_tickets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_sso_login_tickets_expires_at" ON "sso_login_tickets" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_sso_providers_slug_unique" ON "sso_providers" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "idx_sso_providers_protocol_enabled" ON "sso_providers" USING btree ("protocol","enabled");--> statement-breakpoint
CREATE INDEX "idx_sso_states_expires_at" ON "sso_states" USING btree ("expires_at");
