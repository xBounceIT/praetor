import type { User } from '../../types';
import { fetchApi } from './client';
import { normalizeUser } from './normalizers';

export const usersApi = {
  list: (): Promise<User[]> => fetchApi<User[]>('/users').then((users) => users.map(normalizeUser)),

  create: (
    name: string,
    username: string,
    password: string,
    role: string,
    costPerHour?: number,
  ): Promise<User> =>
    fetchApi<User>('/users', {
      method: 'POST',
      body: JSON.stringify({ name, username, password, role, costPerHour }),
    }).then(normalizeUser),

  delete: (id: string): Promise<void> => fetchApi(`/users/${id}`, { method: 'DELETE' }),

  getAssignments: (
    id: string,
  ): Promise<{ clientIds: string[]; projectIds: string[]; taskIds: string[] }> =>
    fetchApi(`/users/${id}/assignments`),

  updateAssignments: (
    id: string,
    clientIds: string[],
    projectIds: string[],
    taskIds?: string[],
  ): Promise<void> =>
    fetchApi(`/users/${id}/assignments`, {
      method: 'POST',
      body: JSON.stringify({ clientIds, projectIds, taskIds }),
    }),

  update: (id: string, updates: Partial<User>): Promise<User> =>
    fetchApi<User>(`/users/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    }).then(normalizeUser),

  getRoles: (id: string): Promise<{ roleIds: string[]; primaryRoleId: string }> =>
    fetchApi(`/users/${id}/roles`),

  updateRoles: (
    id: string,
    roleIds: string[],
    primaryRoleId: string,
  ): Promise<{ roleIds: string[]; primaryRoleId: string }> =>
    fetchApi(`/users/${id}/roles`, {
      method: 'PUT',
      body: JSON.stringify({ roleIds, primaryRoleId }),
    }),
};
