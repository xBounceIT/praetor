import type { SupplierSaleOrder } from '../../types';
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
};
