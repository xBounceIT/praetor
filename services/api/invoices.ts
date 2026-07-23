import type { Invoice } from '../../types';
import { fetchApi } from './client';
import { normalizeInvoice } from './normalizers';
import { encodePathSegment } from './path';

const invoicePath = (id: string): string => `/invoices/${encodePathSegment(id)}`;

export const invoicesApi = {
  list: (): Promise<Invoice[]> =>
    fetchApi<Invoice[]>('/invoices').then((invoices) => invoices.map(normalizeInvoice)),

  create: (invoiceData: Partial<Invoice>): Promise<Invoice> =>
    fetchApi<Invoice>('/invoices', {
      method: 'POST',
      body: JSON.stringify(invoiceData),
    }).then(normalizeInvoice),

  update: (id: string, updates: Partial<Invoice>): Promise<Invoice> =>
    fetchApi<Invoice>(invoicePath(id), {
      method: 'PUT',
      body: JSON.stringify(updates),
    }).then(normalizeInvoice),

  delete: (id: string): Promise<void> => fetchApi(invoicePath(id), { method: 'DELETE' }),
};
