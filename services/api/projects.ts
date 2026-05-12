import type { BillingFrequency, Project, StoredBillingType } from '../../types';
import { fetchApi } from './client';
import { normalizeProject } from './normalizers';

export const projectsApi = {
  list: (): Promise<Project[]> =>
    fetchApi<Project[]>('/projects').then((projects) => projects.map(normalizeProject)),

  create: (data: {
    name: string;
    clientId: string;
    description?: string;
    color?: string;
    orderId?: string;
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
