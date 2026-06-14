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
    revenue?: number,
    notes?: string,
    monthlyEffort?: number,
    billingType?: ProjectTask['billingType'],
    billingFrequency?: ProjectTask['billingFrequency'],
    duration?: number,
  ): Promise<ProjectTask> =>
    fetchApi<ProjectTask>('/tasks', {
      method: 'POST',
      body: JSON.stringify({
        name,
        projectId,
        description,
        isRecurring,
        recurrencePattern,
        revenue,
        notes,
        monthlyEffort,
        billingType,
        billingFrequency,
        duration,
      }),
    }).then(normalizeTask),

  update: (id: string, updates: Partial<ProjectTask>): Promise<ProjectTask> =>
    fetchApi<ProjectTask>(`/tasks/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    }).then(normalizeTask),

  delete: (id: string): Promise<void> => fetchApi(`/tasks/${id}`, { method: 'DELETE' }),

  getHours: (projectId: string, signal?: AbortSignal): Promise<Record<string, number>> =>
    fetchApi(`/tasks/hours?projectId=${encodeURIComponent(projectId)}`, { signal }),

  getHoursForProjects: (
    projectIds: string[],
    signal?: AbortSignal,
  ): Promise<Record<string, Record<string, number>>> =>
    fetchApi(`/tasks/hours/batch?projectIds=${projectIds.map(encodeURIComponent).join(',')}`, {
      signal,
    }),

  getUsers: (id: string, signal?: AbortSignal): Promise<string[]> =>
    fetchApi(`/tasks/${id}/users`, { signal }),

  updateUsers: (id: string, userIds: string[]): Promise<void> =>
    fetchApi(`/tasks/${id}/users`, {
      method: 'POST',
      body: JSON.stringify({ userIds }),
    }),
};
