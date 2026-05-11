import type { Notification } from '../../types';
import { fetchApi } from './client';

export const notificationsApi = {
  list: (): Promise<{ notifications: Notification[]; unreadCount: number }> =>
    fetchApi<{ notifications: Notification[]; unreadCount: number }>('/notifications'),

  markAsRead: (id: string): Promise<{ success: boolean }> =>
    fetchApi<{ success: boolean }>(`/notifications/${id}/read`, { method: 'PUT' }),

  markAllAsRead: (): Promise<{ success: boolean }> =>
    fetchApi<{ success: boolean }>('/notifications/read-all', { method: 'PUT' }),

  delete: (id: string): Promise<void> =>
    fetchApi<void>(`/notifications/${id}`, { method: 'DELETE' }),
};
