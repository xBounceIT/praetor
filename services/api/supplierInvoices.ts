import type { SupplierInvoice } from '../../types';
import { fetchApi } from './client';
import { normalizeSupplierInvoice } from './normalizers';
import { encodePathSegment } from './path';

const supplierInvoicePath = (id: string): string =>
  `/accounting/supplier-invoices/${encodePathSegment(id)}`;

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
    fetchApi<SupplierInvoice>(supplierInvoicePath(id), {
      method: 'PUT',
      body: JSON.stringify(updates),
    }).then(normalizeSupplierInvoice),

  delete: (id: string): Promise<void> => fetchApi(supplierInvoicePath(id), { method: 'DELETE' }),
};
