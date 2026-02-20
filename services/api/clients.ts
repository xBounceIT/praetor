import type { Client } from '../../types';
import { fetchApi } from './client';
import { normalizeClient } from './normalizers';

const normalizeClientPayload = (payload: Partial<Client>): Partial<Client> => {
  const normalized = { ...payload };

  for (const [key, value] of Object.entries(normalized)) {
    if (value === undefined || value === null) {
      delete normalized[key as keyof Client];
    }
  }

  return normalized;
};

export const clientsApi = {
  list: (): Promise<Client[]> =>
    fetchApi<Client[]>('/clients').then((clients) => clients.map(normalizeClient)),

  create: (clientData: Partial<Client>): Promise<Client> =>
    fetchApi<Client>('/clients', {
      method: 'POST',
      body: JSON.stringify(normalizeClientPayload(clientData)),
    }).then(normalizeClient),

  update: (id: string, updates: Partial<Client>): Promise<Client> =>
    fetchApi<Client>(`/clients/${id}`, {
      method: 'PUT',
      body: JSON.stringify(normalizeClientPayload(updates)),
    }).then(normalizeClient),

  delete: (id: string): Promise<void> => fetchApi(`/clients/${id}`, { method: 'DELETE' }),
};
