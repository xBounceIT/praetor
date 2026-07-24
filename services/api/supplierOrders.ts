import type { SupplierOrderVersion, SupplierOrderVersionRow, SupplierSaleOrder } from '../../types';
import { fetchApi } from './client';
import { normalizeSupplierSaleOrder } from './normalizers';
import { encodePathSegment } from './path';

const supplierOrderPath = (id: string): string =>
  `/accounting/supplier-orders/${encodePathSegment(id)}`;

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
    fetchApi<SupplierSaleOrder>(supplierOrderPath(id), {
      method: 'PUT',
      body: JSON.stringify(updates),
    }).then(normalizeSupplierSaleOrder),

  delete: (id: string): Promise<void> => fetchApi(supplierOrderPath(id), { method: 'DELETE' }),

  listVersions: (id: string): Promise<SupplierOrderVersionRow[]> =>
    fetchApi<SupplierOrderVersionRow[]>(`${supplierOrderPath(id)}/versions`),

  getVersion: (id: string, versionId: string): Promise<SupplierOrderVersion> =>
    fetchApi<SupplierOrderVersion>(
      `${supplierOrderPath(id)}/versions/${encodePathSegment(versionId)}`,
    ),

  restoreVersion: (id: string, versionId: string): Promise<SupplierSaleOrder> =>
    fetchApi<SupplierSaleOrder>(
      `${supplierOrderPath(id)}/versions/${encodePathSegment(versionId)}/restore`,
      { method: 'POST' },
    ).then(normalizeSupplierSaleOrder),
};
