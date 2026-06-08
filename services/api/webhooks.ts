import type { Webhook, WebhookPayload } from '../../types';
import { fetchApi } from './client';

export const webhooksApi = {
  list: (): Promise<Webhook[]> => fetchApi('/webhooks'),
  create: (payload: WebhookPayload): Promise<Webhook> =>
    fetchApi('/webhooks', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  update: (id: string, payload: Partial<WebhookPayload>): Promise<Webhook> =>
    fetchApi(`/webhooks/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  delete: (id: string): Promise<void> =>
    fetchApi(`/webhooks/${id}`, {
      method: 'DELETE',
    }),
};
