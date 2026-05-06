import type { ClientOffer, OfferVersion, OfferVersionRow } from '../../types';
import { fetchApi } from './client';
import { normalizeClientOffer } from './normalizers';

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

  update: (id: string, updates: Partial<ClientOffer>): Promise<ClientOffer> =>
    fetchApi<ClientOffer>(`/sales/client-offers/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    }).then(normalizeClientOffer),

  delete: (id: string): Promise<void> =>
    fetchApi(`/sales/client-offers/${id}`, { method: 'DELETE' }),

  listVersions: (id: string): Promise<OfferVersionRow[]> =>
    fetchApi<OfferVersionRow[]>(`/sales/client-offers/${id}/versions`),

  getVersion: (id: string, versionId: string): Promise<OfferVersion> =>
    fetchApi<OfferVersion>(`/sales/client-offers/${id}/versions/${versionId}`),

  restoreVersion: (id: string, versionId: string): Promise<ClientOffer> =>
    fetchApi<ClientOffer>(`/sales/client-offers/${id}/versions/${versionId}/restore`, {
      method: 'POST',
    }).then(normalizeClientOffer),
};
