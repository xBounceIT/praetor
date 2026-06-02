import { sql } from 'drizzle-orm';
import { check, integer, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core';

// Single-row table holding app-wide branding (company display name + uploaded logo
// metadata). `id` is pinned to 1 by the column default and a CHECK, mirroring
// `general_settings`. The logo bytes live on disk (see server/utils/fileStorage.ts);
// only the stored filename / mime / size are persisted here. The row is created lazily
// by the repository's upsert helpers, so no seed insert is required.
export const appBranding = pgTable(
  'app_branding',
  {
    id: integer('id').primaryKey().default(1),
    companyName: varchar('company_name', { length: 120 }),
    logoStoredName: varchar('logo_stored_name', { length: 255 }),
    logoMimeType: varchar('logo_mime_type', { length: 100 }),
    logoFileSize: integer('logo_file_size'),
    logoUpdatedAt: timestamp('logo_updated_at'),
    updatedAt: timestamp('updated_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [check('app_branding_id_check', sql`${table.id} = 1`)],
);
