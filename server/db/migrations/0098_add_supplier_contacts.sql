ALTER TABLE "suppliers" ADD COLUMN "contacts" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
UPDATE "suppliers"
SET "contacts" = jsonb_build_array(
  jsonb_strip_nulls(
    jsonb_build_object(
      'fullName', BTRIM("contact_name"),
      'email', NULLIF(BTRIM("email"), ''),
      'phone', NULLIF(BTRIM("phone"), '')
    )
  )
)
WHERE NULLIF(BTRIM("contact_name"), '') IS NOT NULL
  AND ("contacts" IS NULL OR "contacts" = '[]'::jsonb);
