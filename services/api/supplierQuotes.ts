import type { SupplierQuote } from '../../types';
import { fetchApi } from './client';
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
};
