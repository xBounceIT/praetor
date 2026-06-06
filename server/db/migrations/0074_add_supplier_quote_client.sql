ALTER TABLE "supplier_quotes" ADD COLUMN "client_id" varchar(50);--> statement-breakpoint
ALTER TABLE "supplier_quotes" ADD COLUMN "client_name" varchar(255);--> statement-breakpoint
ALTER TABLE "supplier_quotes" ADD CONSTRAINT "supplier_quotes_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_supplier_quotes_client_id" ON "supplier_quotes" USING btree ("client_id");