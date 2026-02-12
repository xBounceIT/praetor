import type { Expense } from '../../types';
import { fetchApi } from './client';
import { normalizeExpense } from './normalizers';

export const expensesApi = {
  list: (): Promise<Expense[]> =>
    fetchApi<Expense[]>('/expenses').then((expenses) => expenses.map(normalizeExpense)),

  create: (expenseData: Partial<Expense>): Promise<Expense> =>
    fetchApi<Expense>('/expenses', {
      method: 'POST',
      body: JSON.stringify(expenseData),
    }).then(normalizeExpense),

  update: (id: string, updates: Partial<Expense>): Promise<Expense> =>
    fetchApi<Expense>(`/expenses/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    }).then(normalizeExpense),

  delete: (id: string): Promise<void> => fetchApi(`/expenses/${id}`, { method: 'DELETE' }),
};
