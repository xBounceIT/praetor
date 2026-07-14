import type { BulkSupplierCreateInput, BulkSupplierCreateResponse, Supplier } from '../../types';
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

  createBulk: (suppliers: BulkSupplierCreateInput[]): Promise<BulkSupplierCreateResponse> =>
    fetchApi<BulkSupplierCreateResponse>('/suppliers/bulk', {
      method: 'POST',
      body: JSON.stringify({ suppliers }),
    }).then((response) => ({
      ...response,
      results: response.results.map((result) =>
        result.success ? { ...result, supplier: normalizeSupplier(result.supplier) } : result,
      ),
    })),

  update: (id: string, updates: Partial<Supplier>): Promise<Supplier> =>
    fetchApi<Supplier>(`/suppliers/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    }).then(normalizeSupplier),

  delete: (id: string): Promise<void> => fetchApi(`/suppliers/${id}`, { method: 'DELETE' }),
};
