import type { Notification } from '../../types';
import { fetchApi } from './client';

export const notificationsApi = {
  list: (): Promise<{ notifications: Notification[]; unreadCount: number }> =>
    fetchApi('/notifications'),

  markAsRead: (id: string): Promise<{ success: boolean }> =>
    fetchApi(`/notifications/${id}/read`, { method: 'PUT' }),

  markAllAsRead: (): Promise<{ success: boolean }> =>
    fetchApi('/notifications/read-all', { method: 'PUT' }),

  delete: (id: string): Promise<void> => fetchApi(`/notifications/${id}`, { method: 'DELETE' }),
};
