import type {
  RevisionRow,
  SupplierQuote,
  SupplierQuoteAttachment,
  SupplierQuoteRevision,
  SupplierQuoteVersion,
  SupplierQuoteVersionRow,
} from '../../types';
import { fetchApi, fetchApiStream } from './client';
import { normalizeSupplierQuote } from './normalizers';
import { encodePathSegment } from './path';

const supplierQuotePath = (id: string): string => `/sales/supplier-quotes/${encodePathSegment(id)}`;

export const supplierQuotesApi = {
  list: (): Promise<SupplierQuote[]> =>
    fetchApi<SupplierQuote[]>('/sales/supplier-quotes').then((quotes) =>
      quotes.map(normalizeSupplierQuote),
    ),

  create: (quoteData: Partial<SupplierQuote>): Promise<SupplierQuote> =>
    fetchApi<SupplierQuote>('/sales/supplier-quotes', {
      method: 'POST',
      body: JSON.stringify(quoteData),
    }).then(normalizeSupplierQuote),

  update: (id: string, updates: Partial<SupplierQuote>): Promise<SupplierQuote> =>
    fetchApi<SupplierQuote>(supplierQuotePath(id), {
      method: 'PUT',
      body: JSON.stringify(updates),
    }).then(normalizeSupplierQuote),

  delete: (id: string): Promise<void> => fetchApi(supplierQuotePath(id), { method: 'DELETE' }),

  listVersions: (id: string): Promise<SupplierQuoteVersionRow[]> =>
    fetchApi<SupplierQuoteVersionRow[]>(`${supplierQuotePath(id)}/versions`),

  getVersion: (id: string, versionId: string): Promise<SupplierQuoteVersion> =>
    fetchApi<SupplierQuoteVersion>(
      `${supplierQuotePath(id)}/versions/${encodePathSegment(versionId)}`,
    ),

  restoreVersion: (id: string, versionId: string): Promise<SupplierQuote> =>
    fetchApi<SupplierQuote>(
      `${supplierQuotePath(id)}/versions/${encodePathSegment(versionId)}/restore`,
      { method: 'POST' },
    ).then(normalizeSupplierQuote),

  listRevisions: (id: string): Promise<RevisionRow[]> =>
    fetchApi<RevisionRow[]>(`${supplierQuotePath(id)}/revisions`),

  getRevision: (id: string, revisionId: string): Promise<SupplierQuoteRevision> =>
    fetchApi<SupplierQuoteRevision>(
      `${supplierQuotePath(id)}/revisions/${encodePathSegment(revisionId)}`,
    ),

  restoreRevision: (id: string, revisionId: string): Promise<SupplierQuote> =>
    fetchApi<SupplierQuote>(
      `${supplierQuotePath(id)}/revisions/${encodePathSegment(revisionId)}/restore`,
      { method: 'POST' },
    ).then(normalizeSupplierQuote),

  listAttachments: (id: string): Promise<SupplierQuoteAttachment[]> =>
    fetchApi<SupplierQuoteAttachment[]>(`${supplierQuotePath(id)}/attachments`),

  uploadAttachment: async (id: string, file: File): Promise<SupplierQuoteAttachment> => {
    const formData = new FormData();
    formData.append('file', file, file.name);
    // fetchApiStream avoids the auto Content-Type: application/json that fetchApi adds when a
    // body is present - we need fetch to set the multipart boundary itself.
    const response = await fetchApiStream(`${supplierQuotePath(id)}/attachments`, {
      method: 'POST',
      body: formData,
    });
    return (await response.json()) as SupplierQuoteAttachment;
  },

  downloadAttachment: async (id: string, attachmentId: string): Promise<Blob> => {
    const response = await fetchApiStream(
      `${supplierQuotePath(id)}/attachments/${encodePathSegment(attachmentId)}/download`,
    );
    return await response.blob();
  },

  deleteAttachment: (id: string, attachmentId: string): Promise<void> =>
    fetchApi(`${supplierQuotePath(id)}/attachments/${encodePathSegment(attachmentId)}`, {
      method: 'DELETE',
    }),
};
