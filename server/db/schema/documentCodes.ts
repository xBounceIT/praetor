import { sql } from 'drizzle-orm';
import { check, integer, pgTable, primaryKey, timestamp, varchar } from 'drizzle-orm/pg-core';

export const documentCodeTemplates = pgTable(
  'document_code_templates',
  {
    moduleId: varchar('module_id', { length: 50 }).primaryKey(),
    prefix: varchar('prefix', { length: 20 }).notNull(),
    template: varchar('template', { length: 120 }).notNull(),
    sequencePadding: integer('sequence_padding').notNull().default(4),
    createdAt: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp('updated_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    check('document_code_templates_prefix_not_blank', sql`length(trim(${table.prefix})) > 0`),
    check('document_code_templates_template_not_blank', sql`length(trim(${table.template})) > 0`),
    check(
      'document_code_templates_sequence_padding_check',
      sql`${table.sequencePadding} >= 1 AND ${table.sequencePadding} <= 9`,
    ),
  ],
);

export const documentCodeCounters = pgTable(
  'document_code_counters',
  {
    moduleId: varchar('module_id', { length: 50 })
      .notNull()
      .references(() => documentCodeTemplates.moduleId, {
        onDelete: 'cascade',
        onUpdate: 'cascade',
      }),
    year: integer('year').notNull(),
    nextSequence: integer('next_sequence').notNull().default(1),
    updatedAt: timestamp('updated_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    primaryKey({ columns: [table.moduleId, table.year] }),
    check('document_code_counters_year_check', sql`${table.year} >= 1 AND ${table.year} <= 9999`),
    check('document_code_counters_next_sequence_check', sql`${table.nextSequence} >= 1`),
  ],
);
