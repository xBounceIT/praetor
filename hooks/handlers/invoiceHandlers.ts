import type React from 'react';
import api from '../../services/api';
import type { Invoice } from '../../types';

export type InvoiceHandlersDeps = {
  setInvoices: React.Dispatch<React.SetStateAction<Invoice[]>>;
};

export const makeInvoiceHandlers = (deps: InvoiceHandlersDeps) => {
  const { setInvoices } = deps;

  const add = async (invoiceData: Partial<Invoice>) => {
    try {
      const invoice = await api.invoices.create(invoiceData);
      setInvoices((prev) => [...prev, invoice]);
    } catch (err) {
      console.error('Failed to add invoice:', err);
    }
  };

  const update = async (id: string, updates: Partial<Invoice>) => {
    try {
      const updated = await api.invoices.update(id, updates);
      setInvoices((prev) => prev.map((i) => (i.id === id ? updated : i)));
    } catch (err) {
      console.error('Failed to update invoice:', err);
    }
  };

  const remove = async (id: string) => {
    try {
      await api.invoices.delete(id);
      setInvoices((prev) => prev.filter((i) => i.id !== id));
    } catch (err) {
      console.error('Failed to delete invoice:', err);
    }
  };

  return { add, update, delete: remove };
};
