import type { Payment } from '../../types';
import { fetchApi } from './client';
import { normalizePayment } from './normalizers';

export const paymentsApi = {
  list: (): Promise<Payment[]> =>
    fetchApi<Payment[]>('/payments').then((payments) => payments.map(normalizePayment)),

  create: (paymentData: Partial<Payment>): Promise<Payment> =>
    fetchApi<Payment>('/payments', {
      method: 'POST',
      body: JSON.stringify(paymentData),
    }).then(normalizePayment),

  update: (id: string, updates: Partial<Payment>): Promise<Payment> =>
    fetchApi<Payment>(`/payments/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    }).then(normalizePayment),

  delete: (id: string): Promise<void> => fetchApi(`/payments/${id}`, { method: 'DELETE' }),
};
