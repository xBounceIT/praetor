import type { SupplierOffer } from '../../types';
import { fetchApi } from './client';
import { normalizeSupplierOffer } from './normalizers';

export const supplierOffersApi = {
  list: (): Promise<SupplierOffer[]> =>
    fetchApi<SupplierOffer[]>('/sales/supplier-offers').then((offers) =>
      offers.map(normalizeSupplierOffer),
    ),

  create: (offerData: Partial<SupplierOffer>): Promise<SupplierOffer> =>
    fetchApi<SupplierOffer>('/sales/supplier-offers', {
      method: 'POST',
      body: JSON.stringify(offerData),
    }).then(normalizeSupplierOffer),

  update: (id: string, updates: Partial<SupplierOffer>): Promise<SupplierOffer> =>
    fetchApi<SupplierOffer>(`/sales/supplier-offers/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    }).then(normalizeSupplierOffer),

  delete: (id: string): Promise<void> =>
    fetchApi(`/sales/supplier-offers/${id}`, { method: 'DELETE' }),
};
