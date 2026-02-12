import type { Quote } from '../../types';
import { fetchApi } from './client';
import { normalizeQuote } from './normalizers';

export const clientQuotesApi = {
  list: (): Promise<Quote[]> =>
    fetchApi<Quote[]>('/sales/client-quotes').then((quotes) => quotes.map(normalizeQuote)),

  create: (quoteData: Partial<Quote>): Promise<Quote> =>
    fetchApi<Quote>('/sales/client-quotes', {
      method: 'POST',
      body: JSON.stringify(quoteData),
    }).then(normalizeQuote),

  update: (id: string, updates: Partial<Quote>): Promise<Quote> =>
    fetchApi<Quote>(`/sales/client-quotes/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    }).then(normalizeQuote),

  delete: (id: string): Promise<void> =>
    fetchApi(`/sales/client-quotes/${id}`, { method: 'DELETE' }),
};
