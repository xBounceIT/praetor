import type { ProjectTask } from '../../types';
import { fetchApi } from './client';
import { normalizeTask } from './normalizers';

export const tasksApi = {
  list: (): Promise<ProjectTask[]> =>
    fetchApi<ProjectTask[]>('/tasks').then((tasks) => tasks.map(normalizeTask)),

  create: (
    name: string,
    projectId: string,
    description?: string,
    isRecurring?: boolean,
    recurrencePattern?: string,
  ): Promise<ProjectTask> =>
    fetchApi<ProjectTask>('/tasks', {
      method: 'POST',
      body: JSON.stringify({ name, projectId, description, isRecurring, recurrencePattern }),
    }).then(normalizeTask),

  update: (id: string, updates: Partial<ProjectTask>): Promise<ProjectTask> =>
    fetchApi<ProjectTask>(`/tasks/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    }).then(normalizeTask),

  delete: (id: string): Promise<void> => fetchApi(`/tasks/${id}`, { method: 'DELETE' }),

  getUsers: (id: string): Promise<string[]> => fetchApi(`/tasks/${id}/users`),

  updateUsers: (id: string, userIds: string[]): Promise<void> =>
    fetchApi(`/tasks/${id}/users`, {
      method: 'POST',
      body: JSON.stringify({ userIds }),
    }),
};
