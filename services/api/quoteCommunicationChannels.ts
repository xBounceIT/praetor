import { fetchApi } from './client';

const QUOTE_COMMUNICATION_CHANNEL_ICONS = [
  'comments',
  'envelope',
  'globe',
  'phone',
  'video',
  'whatsapp',
] as const;
export type QuoteCommunicationChannelIcon = (typeof QUOTE_COMMUNICATION_CHANNEL_ICONS)[number];

export interface QuoteCommunicationChannel {
  id: string;
  name: string;
  icon: QuoteCommunicationChannelIcon;
  isDefault: boolean;
  createdAt?: number;
  updatedAt?: number;
  clientQuoteCount: number;
  supplierQuoteCount: number;
  totalQuoteCount: number;
}

export const quoteCommunicationChannelsApi = {
  list: (): Promise<QuoteCommunicationChannel[]> =>
    fetchApi<QuoteCommunicationChannel[]>('/sales/quote-communication-channels'),

  create: (data: {
    name: string;
    icon: QuoteCommunicationChannelIcon;
  }): Promise<QuoteCommunicationChannel> =>
    fetchApi<QuoteCommunicationChannel>('/sales/quote-communication-channels', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (
    id: string,
    updates: { name: string; icon: QuoteCommunicationChannelIcon },
  ): Promise<QuoteCommunicationChannel> =>
    fetchApi<QuoteCommunicationChannel>(`/sales/quote-communication-channels/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    }),

  delete: (id: string): Promise<void> =>
    fetchApi(`/sales/quote-communication-channels/${id}`, { method: 'DELETE' }),
};
