import type React from 'react';
import api from '../../services/api';
import type { BulkSupplierCreateInput, BulkSupplierCreateResponse, Supplier } from '../../types';

export type SupplierHandlersDeps = {
  setSuppliers: React.Dispatch<React.SetStateAction<Supplier[]>>;
};

export const makeSupplierHandlers = (deps: SupplierHandlersDeps) => {
  const { setSuppliers } = deps;

  const add = async (supplierData: Partial<Supplier>) => {
    try {
      const supplier = await api.suppliers.create(supplierData);
      setSuppliers((prev) => [...prev, supplier]);
    } catch (err) {
      console.error('Failed to add supplier:', err);
      throw err;
    }
  };

  const addBulk = async (
    suppliersToCreate: BulkSupplierCreateInput[],
  ): Promise<BulkSupplierCreateResponse> => {
    try {
      const response = await api.suppliers.createBulk(suppliersToCreate);
      const created = response.results.flatMap((result) =>
        result.success ? [result.supplier] : [],
      );
      if (created.length > 0) {
        setSuppliers((prev) => [...prev, ...created]);
      }
      return response;
    } catch (err) {
      console.error('Failed to add suppliers in bulk:', err);
      throw err;
    }
  };

  const update = async (id: string, updates: Partial<Supplier>) => {
    try {
      const updated = await api.suppliers.update(id, updates);
      setSuppliers((prev) => prev.map((s) => (s.id === id ? updated : s)));
    } catch (err) {
      console.error('Failed to update supplier:', err);
      throw err;
    }
  };

  const remove = async (id: string) => {
    try {
      await api.suppliers.delete(id);
      setSuppliers((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      console.error('Failed to delete supplier:', err);
      throw err;
    }
  };

  return { add, addBulk, update, delete: remove };
};
