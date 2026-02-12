import type { User } from '../../types';
import { fetchApi } from './client';
import type { LoginResponse } from './contracts';
import { normalizeUser } from './normalizers';

export const authApi = {
  login: (username: string, password: string): Promise<LoginResponse> =>
    fetchApi('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),

  me: (): Promise<User> => fetchApi<User>('/auth/me').then(normalizeUser),

  switchRole: (roleId: string): Promise<LoginResponse> =>
    fetchApi('/auth/switch-role', {
      method: 'POST',
      body: JSON.stringify({ roleId }),
    }),
};
