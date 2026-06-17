import { and, eq, sql } from 'drizzle-orm';
import { type DbExecutor, db, executeRows } from '../db/drizzle.ts';
import { customerOffers } from '../db/schema/customerOffers.ts';
import { documentCodeCounters, documentCodeTemplates } from '../db/schema/documentCodes.ts';
import { invoices } from '../db/schema/invoices.ts';
import { quotes } from '../db/schema/quotes.ts';
import { sales } from '../db/schema/sales.ts';
import { supplierInvoices } from '../db/schema/supplierInvoices.ts';
import { supplierQuotes } from '../db/schema/supplierQuotes.ts';
import { supplierSales } from '../db/schema/supplierSales.ts';
import {
  DOCUMENT_CODE_MODULE_IDS,
  type DocumentCodeModuleId,
  type DocumentCodeTemplateConfig,
  withDocumentCodeDefaults,
} from '../utils/document-codes.ts';

export type StoredDocumentCodeTemplate = Omit<DocumentCodeTemplateConfig, 'label'>;

const mapTemplate = (
  row: typeof documentCodeTemplates.$inferSelect,
): StoredDocumentCodeTemplate => ({
  moduleId: row.moduleId as DocumentCodeModuleId,
  prefix: row.prefix,
  template: row.template,
  sequencePadding: row.sequencePadding,
});

const DOCUMENT_CODE_MODULE_ID_SET = new Set<string>(DOCUMENT_CODE_MODULE_IDS);

export const list = async (exec: DbExecutor = db): Promise<DocumentCodeTemplateConfig[]> => {
  const rows = await exec.select().from(documentCodeTemplates);
  const byModule = new Map<DocumentCodeModuleId, StoredDocumentCodeTemplate>();
  for (const row of rows) {
    if (DOCUMENT_CODE_MODULE_ID_SET.has(row.moduleId)) {
      const mapped = mapTemplate(row);
      byModule.set(mapped.moduleId, mapped);
    }
  }
  return DOCUMENT_CODE_MODULE_IDS.map((moduleId) =>
    withDocumentCodeDefaults(byModule.get(moduleId) ?? { moduleId }),
  );
};

export const findByModuleId = async (
  moduleId: DocumentCodeModuleId,
  exec: DbExecutor = db,
): Promise<DocumentCodeTemplateConfig> => {
  const rows = await exec
    .select()
    .from(documentCodeTemplates)
    .where(eq(documentCodeTemplates.moduleId, moduleId))
    .limit(1);
  return withDocumentCodeDefaults(rows[0] ? mapTemplate(rows[0]) : { moduleId });
};

export const upsertMany = async (
  templates: StoredDocumentCodeTemplate[],
  exec: DbExecutor = db,
): Promise<DocumentCodeTemplateConfig[]> => {
  if (templates.length === 0) return list(exec);
  await exec
    .insert(documentCodeTemplates)
    .values(
      templates.map((template) => ({
        moduleId: template.moduleId,
        prefix: template.prefix,
        template: template.template,
        sequencePadding: template.sequencePadding,
      })),
    )
    .onConflictDoUpdate({
      target: documentCodeTemplates.moduleId,
      set: {
        prefix: sql`excluded.prefix`,
        template: sql`excluded.template`,
        sequencePadding: sql`excluded.sequence_padding`,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      },
    });
  return list(exec);
};

export const allocateSequence = async (
  moduleId: DocumentCodeModuleId,
  year: number,
  exec: DbExecutor = db,
): Promise<number> => {
  const rows = await executeRows<{ sequence: string | number }>(
    exec,
    sql`INSERT INTO document_code_counters (module_id, year, next_sequence, updated_at)
        VALUES (${moduleId}, ${year}, 2, CURRENT_TIMESTAMP)
        ON CONFLICT (module_id, year)
        DO UPDATE SET
          next_sequence = document_code_counters.next_sequence + 1,
          updated_at = CURRENT_TIMESTAMP
        RETURNING next_sequence - 1 AS "sequence"`,
  );
  const sequence = Number(rows[0]?.sequence);
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new Error('Document code counter did not return a valid sequence');
  }
  return sequence;
};

export const getNextSequence = async (
  moduleId: DocumentCodeModuleId,
  year: number,
  exec: DbExecutor = db,
): Promise<number> => {
  const rows = await exec
    .select({ nextSequence: documentCodeCounters.nextSequence })
    .from(documentCodeCounters)
    .where(and(eq(documentCodeCounters.moduleId, moduleId), eq(documentCodeCounters.year, year)))
    .limit(1);
  const sequence = Number(rows[0]?.nextSequence ?? 1);
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new Error('Document code counter did not return a valid next sequence');
  }
  return sequence;
};

export const existsForModule = async (
  moduleId: DocumentCodeModuleId,
  code: string,
  exec: DbExecutor = db,
): Promise<boolean> => {
  switch (moduleId) {
    case 'client_quote': {
      const rows = await exec
        .select({ id: quotes.id })
        .from(quotes)
        .where(eq(quotes.id, code))
        .limit(1);
      return rows.length > 0;
    }
    case 'client_offer': {
      const rows = await exec
        .select({ id: customerOffers.id })
        .from(customerOffers)
        .where(eq(customerOffers.id, code))
        .limit(1);
      return rows.length > 0;
    }
    case 'supplier_quote': {
      const rows = await exec
        .select({ id: supplierQuotes.id })
        .from(supplierQuotes)
        .where(eq(supplierQuotes.id, code))
        .limit(1);
      return rows.length > 0;
    }
    case 'client_order': {
      const rows = await exec
        .select({ id: sales.id })
        .from(sales)
        .where(eq(sales.id, code))
        .limit(1);
      return rows.length > 0;
    }
    case 'supplier_order': {
      const rows = await exec
        .select({ id: supplierSales.id })
        .from(supplierSales)
        .where(eq(supplierSales.id, code))
        .limit(1);
      return rows.length > 0;
    }
    case 'client_invoice': {
      const rows = await exec
        .select({ id: invoices.id })
        .from(invoices)
        .where(eq(invoices.id, code))
        .limit(1);
      return rows.length > 0;
    }
    case 'supplier_invoice': {
      const rows = await exec
        .select({ id: supplierInvoices.id })
        .from(supplierInvoices)
        .where(eq(supplierInvoices.id, code))
        .limit(1);
      return rows.length > 0;
    }
  }
};
