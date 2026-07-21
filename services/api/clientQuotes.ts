import type {
  ClientOffer,
  Quote,
  QuoteMutation,
  QuoteRevision,
  QuoteVersion,
  QuoteVersionRow,
  RevisionRow,
} from '../../types';
import { fetchApi } from './client';
import { normalizeQuote } from './normalizers';
import { encodePathSegment } from './path';

export const clientQuotesApi = {
  list: (): Promise<Quote[]> =>
    fetchApi<Quote[]>('/sales/client-quotes').then((quotes) => quotes.map(normalizeQuote)),

  create: (quoteData: QuoteMutation): Promise<Quote> =>
    fetchApi<Quote>('/sales/client-quotes', {
      method: 'POST',
      body: JSON.stringify(quoteData),
    }).then(normalizeQuote),

  update: (id: string, updates: QuoteMutation): Promise<Quote> =>
    fetchApi<Quote>(`/sales/client-quotes/${encodePathSegment(id)}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    }).then(normalizeQuote),

  promote: (id: string, candidateId: string): Promise<{ quote: Quote; offer: ClientOffer }> =>
    fetchApi<{ quote: Quote; offer: ClientOffer }>(
      `/sales/client-quotes/${encodePathSegment(id)}/promote`,
      {
        method: 'POST',
        body: JSON.stringify({ candidateId }),
      },
    ).then((result) => ({ ...result, quote: normalizeQuote(result.quote) })),

  rollbackPromotion: (id: string): Promise<Quote> =>
    fetchApi<Quote>(`/sales/client-quotes/${encodePathSegment(id)}/promotion/rollback`, {
      method: 'POST',
    }).then(normalizeQuote),

  delete: (id: string): Promise<void> =>
    fetchApi(`/sales/client-quotes/${encodePathSegment(id)}`, { method: 'DELETE' }),

  listVersions: (id: string): Promise<QuoteVersionRow[]> =>
    fetchApi<QuoteVersionRow[]>(`/sales/client-quotes/${encodePathSegment(id)}/versions`),

  getVersion: (id: string, versionId: string): Promise<QuoteVersion> =>
    fetchApi<QuoteVersion>(
      `/sales/client-quotes/${encodePathSegment(id)}/versions/${encodePathSegment(versionId)}`,
    ),

  restoreVersion: (id: string, versionId: string): Promise<Quote> =>
    fetchApi<Quote>(
      `/sales/client-quotes/${encodePathSegment(id)}/versions/${encodePathSegment(versionId)}/restore`,
      { method: 'POST' },
    ).then(normalizeQuote),

  listRevisions: (id: string): Promise<RevisionRow[]> =>
    fetchApi<RevisionRow[]>(`/sales/client-quotes/${encodePathSegment(id)}/revisions`),

  getRevision: (id: string, revisionId: string): Promise<QuoteRevision> =>
    fetchApi<QuoteRevision>(
      `/sales/client-quotes/${encodePathSegment(id)}/revisions/${encodePathSegment(revisionId)}`,
    ),

  restoreRevision: (id: string, revisionId: string): Promise<Quote> =>
    fetchApi<Quote>(
      `/sales/client-quotes/${encodePathSegment(id)}/revisions/${encodePathSegment(revisionId)}/restore`,
      { method: 'POST' },
    ).then(normalizeQuote),
};
