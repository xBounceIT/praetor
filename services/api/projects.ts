import type { BillingFrequency, Project, StoredBillingType } from '../../types';
import { fetchApi } from './client';
import { normalizeProject } from './normalizers';

export const projectsApi = {
  list: (filters: { userId?: string } = {}): Promise<Project[]> => {
    const params = new URLSearchParams();
    if (filters.userId) params.set('userId', filters.userId);
    const query = params.toString();
    return fetchApi<Project[]>(`/projects${query ? `?${query}` : ''}`).then((projects) =>
      projects.map(normalizeProject),
    );
  },

  create: (data: {
    name: string;
    clientId: string;
    description?: string;
    orderId?: string;
    offerId: string;
    startDate?: string | null;
    endDate?: string | null;
    revenue?: number | null;
    billingType?: StoredBillingType;
    billingFrequency?: BillingFrequency;
  }): Promise<Project> =>
    fetchApi<Project>('/projects', {
      method: 'POST',
      body: JSON.stringify(data),
    }).then(normalizeProject),

  update: (id: string, updates: Partial<Project>): Promise<Project> =>
    fetchApi<Project>(`/projects/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    }).then(normalizeProject),

  delete: (id: string): Promise<void> => fetchApi(`/projects/${id}`, { method: 'DELETE' }),

  getUsers: (id: string, signal?: AbortSignal): Promise<string[]> =>
    fetchApi(`/projects/${id}/users`, { signal }),

  updateUsers: (id: string, userIds: string[]): Promise<void> =>
    fetchApi(`/projects/${id}/users`, {
      method: 'POST',
      body: JSON.stringify({ userIds }),
    }),
};
