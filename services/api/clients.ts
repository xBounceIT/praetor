import type { Client } from '../../types';
import { fetchApi } from './client';

export const clientsApi = {
  list: (): Promise<Client[]> => fetchApi('/clients'),

  create: (clientData: Partial<Client>): Promise<Client> =>
    fetchApi('/clients', {
      method: 'POST',
      body: JSON.stringify(clientData),
    }),

  update: (id: string, updates: Partial<Client>): Promise<Client> =>
    fetchApi(`/clients/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    }),

  delete: (id: string): Promise<void> => fetchApi(`/clients/${id}`, { method: 'DELETE' }),
};
