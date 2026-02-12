import type { Project } from '../../types';
import { fetchApi } from './client';

export const projectsApi = {
  list: (): Promise<Project[]> => fetchApi('/projects'),

  create: (
    name: string,
    clientId: string,
    description?: string,
    color?: string,
  ): Promise<Project> =>
    fetchApi('/projects', {
      method: 'POST',
      body: JSON.stringify({ name, clientId, description, color }),
    }),

  update: (id: string, updates: Partial<Project>): Promise<Project> =>
    fetchApi(`/projects/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    }),

  delete: (id: string): Promise<void> => fetchApi(`/projects/${id}`, { method: 'DELETE' }),
};
