import type { ClientsOrder, OrderVersion, OrderVersionRow } from '../../types';
import { fetchApi } from './client';
import { normalizeClientsOrder } from './normalizers';
import { encodePathSegment } from './path';

export const clientsOrdersApi = {
  list: (): Promise<ClientsOrder[]> =>
    fetchApi<ClientsOrder[]>('/clients-orders').then((orders) => orders.map(normalizeClientsOrder)),

  create: (orderData: Partial<ClientsOrder>): Promise<ClientsOrder> =>
    fetchApi<ClientsOrder>('/clients-orders', {
      method: 'POST',
      body: JSON.stringify(orderData),
    }).then(normalizeClientsOrder),

  update: (id: string, updates: Partial<ClientsOrder>): Promise<ClientsOrder> =>
    fetchApi<ClientsOrder>(`/clients-orders/${encodePathSegment(id)}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    }).then(normalizeClientsOrder),

  delete: (id: string): Promise<void> =>
    fetchApi(`/clients-orders/${encodePathSegment(id)}`, { method: 'DELETE' }),

  listVersions: (id: string): Promise<OrderVersionRow[]> =>
    fetchApi<OrderVersionRow[]>(`/clients-orders/${encodePathSegment(id)}/versions`),

  getVersion: (id: string, versionId: string): Promise<OrderVersion> =>
    fetchApi<OrderVersion>(
      `/clients-orders/${encodePathSegment(id)}/versions/${encodePathSegment(versionId)}`,
    ),

  restoreVersion: (id: string, versionId: string): Promise<ClientsOrder> =>
    fetchApi<ClientsOrder>(
      `/clients-orders/${encodePathSegment(id)}/versions/${encodePathSegment(versionId)}/restore`,
      { method: 'POST' },
    ).then(normalizeClientsOrder),
};
