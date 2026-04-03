import type { Product } from '../../types';
import { fetchApi } from './client';
import { normalizeProduct } from './normalizers';

export interface InternalProductType {
  id: string;
  name: string;
  costUnit: 'unit' | 'hours';
  createdAt?: number;
  updatedAt?: number;
  productCount: number;
  categoryCount: number;
}

export interface InternalProductCategory {
  id: string;
  name: string;
  type: string;
  createdAt?: number;
  updatedAt?: number;
  productCount: number;
  costUnit: 'unit' | 'hours';
  hasLinkedProducts: boolean;
}

export interface InternalProductSubcategory {
  name: string;
  productCount: number;
  hasLinkedProducts: boolean;
}

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

  // Product Types (User-Managed)
  listProductTypes: (): Promise<InternalProductType[]> =>
    fetchApi<InternalProductType[]>('/products/internal-types'),

  createProductType: (typeData: {
    name: string;
    costUnit: 'unit' | 'hours';
  }): Promise<InternalProductType> =>
    fetchApi<InternalProductType>('/products/internal-types', {
      method: 'POST',
      body: JSON.stringify(typeData),
    }),

  updateProductType: (
    id: string,
    updates: Partial<{ name: string; costUnit: 'unit' | 'hours' }>,
  ): Promise<InternalProductType> =>
    fetchApi<InternalProductType>(`/products/internal-types/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    }),

  deleteProductType: (id: string): Promise<void> =>
    fetchApi(`/products/internal-types/${id}`, { method: 'DELETE' }),

  // Internal Product Categories
  listInternalCategories: (type: string): Promise<InternalProductCategory[]> =>
    fetchApi<InternalProductCategory[]>(
      `/products/internal-categories?type=${encodeURIComponent(type)}`,
    ),

  createInternalCategory: (categoryData: {
    name: string;
    type: string;
  }): Promise<InternalProductCategory> =>
    fetchApi<InternalProductCategory>('/products/internal-categories', {
      method: 'POST',
      body: JSON.stringify(categoryData),
    }),

  updateInternalCategory: (
    id: string,
    updates: Partial<{ name: string }>,
  ): Promise<InternalProductCategory> =>
    fetchApi<InternalProductCategory>(`/products/internal-categories/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    }),

  deleteInternalCategory: (id: string): Promise<void> =>
    fetchApi(`/products/internal-categories/${id}`, { method: 'DELETE' }),

  // Internal Product Subcategories
  listInternalSubcategories: (
    type: string,
    category: string,
  ): Promise<InternalProductSubcategory[]> =>
    fetchApi<InternalProductSubcategory[]>(
      `/products/internal-subcategories?type=${encodeURIComponent(type)}&category=${encodeURIComponent(category)}`,
    ),

  createInternalSubcategory: (subcategoryData: {
    name: string;
    type: string;
    category: string;
  }): Promise<InternalProductSubcategory> =>
    fetchApi<InternalProductSubcategory>('/products/internal-subcategories', {
      method: 'POST',
      body: JSON.stringify(subcategoryData),
    }),

  renameInternalSubcategory: (
    oldName: string,
    newName: string,
    type: string,
    category: string,
  ): Promise<InternalProductSubcategory> =>
    fetchApi<InternalProductSubcategory>(
      `/products/internal-subcategories/${encodeURIComponent(oldName)}`,
      {
        method: 'PUT',
        body: JSON.stringify({ newName, type, category }),
      },
    ),

  deleteInternalSubcategory: (name: string, type: string, category: string): Promise<void> =>
    fetchApi(
      `/products/internal-subcategories/${encodeURIComponent(name)}?type=${encodeURIComponent(type)}&category=${encodeURIComponent(category)}`,
      { method: 'DELETE' },
    ),
};
