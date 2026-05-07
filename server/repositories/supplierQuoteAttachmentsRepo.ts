import { desc, eq } from 'drizzle-orm';
import { type DbExecutor, db } from '../db/drizzle.ts';
import { supplierQuoteAttachments } from '../db/schema/supplierQuoteAttachments.ts';

export type SupplierQuoteAttachment = {
  id: string;
  quoteId: string;
  fileName: string;
  storedName: string;
  mimeType: string;
  fileSize: number;
  uploadedByUserId: string | null;
  createdAt: number;
};

const mapRow = (row: typeof supplierQuoteAttachments.$inferSelect): SupplierQuoteAttachment => ({
  id: row.id,
  quoteId: row.quoteId,
  fileName: row.fileName,
  storedName: row.storedName,
  mimeType: row.mimeType,
  fileSize: row.fileSize,
  uploadedByUserId: row.uploadedByUserId,
  createdAt: row.createdAt?.getTime() ?? 0,
});

export const listForQuote = async (
  quoteId: string,
  exec: DbExecutor = db,
): Promise<SupplierQuoteAttachment[]> => {
  const rows = await exec
    .select()
    .from(supplierQuoteAttachments)
    .where(eq(supplierQuoteAttachments.quoteId, quoteId))
    .orderBy(desc(supplierQuoteAttachments.createdAt));
  return rows.map(mapRow);
};

export const findById = async (
  attachmentId: string,
  exec: DbExecutor = db,
): Promise<SupplierQuoteAttachment | null> => {
  const rows = await exec
    .select()
    .from(supplierQuoteAttachments)
    .where(eq(supplierQuoteAttachments.id, attachmentId))
    .limit(1);
  return rows[0] ? mapRow(rows[0]) : null;
};

export type NewSupplierQuoteAttachment = {
  id: string;
  quoteId: string;
  fileName: string;
  storedName: string;
  mimeType: string;
  fileSize: number;
  uploadedByUserId: string | null;
};

export const insert = async (
  input: NewSupplierQuoteAttachment,
  exec: DbExecutor = db,
): Promise<SupplierQuoteAttachment> => {
  const [row] = await exec
    .insert(supplierQuoteAttachments)
    .values({
      id: input.id,
      quoteId: input.quoteId,
      fileName: input.fileName,
      storedName: input.storedName,
      mimeType: input.mimeType,
      fileSize: input.fileSize,
      uploadedByUserId: input.uploadedByUserId,
    })
    .returning();
  return mapRow(row);
};

export const deleteById = async (
  attachmentId: string,
  exec: DbExecutor = db,
): Promise<SupplierQuoteAttachment | null> => {
  const rows = await exec
    .delete(supplierQuoteAttachments)
    .where(eq(supplierQuoteAttachments.id, attachmentId))
    .returning();
  return rows[0] ? mapRow(rows[0]) : null;
};
