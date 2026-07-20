import type {
  ClientOffer,
  ClientOfferUpdateResult,
  OfferRevision,
  OfferVersion,
  OfferVersionRow,
  RevisionRow,
} from '../../types';
import { fetchApi } from './client';
import { normalizeClientOffer } from './normalizers';
import { encodePathSegment } from './path';

export const clientOffersApi = {
  list: (): Promise<ClientOffer[]> =>
    fetchApi<ClientOffer[]>('/sales/client-offers').then((offers) =>
      offers.map(normalizeClientOffer),
    ),

  create: (offerData: Partial<ClientOffer>): Promise<ClientOffer> =>
    fetchApi<ClientOffer>('/sales/client-offers', {
      method: 'POST',
      body: JSON.stringify(offerData),
    }).then(normalizeClientOffer),

  update: (id: string, updates: Partial<ClientOffer>): Promise<ClientOfferUpdateResult> =>
    fetchApi<ClientOfferUpdateResult>(`/sales/client-offers/${encodePathSegment(id)}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    }).then(normalizeClientOffer),

  revertToDraft: (id: string, reason?: string): Promise<ClientOffer> =>
    fetchApi<ClientOffer>(`/sales/client-offers/${encodePathSegment(id)}/revert-to-draft`, {
      method: 'POST',
      body: JSON.stringify(reason ? { reason } : {}),
    }).then(normalizeClientOffer),

  delete: (id: string): Promise<void> =>
    fetchApi(`/sales/client-offers/${encodePathSegment(id)}`, { method: 'DELETE' }),

  listVersions: (id: string): Promise<OfferVersionRow[]> =>
    fetchApi<OfferVersionRow[]>(`/sales/client-offers/${encodePathSegment(id)}/versions`),

  getVersion: (id: string, versionId: string): Promise<OfferVersion> =>
    fetchApi<OfferVersion>(
      `/sales/client-offers/${encodePathSegment(id)}/versions/${encodePathSegment(versionId)}`,
    ),

  restoreVersion: (id: string, versionId: string): Promise<ClientOffer> =>
    fetchApi<ClientOffer>(
      `/sales/client-offers/${encodePathSegment(id)}/versions/${encodePathSegment(versionId)}/restore`,
      { method: 'POST' },
    ).then(normalizeClientOffer),

  listRevisions: (id: string): Promise<RevisionRow[]> =>
    fetchApi<RevisionRow[]>(`/sales/client-offers/${encodePathSegment(id)}/revisions`),

  getRevision: (id: string, revisionId: string): Promise<OfferRevision> =>
    fetchApi<OfferRevision>(
      `/sales/client-offers/${encodePathSegment(id)}/revisions/${encodePathSegment(revisionId)}`,
    ),

  restoreRevision: (id: string, revisionId: string): Promise<ClientOffer> =>
    fetchApi<ClientOffer>(
      `/sales/client-offers/${encodePathSegment(id)}/revisions/${encodePathSegment(revisionId)}/restore`,
      { method: 'POST' },
    ).then(normalizeClientOffer),
};
