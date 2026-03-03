import type { SupplierInvoice } from '../../types';
import { fetchApi } from './client';
import { normalizeSupplierInvoice } from './normalizers';

export const supplierInvoicesApi = {
  list: (): Promise<SupplierInvoice[]> =>
    fetchApi<SupplierInvoice[]>('/accounting/supplier-invoices').then((invoices) =>
      invoices.map(normalizeSupplierInvoice),
    ),

  create: (invoiceData: Partial<SupplierInvoice>): Promise<SupplierInvoice> =>
    fetchApi<SupplierInvoice>('/accounting/supplier-invoices', {
      method: 'POST',
      body: JSON.stringify(invoiceData),
    }).then(normalizeSupplierInvoice),

  update: (id: string, updates: Partial<SupplierInvoice>): Promise<SupplierInvoice> =>
    fetchApi<SupplierInvoice>(`/accounting/supplier-invoices/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    }).then(normalizeSupplierInvoice),

  delete: (id: string): Promise<void> =>
    fetchApi(`/accounting/supplier-invoices/${id}`, { method: 'DELETE' }),
};
