import type { Supplier } from '../../types';
import { fetchApi } from './client';

export const suppliersApi = {
  list: (): Promise<Supplier[]> => fetchApi('/suppliers'),

  create: (supplierData: Partial<Supplier>): Promise<Supplier> =>
    fetchApi('/suppliers', {
      method: 'POST',
      body: JSON.stringify(supplierData),
    }),

  update: (id: string, updates: Partial<Supplier>): Promise<Supplier> =>
    fetchApi(`/suppliers/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    }),

  delete: (id: string): Promise<void> => fetchApi(`/suppliers/${id}`, { method: 'DELETE' }),
};
