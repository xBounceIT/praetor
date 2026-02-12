import type { WorkUnit } from '../../types';
import { fetchApi } from './client';

export const workUnitsApi = {
  list: (): Promise<WorkUnit[]> => fetchApi('/work-units'),

  create: (data: Partial<WorkUnit>): Promise<WorkUnit> =>
    fetchApi('/work-units', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (id: string, updates: Partial<WorkUnit>): Promise<WorkUnit> =>
    fetchApi(`/work-units/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    }),

  delete: (id: string): Promise<void> => fetchApi(`/work-units/${id}`, { method: 'DELETE' }),

  getUsers: (id: string): Promise<string[]> => fetchApi(`/work-units/${id}/users`),

  updateUsers: (id: string, userIds: string[]): Promise<void> =>
    fetchApi(`/work-units/${id}/users`, {
      method: 'POST',
      body: JSON.stringify({ userIds }),
    }),
};
