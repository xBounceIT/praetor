import type { ClientOffer } from '../../types';
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
};
