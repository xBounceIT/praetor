import { sql } from 'drizzle-orm';
import { index, integer, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core';
import { supplierQuotes } from './supplierQuotes.ts';
import { users } from './users.ts';

export const supplierQuoteAttachments = pgTable(
  'supplier_quote_attachments',
  {
    id: varchar('id', { length: 50 }).primaryKey(),
    quoteId: varchar('quote_id', { length: 100 })
      .notNull()
      .references(() => supplierQuotes.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    fileName: varchar('file_name', { length: 255 }).notNull(),
    storedName: varchar('stored_name', { length: 255 }).notNull(),
    mimeType: varchar('mime_type', { length: 100 }).notNull(),
    fileSize: integer('file_size').notNull(),
    uploadedByUserId: varchar('uploaded_by_user_id', { length: 50 }).references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index('idx_supplier_quote_attachments_quote_id').on(table.quoteId)],
);
