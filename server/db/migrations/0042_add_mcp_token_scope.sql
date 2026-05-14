DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'mcp_tokens' AND column_name = 'scope'
    ) THEN
        ALTER TABLE "mcp_tokens" ADD COLUMN "scope" varchar(16) DEFAULT 'full' NOT NULL;
    END IF;
END $$;
