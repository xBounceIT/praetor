import type React from 'react';
import api from '../../services/api';
import type { Supplier } from '../../types';

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
    }
  };

  const update = async (id: string, updates: Partial<Supplier>) => {
    try {
      const updated = await api.suppliers.update(id, updates);
      setSuppliers((prev) => prev.map((s) => (s.id === id ? updated : s)));
    } catch (err) {
      console.error('Failed to update supplier:', err);
    }
  };

  const remove = async (id: string) => {
    try {
      await api.suppliers.delete(id);
      setSuppliers((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      console.error('Failed to delete supplier:', err);
    }
  };

  return { add, update, delete: remove };
};
