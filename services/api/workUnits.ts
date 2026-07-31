import type { WorkUnit, WorkUnitMutationPayload } from '../../types';
import { fetchApi } from './client';

export const workUnitsApi = {
  list: (): Promise<WorkUnit[]> => fetchApi('/work-units'),

  create: (data: WorkUnitMutationPayload): Promise<WorkUnit> =>
    fetchApi('/work-units', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (id: string, updates: WorkUnitMutationPayload): Promise<WorkUnit> =>
    fetchApi(`/work-units/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    }),

  delete: (id: string): Promise<void> => fetchApi(`/work-units/${id}`, { method: 'DELETE' }),

  getUsers: (id: string, signal?: AbortSignal): Promise<string[]> =>
    fetchApi(`/work-units/${id}/users`, { signal }),

  updateUsers: (id: string, userIds: string[]): Promise<void> =>
    fetchApi(`/work-units/${id}/users`, {
      method: 'POST',
      body: JSON.stringify({ userIds }),
    }),
};
