import type { ClientsOrder } from '../../types';
import { fetchApi } from './client';
import { normalizeClientsOrder } from './normalizers';

export const clientsOrdersApi = {
  list: (): Promise<ClientsOrder[]> =>
    fetchApi<ClientsOrder[]>('/clients-orders').then((orders) => orders.map(normalizeClientsOrder)),

  create: (orderData: Partial<ClientsOrder>): Promise<ClientsOrder> =>
    fetchApi<ClientsOrder>('/clients-orders', {
      method: 'POST',
      body: JSON.stringify(orderData),
    }).then(normalizeClientsOrder),

  update: (id: string, updates: Partial<ClientsOrder>): Promise<ClientsOrder> =>
    fetchApi<ClientsOrder>(`/clients-orders/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    }).then(normalizeClientsOrder),

  delete: (id: string): Promise<void> => fetchApi(`/clients-orders/${id}`, { method: 'DELETE' }),
};
