import type {
  SupplierQuote,
  SupplierQuoteAttachment,
  SupplierQuoteVersion,
  SupplierQuoteVersionRow,
} from '../../types';
import { fetchApi, fetchApiStream } from './client';
import { normalizeSupplierQuote } from './normalizers';

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
    fetchApi<SupplierQuote>(`/sales/supplier-quotes/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    }).then(normalizeSupplierQuote),

  delete: (id: string): Promise<void> =>
    fetchApi(`/sales/supplier-quotes/${id}`, { method: 'DELETE' }),

  listVersions: (id: string): Promise<SupplierQuoteVersionRow[]> =>
    fetchApi<SupplierQuoteVersionRow[]>(`/sales/supplier-quotes/${id}/versions`),

  getVersion: (id: string, versionId: string): Promise<SupplierQuoteVersion> =>
    fetchApi<SupplierQuoteVersion>(`/sales/supplier-quotes/${id}/versions/${versionId}`),

  restoreVersion: (id: string, versionId: string): Promise<SupplierQuote> =>
    fetchApi<SupplierQuote>(`/sales/supplier-quotes/${id}/versions/${versionId}/restore`, {
      method: 'POST',
    }).then(normalizeSupplierQuote),

  listAttachments: (id: string): Promise<SupplierQuoteAttachment[]> =>
    fetchApi<SupplierQuoteAttachment[]>(`/sales/supplier-quotes/${id}/attachments`),

  uploadAttachment: async (id: string, file: File): Promise<SupplierQuoteAttachment> => {
    const formData = new FormData();
    formData.append('file', file, file.name);
    // fetchApiStream avoids the auto Content-Type: application/json that fetchApi adds when a
    // body is present — we need fetch to set the multipart boundary itself.
    const response = await fetchApiStream(`/sales/supplier-quotes/${id}/attachments`, {
      method: 'POST',
      body: formData,
    });
    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({ error: 'Upload failed' }));
      throw new Error(errorBody.error || `HTTP ${response.status}`);
    }
    return (await response.json()) as SupplierQuoteAttachment;
  },

  downloadAttachment: async (id: string, attachmentId: string): Promise<Blob> => {
    const response = await fetchApiStream(
      `/sales/supplier-quotes/${id}/attachments/${attachmentId}/download`,
    );
    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({ error: 'Download failed' }));
      throw new Error(errorBody.error || `HTTP ${response.status}`);
    }
    return await response.blob();
  },

  deleteAttachment: (id: string, attachmentId: string): Promise<void> =>
    fetchApi(`/sales/supplier-quotes/${id}/attachments/${attachmentId}`, { method: 'DELETE' }),
};
