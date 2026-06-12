import type { Resale, ResaleActivity, ResaleCategory, ResaleOrderOption } from '../../types';
import { fetchApi } from './client';
import {
  normalizeResale,
  normalizeResaleCategory,
  normalizeResaleOrderOption,
} from './normalizers';

export type UpsertResaleActivityBody = Omit<
  ResaleActivity,
  'id' | 'resaleId' | 'categoryName' | 'createdAt' | 'updatedAt'
>;

export type CreateResaleBody = {
  clientOrderId: string;
  supplierOrderId: string;
  dueDate?: string | null;
  notes?: string | null;
  activities: UpsertResaleActivityBody[];
};

export type UpdateResaleBody = Omit<CreateResaleBody, 'activities'>;

export const resalesApi = {
  list: (): Promise<Resale[]> =>
    fetchApi<Resale[]>('/projects/resales').then((items) => items.map(normalizeResale)),

  listCategories: (): Promise<ResaleCategory[]> =>
    fetchApi<ResaleCategory[]>('/projects/resales/categories').then((items) =>
      items.map(normalizeResaleCategory),
    ),

  listOrderOptions: (): Promise<ResaleOrderOption[]> =>
    fetchApi<ResaleOrderOption[]>('/projects/resales/order-options').then((items) =>
      items.map(normalizeResaleOrderOption),
    ),

  create: (data: CreateResaleBody): Promise<Resale> =>
    fetchApi<Resale>('/projects/resales', {
      method: 'POST',
      body: JSON.stringify(data),
    }).then(normalizeResale),

  update: (id: string, updates: Partial<UpdateResaleBody>): Promise<Resale> =>
    fetchApi<Resale>(`/projects/resales/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    }).then(normalizeResale),

  delete: (id: string): Promise<void> => fetchApi(`/projects/resales/${id}`, { method: 'DELETE' }),

  createActivity: (resaleId: string, data: UpsertResaleActivityBody): Promise<Resale> =>
    fetchApi<Resale>(`/projects/resales/${resaleId}/activities`, {
      method: 'POST',
      body: JSON.stringify(data),
    }).then(normalizeResale),

  updateActivity: (
    resaleId: string,
    activityId: string,
    updates: Partial<UpsertResaleActivityBody>,
  ): Promise<Resale> =>
    fetchApi<Resale>(`/projects/resales/${resaleId}/activities/${activityId}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    }).then(normalizeResale),

  deleteActivity: (resaleId: string, activityId: string): Promise<Resale> =>
    fetchApi<Resale>(`/projects/resales/${resaleId}/activities/${activityId}`, {
      method: 'DELETE',
    }).then(normalizeResale),

  createCategory: (name: string): Promise<ResaleCategory> =>
    fetchApi<ResaleCategory>('/projects/resales/categories', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }).then(normalizeResaleCategory),

  updateCategory: (id: string, name: string): Promise<ResaleCategory> =>
    fetchApi<ResaleCategory>(`/projects/resales/categories/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ name }),
    }).then(normalizeResaleCategory),

  deleteCategory: (id: string): Promise<void> =>
    fetchApi(`/projects/resales/categories/${id}`, { method: 'DELETE' }),
};
