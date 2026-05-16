-- Migration 0054: enforce case-insensitive uniqueness on users.username (#640).
-- Pre-flight aborts on existing case-only collisions: silently merging would let an
-- attacker pick which of two shadowed rows survives, so we require manual resolution.

DO $$
DECLARE
    collision_rows text;
BEGIN
    SELECT string_agg(
        format('LOWER(%L) -> [%s]', lower_username, usernames),
        '; '
    )
    INTO collision_rows
    FROM (
        SELECT LOWER(username) AS lower_username,
               string_agg(username, ', ' ORDER BY username) AS usernames
        FROM users
        GROUP BY LOWER(username)
        HAVING COUNT(*) > 1
    ) AS dupes;

    IF collision_rows IS NOT NULL THEN
        RAISE EXCEPTION
            'Cannot enforce case-insensitive uniqueness on users.username: existing case-only collisions detected (%). Resolve manually by merging or renaming the conflicting rows before re-running this migration.',
            collision_rows;
    END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_users_username_lower_unique" ON "users" (LOWER("username"));
