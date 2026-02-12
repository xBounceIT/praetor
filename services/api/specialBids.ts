import type { SpecialBid } from '../../types';
import { fetchApi } from './client';
import { normalizeSpecialBid } from './normalizers';

export const specialBidsApi = {
  list: (): Promise<SpecialBid[]> =>
    fetchApi<SpecialBid[]>('/special-bids').then((bids) => bids.map(normalizeSpecialBid)),

  create: (bidData: Partial<SpecialBid>): Promise<SpecialBid> =>
    fetchApi<SpecialBid>('/special-bids', {
      method: 'POST',
      body: JSON.stringify(bidData),
    }).then(normalizeSpecialBid),

  update: (id: string, updates: Partial<SpecialBid>): Promise<SpecialBid> =>
    fetchApi<SpecialBid>(`/special-bids/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    }).then(normalizeSpecialBid),

  delete: (id: string): Promise<void> => fetchApi(`/special-bids/${id}`, { method: 'DELETE' }),
};
