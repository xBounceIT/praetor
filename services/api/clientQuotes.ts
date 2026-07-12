import type { ClientOffer, Quote, QuoteMutation, QuoteVersion, QuoteVersionRow } from '../../types';
import { fetchApi } from './client';
import { normalizeQuote } from './normalizers';

export const clientQuotesApi = {
  list: (): Promise<Quote[]> =>
    fetchApi<Quote[]>('/sales/client-quotes').then((quotes) => quotes.map(normalizeQuote)),

  create: (quoteData: QuoteMutation): Promise<Quote> =>
    fetchApi<Quote>('/sales/client-quotes', {
      method: 'POST',
      body: JSON.stringify(quoteData),
    }).then(normalizeQuote),

  update: (id: string, updates: QuoteMutation): Promise<Quote> =>
    fetchApi<Quote>(`/sales/client-quotes/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    }).then(normalizeQuote),

  promote: (id: string, candidateId: string): Promise<{ quote: Quote; offer: ClientOffer }> =>
    fetchApi<{ quote: Quote; offer: ClientOffer }>('/sales/client-quotes/' + id + '/promote', {
      method: 'POST',
      body: JSON.stringify({ candidateId }),
    }).then((result) => ({ ...result, quote: normalizeQuote(result.quote) })),

  rollbackPromotion: (id: string): Promise<Quote> =>
    fetchApi<Quote>('/sales/client-quotes/' + id + '/promotion/rollback', {
      method: 'POST',
    }).then(normalizeQuote),

  delete: (id: string): Promise<void> =>
    fetchApi(`/sales/client-quotes/${id}`, { method: 'DELETE' }),

  listVersions: (id: string): Promise<QuoteVersionRow[]> =>
    fetchApi<QuoteVersionRow[]>(`/sales/client-quotes/${id}/versions`),

  getVersion: (id: string, versionId: string): Promise<QuoteVersion> =>
    fetchApi<QuoteVersion>(`/sales/client-quotes/${id}/versions/${versionId}`),

  restoreVersion: (id: string, versionId: string): Promise<Quote> =>
    fetchApi<Quote>(`/sales/client-quotes/${id}/versions/${versionId}/restore`, {
      method: 'POST',
    }).then(normalizeQuote),
};
