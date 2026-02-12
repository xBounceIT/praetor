import type { EmployeeType, User } from '../../types';
import { fetchApi } from './client';
import { normalizeUser } from './normalizers';

export const employeesApi = {
  create: (data: {
    name: string;
    employeeType: EmployeeType;
    costPerHour?: number;
  }): Promise<User> =>
    fetchApi<User>('/users', {
      method: 'POST',
      body: JSON.stringify(data),
    }).then(normalizeUser),

  update: (id: string, updates: Partial<User>): Promise<User> =>
    fetchApi<User>(`/users/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    }).then(normalizeUser),

  delete: (id: string): Promise<void> => fetchApi(`/users/${id}`, { method: 'DELETE' }),
};
