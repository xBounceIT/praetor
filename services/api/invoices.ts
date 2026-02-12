import type { Invoice } from '../../types';
import { fetchApi } from './client';
import { normalizeInvoice } from './normalizers';

export const invoicesApi = {
  list: (): Promise<Invoice[]> =>
    fetchApi<Invoice[]>('/invoices').then((invoices) => invoices.map(normalizeInvoice)),

  create: (invoiceData: Partial<Invoice>): Promise<Invoice> =>
    fetchApi<Invoice>('/invoices', {
      method: 'POST',
      body: JSON.stringify(invoiceData),
    }).then(normalizeInvoice),

  update: (id: string, updates: Partial<Invoice>): Promise<Invoice> =>
    fetchApi<Invoice>(`/invoices/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    }).then(normalizeInvoice),

  delete: (id: string): Promise<void> => fetchApi(`/invoices/${id}`, { method: 'DELETE' }),
};
