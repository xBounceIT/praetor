ALTER TABLE "ldap_config" ADD COLUMN "first_name_attribute" varchar(255) DEFAULT 'givenName';--> statement-breakpoint
ALTER TABLE "ldap_config" ADD COLUMN "last_name_attribute" varchar(255) DEFAULT 'sn';--> statement-breakpoint
ALTER TABLE "ldap_config" ADD COLUMN "email_attribute" varchar(255) DEFAULT 'mail';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "first_name" varchar(255);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_name" varchar(255);