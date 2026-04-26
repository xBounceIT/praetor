import type { Project } from '../../types';
import { fetchApi } from './client';

export const projectsApi = {
  list: (): Promise<Project[]> => fetchApi('/projects'),

  create: (data: {
    name: string;
    clientId: string;
    description?: string;
    color?: string;
    orderId?: string;
  }): Promise<Project> =>
    fetchApi('/projects', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (id: string, updates: Partial<Project>): Promise<Project> =>
    fetchApi(`/projects/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    }),

  delete: (id: string): Promise<void> => fetchApi(`/projects/${id}`, { method: 'DELETE' }),

  getUsers: (id: string, signal?: AbortSignal): Promise<string[]> =>
    fetchApi(`/projects/${id}/users`, { signal }),

  updateUsers: (id: string, userIds: string[]): Promise<void> =>
    fetchApi(`/projects/${id}/users`, {
      method: 'POST',
      body: JSON.stringify({ userIds }),
    }),
};
