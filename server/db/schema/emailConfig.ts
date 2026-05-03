import { sql } from 'drizzle-orm';
import { boolean, check, integer, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core';

// Single-row config table — `id` is pinned to 1 by both the column default and a CHECK.
//
// `smtp_encryption` has no CHECK in the legacy schema (older versions accepted any string,
// see commit a1f1fcac). The repo normalizes the value at the boundary so consumers get a
// typed `SmtpEncryption` union; the column itself stays a plain varchar.
export const emailConfig = pgTable(
  'email_config',
  {
    id: integer('id').primaryKey().default(1),
    enabled: boolean('enabled').default(false),
    smtpHost: varchar('smtp_host', { length: 255 }).default(''),
    smtpPort: integer('smtp_port').default(587),
    smtpEncryption: varchar('smtp_encryption', { length: 20 }).default('tls'),
    smtpRejectUnauthorized: boolean('smtp_reject_unauthorized').default(true),
    smtpUser: varchar('smtp_user', { length: 255 }).default(''),
    smtpPassword: varchar('smtp_password', { length: 255 }).default(''),
    fromEmail: varchar('from_email', { length: 255 }).default(''),
    fromName: varchar('from_name', { length: 255 }).default('Praetor'),
    updatedAt: timestamp('updated_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [check('email_config_id_check', sql`${table.id} = 1`)],
);
