import type React from 'react';
import api from '../../services/api';
import type { Product } from '../../types';

export type ProductHandlersDeps = {
  setProducts: React.Dispatch<React.SetStateAction<Product[]>>;
};

export const makeProductHandlers = (deps: ProductHandlersDeps) => {
  const { setProducts } = deps;

  const add = async (productData: Partial<Product>) => {
    try {
      const product = await api.products.create(productData);
      setProducts((prev) => [...prev, product]);
    } catch (err) {
      console.error('Failed to add product:', err);
      throw err;
    }
  };

  const update = async (id: string, updates: Partial<Product>) => {
    try {
      const updated = await api.products.update(id, updates);
      setProducts((prev) => prev.map((p) => (p.id === id ? updated : p)));
    } catch (err) {
      console.error('Failed to update product:', err);
      throw err;
    }
  };

  const remove = async (id: string) => {
    try {
      await api.products.delete(id);
      setProducts((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      console.error('Failed to delete product:', err);
    }
  };

  const createInternalCategory = async (categoryData: { name: string; type: string }) => {
    try {
      await api.products.createInternalCategory(categoryData);
    } catch (err) {
      console.error('Failed to create internal category:', err);
      throw err;
    }
  };

  const updateInternalCategory = async (id: string, updates: Partial<{ name: string }>) => {
    try {
      await api.products.updateInternalCategory(id, updates);
      const updatedProducts = await api.products.list();
      setProducts(updatedProducts);
    } catch (err) {
      console.error('Failed to update internal category:', err);
      throw err;
    }
  };

  const deleteInternalCategory = async (id: string) => {
    try {
      await api.products.deleteInternalCategory(id);
      const updatedProducts = await api.products.list();
      setProducts(updatedProducts);
    } catch (err) {
      console.error('Failed to delete internal category:', err);
      throw err;
    }
  };

  const createInternalSubcategory = async (subcategoryData: {
    name: string;
    type: string;
    category: string;
  }) => {
    try {
      await api.products.createInternalSubcategory(subcategoryData);
    } catch (err) {
      console.error('Failed to create internal subcategory:', err);
      throw err;
    }
  };

  const renameInternalSubcategory = async (
    oldName: string,
    newName: string,
    type: string,
    category: string,
  ) => {
    try {
      await api.products.renameInternalSubcategory(oldName, newName, type, category);
      const updatedProducts = await api.products.list();
      setProducts(updatedProducts);
    } catch (err) {
      console.error('Failed to rename internal subcategory:', err);
      throw err;
    }
  };

  const deleteInternalSubcategory = async (name: string, type: string, category: string) => {
    try {
      await api.products.deleteInternalSubcategory(name, type, category);
      const updatedProducts = await api.products.list();
      setProducts(updatedProducts);
    } catch (err) {
      console.error('Failed to delete internal subcategory:', err);
      throw err;
    }
  };

  const createProductType = async (typeData: { name: string; costUnit: 'unit' | 'hours' }) => {
    try {
      await api.products.createProductType(typeData);
    } catch (err) {
      console.error('Failed to create product type:', err);
      throw err;
    }
  };

  const updateProductType = async (
    id: string,
    updates: Partial<{ name: string; costUnit: 'unit' | 'hours' }>,
  ) => {
    try {
      await api.products.updateProductType(id, updates);
      const updatedProducts = await api.products.list();
      setProducts(updatedProducts);
    } catch (err) {
      console.error('Failed to update product type:', err);
      throw err;
    }
  };

  const deleteProductType = async (id: string) => {
    try {
      await api.products.deleteProductType(id);
    } catch (err) {
      console.error('Failed to delete product type:', err);
      throw err;
    }
  };

  return {
    add,
    update,
    delete: remove,
    createInternalCategory,
    updateInternalCategory,
    deleteInternalCategory,
    createInternalSubcategory,
    renameInternalSubcategory,
    deleteInternalSubcategory,
    createProductType,
    updateProductType,
    deleteProductType,
  };
};
