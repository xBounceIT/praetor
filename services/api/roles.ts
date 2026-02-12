import type { Role } from '../../types';
import { fetchApi } from './client';

export const rolesApi = {
  list: (): Promise<Role[]> => fetchApi('/roles'),
  create: (name: string, permissions: string[] = []): Promise<Role> =>
    fetchApi('/roles', {
      method: 'POST',
      body: JSON.stringify({ name, permissions }),
    }),
  rename: (id: string, name: string): Promise<Role> =>
    fetchApi(`/roles/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ name }),
    }),
  updatePermissions: (id: string, permissions: string[]): Promise<Role> =>
    fetchApi(`/roles/${id}/permissions`, {
      method: 'PUT',
      body: JSON.stringify({ permissions }),
    }),
  delete: (id: string): Promise<{ message: string }> =>
    fetchApi(`/roles/${id}`, {
      method: 'DELETE',
    }),
};
