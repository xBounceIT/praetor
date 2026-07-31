-- Legacy tokens predate role binding. Preserve their historical behaviour by assigning the
-- user's current primary role, then require every newly-issued token to carry its creation role.
ALTER TABLE "mcp_tokens" ADD COLUMN IF NOT EXISTS "role_id" varchar(50);--> statement-breakpoint
INSERT INTO "user_roles" ("user_id", "role_id")
SELECT DISTINCT "token"."user_id", "user"."role"
FROM "mcp_tokens" AS "token"
INNER JOIN "users" AS "user" ON "user"."id" = "token"."user_id"
ON CONFLICT ("user_id", "role_id") DO NOTHING;--> statement-breakpoint
UPDATE "mcp_tokens" AS "token"
SET "role_id" = "user"."role"
FROM "users" AS "user"
WHERE "token"."user_id" = "user"."id"
  AND "token"."role_id" IS NULL;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "set_legacy_mcp_token_role"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."role_id" IS NULL THEN
    SELECT "role" INTO NEW."role_id"
    FROM "users"
    WHERE "id" = NEW."user_id";
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "mcp_tokens_set_legacy_role" ON "mcp_tokens";--> statement-breakpoint
CREATE TRIGGER "mcp_tokens_set_legacy_role"
BEFORE INSERT ON "mcp_tokens"
FOR EACH ROW
EXECUTE FUNCTION "set_legacy_mcp_token_role"();--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "mcp_tokens" WHERE "role_id" IS NULL) THEN
    RAISE EXCEPTION 'Cannot bind every MCP token to an existing user role';
  END IF;
END
$$;--> statement-breakpoint
ALTER TABLE "mcp_tokens" ALTER COLUMN "role_id" SET NOT NULL;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'mcp_tokens_role_id_roles_id_fk'
      AND conrelid = 'mcp_tokens'::regclass
  ) THEN
    ALTER TABLE "mcp_tokens"
      ADD CONSTRAINT "mcp_tokens_role_id_roles_id_fk"
      FOREIGN KEY ("role_id") REFERENCES "roles"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
END
$$;
