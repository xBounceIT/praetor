import type { Client, Project, ProjectTask, User, UserAuthMethod } from '../../types';
import type { TrackerCatalogs } from '../../utils/trackerCatalogs';
import { fetchApi } from './client';
import { normalizeClient, normalizeProject, normalizeTask, normalizeUser } from './normalizers';

/**
 * Update payload accepted by `PUT /api/users/:id`. Mirrors
 * `userUpdateBodySchema` in `server/routes/users.ts` — fields outside this DTO
 * are silently dropped server-side, so we keep the type narrow so callers
 * can't pretend to mutate (e.g.) `permissions` or `availableRoles` via this
 * endpoint.
 */
export type UpdateUserInput = {
  name?: string;
  isDisabled?: boolean;
  costPerHour?: number;
  role?: string;
  email?: string;
};

export const usersApi = {
  list: (): Promise<User[]> => fetchApi<User[]>('/users').then((users) => users.map(normalizeUser)),

  create: (
    name: string,
    username: string,
    password: string,
    role: string,
    email?: string,
    costPerHour?: number,
  ): Promise<User> =>
    fetchApi<User>('/users', {
      method: 'POST',
      body: JSON.stringify({ name, username, password, role, email, costPerHour }),
    }).then(normalizeUser),

  delete: (id: string): Promise<void> => fetchApi<void>(`/users/${id}`, { method: 'DELETE' }),

  getAssignments: (
    id: string,
  ): Promise<{ clientIds: string[]; projectIds: string[]; taskIds: string[] }> =>
    fetchApi<{ clientIds: string[]; projectIds: string[]; taskIds: string[] }>(
      `/users/${id}/assignments`,
    ),

  getTrackerCatalogs: (id: string): Promise<TrackerCatalogs> =>
    fetchApi<{
      clients: Client[];
      projects: Project[];
      projectTasks: ProjectTask[];
    }>(`/users/${id}/tracker-catalogs`).then((catalogs) => ({
      clients: catalogs.clients.map(normalizeClient),
      projects: catalogs.projects.map(normalizeProject),
      projectTasks: catalogs.projectTasks.map(normalizeTask),
    })),

  updateAssignments: (
    id: string,
    clientIds: string[],
    projectIds: string[],
    taskIds?: string[],
  ): Promise<void> =>
    fetchApi<void>(`/users/${id}/assignments`, {
      method: 'POST',
      body: JSON.stringify({ clientIds, projectIds, taskIds }),
    }),

  update: (id: string, updates: UpdateUserInput): Promise<User> =>
    fetchApi<User>(`/users/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    }).then(normalizeUser),

  getRoles: (id: string): Promise<{ roleIds: string[]; primaryRoleId: string }> =>
    fetchApi<{ roleIds: string[]; primaryRoleId: string }>(`/users/${id}/roles`),

  updateRoles: (
    id: string,
    roleIds: string[],
    primaryRoleId: string,
  ): Promise<{ roleIds: string[]; primaryRoleId: string }> =>
    fetchApi<{ roleIds: string[]; primaryRoleId: string }>(`/users/${id}/roles`, {
      method: 'PUT',
      body: JSON.stringify({ roleIds, primaryRoleId }),
    }),

  updateAuthMethod: (
    id: string,
    authMethod: UserAuthMethod,
    authProviderId?: string | null,
  ): Promise<User> =>
    fetchApi<User>(`/users/${id}/auth-method`, {
      method: 'PUT',
      body: JSON.stringify({ authMethod, authProviderId: authProviderId ?? null }),
    }).then(normalizeUser),
};
