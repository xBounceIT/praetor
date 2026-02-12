import { fetchApi } from './client';
import type { Settings } from './contracts';

export const settingsApi = {
  get: (): Promise<Settings> => fetchApi('/settings'),

  update: (settings: Partial<Settings>): Promise<Settings> =>
    fetchApi('/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    }),

  updatePassword: (currentPassword: string, newPassword: string): Promise<{ message: string }> =>
    fetchApi('/settings/password', {
      method: 'PUT',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),
};
