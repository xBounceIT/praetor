import type { SupplierOrderVersion, SupplierOrderVersionRow, SupplierSaleOrder } from '../../types';
import { fetchApi } from './client';
import { normalizeSupplierSaleOrder } from './normalizers';

export const supplierOrdersApi = {
  list: (): Promise<SupplierSaleOrder[]> =>
    fetchApi<SupplierSaleOrder[]>('/accounting/supplier-orders').then((orders) =>
      orders.map(normalizeSupplierSaleOrder),
    ),

  create: (orderData: Partial<SupplierSaleOrder>): Promise<SupplierSaleOrder> =>
    fetchApi<SupplierSaleOrder>('/accounting/supplier-orders', {
      method: 'POST',
      body: JSON.stringify(orderData),
    }).then(normalizeSupplierSaleOrder),

  update: (id: string, updates: Partial<SupplierSaleOrder>): Promise<SupplierSaleOrder> =>
    fetchApi<SupplierSaleOrder>(`/accounting/supplier-orders/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    }).then(normalizeSupplierSaleOrder),

  delete: (id: string): Promise<void> =>
    fetchApi(`/accounting/supplier-orders/${id}`, { method: 'DELETE' }),

  listVersions: (id: string): Promise<SupplierOrderVersionRow[]> =>
    fetchApi<SupplierOrderVersionRow[]>(`/accounting/supplier-orders/${id}/versions`),

  getVersion: (id: string, versionId: string): Promise<SupplierOrderVersion> =>
    fetchApi<SupplierOrderVersion>(`/accounting/supplier-orders/${id}/versions/${versionId}`),

  restoreVersion: (id: string, versionId: string): Promise<SupplierSaleOrder> =>
    fetchApi<SupplierSaleOrder>(`/accounting/supplier-orders/${id}/versions/${versionId}/restore`, {
      method: 'POST',
    }).then(normalizeSupplierSaleOrder),
};
