import { fetchApi } from './client';

export interface QuoteCommunicationChannel {
  id: string;
  name: string;
  createdAt?: number;
  updatedAt?: number;
  clientQuoteCount: number;
  supplierQuoteCount: number;
  totalQuoteCount: number;
}

export const quoteCommunicationChannelsApi = {
  list: (): Promise<QuoteCommunicationChannel[]> =>
    fetchApi<QuoteCommunicationChannel[]>('/sales/quote-communication-channels'),

  create: (data: { name: string }): Promise<QuoteCommunicationChannel> =>
    fetchApi<QuoteCommunicationChannel>('/sales/quote-communication-channels', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (id: string, updates: { name: string }): Promise<QuoteCommunicationChannel> =>
    fetchApi<QuoteCommunicationChannel>(`/sales/quote-communication-channels/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    }),

  delete: (id: string): Promise<void> =>
    fetchApi(`/sales/quote-communication-channels/${id}`, { method: 'DELETE' }),
};
