import type {
  Client,
  ClientProfileOption,
  ClientProfileOptionCategory,
  ClientProfileOptionsByCategory,
} from '../../types';
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

  listProfileOptions: (category: ClientProfileOptionCategory): Promise<ClientProfileOption[]> =>
    fetchApi<ClientProfileOption[]>(`/clients/profile-options/${encodeURIComponent(category)}`),

  listAllProfileOptions: async (): Promise<ClientProfileOptionsByCategory> => {
    const [sector, numberOfEmployees, revenue, officeCountRange] = await Promise.all([
      clientsApi.listProfileOptions('sector'),
      clientsApi.listProfileOptions('numberOfEmployees'),
      clientsApi.listProfileOptions('revenue'),
      clientsApi.listProfileOptions('officeCountRange'),
    ]);

    return {
      sector,
      numberOfEmployees,
      revenue,
      officeCountRange,
    };
  },

  createProfileOption: (
    category: ClientProfileOptionCategory,
    value: string,
    sortOrder?: number,
  ): Promise<ClientProfileOption> =>
    fetchApi<ClientProfileOption>(`/clients/profile-options/${encodeURIComponent(category)}`, {
      method: 'POST',
      body: JSON.stringify({ value, sortOrder }),
    }),

  updateProfileOption: (
    category: ClientProfileOptionCategory,
    id: string,
    updates: { value: string; sortOrder?: number },
  ): Promise<ClientProfileOption> =>
    fetchApi<ClientProfileOption>(
      `/clients/profile-options/${encodeURIComponent(category)}/${encodeURIComponent(id)}`,
      {
        method: 'PUT',
        body: JSON.stringify(updates),
      },
    ),

  deleteProfileOption: (category: ClientProfileOptionCategory, id: string): Promise<void> =>
    fetchApi(`/clients/profile-options/${encodeURIComponent(category)}/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
};
