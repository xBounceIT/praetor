-- Personal access tokens were previously hashed with plain SHA-256 (no server-side secret),
-- making the stored hashes brute-forceable from a DB read. Switching to HMAC-SHA256 keyed by
-- ENCRYPTION_KEY changes the hash format, so existing rows can no longer be validated.
-- Truncate them; users get a fresh PAT on the next GET /api/settings/personal-access-token.
TRUNCATE TABLE "personal_access_tokens";
