import type { Supplier } from '../../types';
import { fetchApi } from './client';
import { normalizeSupplier } from './normalizers';

export const suppliersApi = {
  list: (): Promise<Supplier[]> =>
    fetchApi<Supplier[]>('/suppliers').then((suppliers) => suppliers.map(normalizeSupplier)),

  create: (supplierData: Partial<Supplier>): Promise<Supplier> =>
    fetchApi<Supplier>('/suppliers', {
      method: 'POST',
      body: JSON.stringify(supplierData),
    }).then(normalizeSupplier),

  update: (id: string, updates: Partial<Supplier>): Promise<Supplier> =>
    fetchApi<Supplier>(`/suppliers/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    }).then(normalizeSupplier),

  delete: (id: string): Promise<void> => fetchApi(`/suppliers/${id}`, { method: 'DELETE' }),
};
