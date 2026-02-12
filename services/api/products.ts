import type { Product } from '../../types';
import { fetchApi } from './client';
import { normalizeProduct } from './normalizers';

export const productsApi = {
  list: (): Promise<Product[]> =>
    fetchApi<Product[]>('/products').then((products) => products.map(normalizeProduct)),

  create: (productData: Partial<Product>): Promise<Product> =>
    fetchApi<Product>('/products', {
      method: 'POST',
      body: JSON.stringify(productData),
    }).then(normalizeProduct),

  update: (id: string, updates: Partial<Product>): Promise<Product> =>
    fetchApi<Product>(`/products/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    }).then(normalizeProduct),

  delete: (id: string): Promise<void> => fetchApi(`/products/${id}`, { method: 'DELETE' }),
};
