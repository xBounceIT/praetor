import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Payment, Client, Invoice } from '../types';
import CustomSelect from './shared/CustomSelect';
import StandardTable from './shared/StandardTable';
import ValidatedNumberInput from './shared/ValidatedNumberInput';
import StatusBadge, { StatusType } from './shared/StatusBadge';
import Modal from './shared/Modal';

interface PaymentsViewProps {
  payments: Payment[];
  clients: Client[];
  invoices: Invoice[];
  onAddPayment: (paymentData: Partial<Payment>) => void;
  onUpdatePayment: (id: string, updates: Partial<Payment>) => void;
  onDeletePayment: (id: string) => void;
  currency: string;
}

const PaymentsView: React.FC<PaymentsViewProps> = ({
  payments,
  clients,
  invoices,
  onAddPayment,
  onUpdatePayment,
  onDeletePayment,
  currency,
}) => {
  const { t } = useTranslation('finances');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingPayment, setEditingPayment] = useState<Payment | null>(null);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [paymentToDelete, setPaymentToDelete] = useState<Payment | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const paymentMethodOptions = useMemo(
    () => [
      { id: 'bank_transfer', name: t('payments.methods.bankTransfer') },
      { id: 'credit_card', name: t('payments.methods.creditCard') },
      { id: 'cash', name: t('payments.methods.cash') },
      { id: 'check', name: t('payments.methods.check') },
      { id: 'other', name: t('payments.methods.other') },
    ],
    [t],
  );

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);

  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [filterClientId, setFilterClientId] = useState('all');

  const filteredPayments = useMemo(() => {
    return payments.filter((p) => {
      const matchesSearch =
        searchTerm === '' ||
        p.reference?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.clientName?.toLowerCase().includes(searchTerm.toLowerCase());

      const matchesClient = filterClientId === 'all' || p.clientId === filterClientId;

      return matchesSearch && matchesClient;
    });
  }, [payments, searchTerm, filterClientId]);

  const hasActiveFilters = searchTerm.trim() !== '' || filterClientId !== 'all';

  const handleClearFilters = () => {
    setSearchTerm('');
    setFilterClientId('all');
    setCurrentPage(1);
  };

  const activeClients = clients.filter((c) => !c.isDisabled);
  const activeInvoices = invoices.filter((i) => i.status !== 'cancelled');

  // Form State
  const [formData, setFormData] = useState<Partial<Payment>>({
    clientId: '',
    invoiceId: '',
    amount: 0,
    paymentDate: new Date().toISOString().split('T')[0],
    paymentMethod: 'bank_transfer',
    reference: '',
    notes: '',
  });

  const openAddModal = () => {
    setEditingPayment(null);
    setFormData({
      clientId: '',
      invoiceId: '',
      amount: 0,
      paymentDate: new Date().toISOString().split('T')[0],
      paymentMethod: 'bank_transfer',
      reference: '',
      notes: '',
    });
    setErrors({});
    setIsModalOpen(true);
  };

  const openEditModal = (payment: Payment) => {
    setEditingPayment(payment);
    setFormData({ ...payment });
    setErrors({});
    setIsModalOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors: Record<string, string> = {};

    if (!formData.clientId) newErrors.clientId = t('payments.client') + ' is required';
    if (!formData.amount || formData.amount <= 0)
      newErrors.amount = t('payments.validAmountRequired');
    if (!formData.paymentDate) newErrors.paymentDate = t('payments.paymentDate') + ' is required';

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    if (editingPayment) {
      onUpdatePayment(editingPayment.id, formData);
    } else {
      onAddPayment(formData);
    }
    setIsModalOpen(false);
  };

  const handleDelete = () => {
    if (paymentToDelete) {
      onDeletePayment(paymentToDelete.id);
      setIsDeleteConfirmOpen(false);
      setPaymentToDelete(null);
    }
  };

  const handleClientChange = (clientId: string) => {
    const client = clients.find((c) => c.id === clientId);
    setFormData({
      ...formData,
      clientId,
      clientName: client?.name,
      invoiceId: '', // Reset invoice when client changes
    });
  };

  const handleInvoiceChange = (invoiceId: string) => {
    const invoice = invoices.find((i) => i.id === invoiceId);
    if (invoice) {
      // Auto fill amount with remaining balance
      const balance = invoice.total - invoice.amountPaid;
      setFormData({
        ...formData,
        invoiceId,
        amount: parseFloat(balance.toFixed(2)),
      });
    } else {
      setFormData({ ...formData, invoiceId: '' });
    }
  };

  // Client's invoices for dropdown
  const clientInvoices = activeInvoices.filter((i) => i.clientId === formData.clientId);

  // Pagination Calculation
  const totalPages = Math.ceil(filteredPayments.length / rowsPerPage);
  const startIndex = (currentPage - 1) * rowsPerPage;
  const paginatedPayments = filteredPayments.slice(startIndex, startIndex + rowsPerPage);

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Modal */}
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden animate-in zoom-in duration-200">
          <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
            <h3 className="text-xl font-black text-slate-800 flex items-center gap-3">
              <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center text-praetor">
                <i className={`fa-solid ${editingPayment ? 'fa-pen-to-square' : 'fa-plus'}`}></i>
              </div>
              {editingPayment ? t('payments.editPayment') : t('payments.addPayment')}
            </h3>
            <button
              onClick={() => setIsModalOpen(false)}
              className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-slate-100 text-slate-400 transition-colors"
            >
              <i className="fa-solid fa-xmark text-lg"></i>
            </button>
          </div>

          <form onSubmit={handleSubmit} className="p-8 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-500 ml-1">
                  {t('payments.client')}
                </label>
                <CustomSelect
                  options={activeClients.map((c) => ({ id: c.id, name: c.name }))}
                  value={formData.clientId || ''}
                  onChange={handleClientChange}
                  placeholder={t('invoices.allClients')}
                  searchable={true}
                  className={errors.clientId ? 'border-red-300' : ''}
                  // Disable client change if linking to invoice is enforced or complex, but keeping simple for now
                  disabled={!!editingPayment}
                />
                {errors.clientId && (
                  <p className="text-red-500 text-[10px] font-bold ml-1">{errors.clientId}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-500 ml-1">
                  {t('payments.invoice')} ({t('common.optional')})
                </label>
                <CustomSelect
                  options={[
                    { id: '', name: t('payments.noInvoice') },
                    ...clientInvoices.map((i) => ({
                      id: i.id,
                      name: `#${i.invoiceNumber} - ${(i.total ?? 0).toFixed(2)} ${currency}`,
                    })),
                  ]}
                  value={formData.invoiceId || ''}
                  onChange={handleInvoiceChange}
                  placeholder={t('payments.linkToInvoice')}
                  searchable={true}
                  disabled={!formData.clientId} // Disable if no client selected
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-500 ml-1">
                  {t('payments.amount')} ({currency})
                </label>
                <ValidatedNumberInput
                  step="0.01"
                  required
                  value={formData.amount}
                  onValueChange={(value) => {
                    const parsed = parseFloat(value);
                    setFormData({
                      ...formData,
                      amount: value === '' || Number.isNaN(parsed) ? 0 : parsed,
                    });
                  }}
                  className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none font-semibold"
                />
                {errors.amount && (
                  <p className="text-red-500 text-[10px] font-bold ml-1">{errors.amount}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-500 ml-1">
                  {t('common.labels.date')}
                </label>
                <input
                  type="date"
                  required
                  value={formData.paymentDate}
                  onChange={(e) => setFormData({ ...formData, paymentDate: e.target.value })}
                  className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none"
                />
                {errors.paymentDate && (
                  <p className="text-red-500 text-[10px] font-bold ml-1">{errors.paymentDate}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-500 ml-1">
                  {t('payments.paymentMethod')}
                </label>
                <CustomSelect
                  options={paymentMethodOptions}
                  value={formData.paymentMethod || 'bank_transfer'}
                  onChange={(val) =>
                    setFormData({ ...formData, paymentMethod: val as Payment['paymentMethod'] })
                  }
                  searchable={false}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-500 ml-1">
                {t('payments.reference')}
              </label>
              <input
                type="text"
                placeholder={t('payments.referencePlaceholder')}
                value={formData.reference || ''}
                onChange={(e) => setFormData({ ...formData, reference: e.target.value })}
                className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-500 ml-1">{t('payments.notes')}</label>
              <textarea
                rows={3}
                value={formData.notes || ''}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                placeholder={t('payments.notesPlaceholder')}
                className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none resize-none"
              />
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="px-6 py-3 font-bold text-slate-500 hover:bg-slate-50 rounded-xl"
              >
                {t('common.buttons.cancel')}
              </button>
              <button
                type="submit"
                className="px-8 py-3 bg-praetor text-white font-bold rounded-xl hover:bg-slate-700 shadow-lg shadow-slate-200"
              >
                {t('common.buttons.save')}
              </button>
            </div>
          </form>
        </div>
      </Modal>

      {/* Delete Confirmation */}
      <Modal isOpen={isDeleteConfirmOpen} onClose={() => setIsDeleteConfirmOpen(false)}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden p-6 text-center space-y-4">
          <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto text-red-600">
            <i className="fa-solid fa-triangle-exclamation text-xl"></i>
          </div>
          <h3 className="text-lg font-black text-slate-800">{t('payments.paymentDeleted')}?</h3>
          <p className="text-sm text-slate-500">{t('payments.deleteConfirm')}</p>
          <div className="flex gap-3 pt-2">
            <button
              onClick={() => setIsDeleteConfirmOpen(false)}
              className="flex-1 py-3 font-bold text-slate-500 hover:bg-slate-50 rounded-xl"
            >
              {t('common.buttons.cancel')}
            </button>
            <button
              onClick={handleDelete}
              className="flex-1 py-3 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700"
            >
              {t('common.buttons.delete')}
            </button>
          </div>
        </div>
      </Modal>

      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-black text-slate-800">{t('payments.title')}</h2>
          <p className="text-slate-500 text-sm">{t('payments.subtitle')}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="md:col-span-2 relative">
          <i className="fa-solid fa-search absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"></i>
          <input
            type="text"
            placeholder={t('payments.searchPayments')}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-semibold focus:ring-2 focus:ring-praetor outline-none shadow-sm"
          />
        </div>
        <div>
          <CustomSelect
            options={[
              { id: 'all', name: t('invoices.allClients') },
              ...activeClients.map((c) => ({ id: c.id, name: c.name })),
            ]}
            value={filterClientId}
            onChange={setFilterClientId}
            placeholder={t('invoices.filterClient')}
            searchable={true}
          />
        </div>
        <div className="flex items-center justify-end">
          <button
            type="button"
            onClick={handleClearFilters}
            disabled={!hasActiveFilters}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-bold text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <i className="fa-solid fa-rotate-left"></i>
            {t('common:labels.clearFilters')}
          </button>
        </div>
      </div>

      {/* Table */}
      <StandardTable
        title={t('payments.title')}
        totalCount={filteredPayments.length}
        containerClassName="overflow-visible"
        headerAction={
          <button
            onClick={openAddModal}
            className="bg-praetor text-white px-4 py-2.5 rounded-xl text-sm font-black shadow-xl shadow-slate-200 hover:bg-slate-700 flex items-center gap-2"
          >
            <i className="fa-solid fa-plus"></i> {t('payments.addPayment')}
          </button>
        }
        footer={
          <>
            <div className="flex items-center gap-3">
              <span className="text-xs font-bold text-slate-500">
                {t('common:pagination.rowsPerPage')}:
              </span>
              <CustomSelect
                options={[
                  { id: '10', name: '10' },
                  { id: '20', name: '20' },
                  { id: '50', name: '50' },
                ]}
                value={rowsPerPage.toString()}
                onChange={(val) => {
                  setRowsPerPage(parseInt(val));
                  setCurrentPage(1);
                }}
                className="w-20"
                searchable={false}
                buttonClassName="text-xs py-1"
              />
              <span className="text-xs font-bold text-slate-400 ml-2">
                {t('common:pagination.showing', {
                  start: paginatedPayments.length > 0 ? startIndex + 1 : 0,
                  end: Math.min(startIndex + rowsPerPage, filteredPayments.length),
                  total: filteredPayments.length,
                })}
              </span>
            </div>
            <div className="flex gap-2">
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                <button
                  key={page}
                  onClick={() => setCurrentPage(page)}
                  className={`w-8 h-8 rounded-lg text-xs font-bold ${currentPage === page ? 'bg-praetor text-white' : 'hover:bg-slate-100 text-slate-500'}`}
                >
                  {page}
                </button>
              ))}
            </div>
          </>
        }
      >
        <table className="w-full text-left border-collapse">
          <thead className="bg-slate-50 border-b border-slate-100">
            <tr>
              <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                {t('common:labels.date')}
              </th>
              <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                {t('payments.client')}
              </th>
              <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                {t('payments.invoice')}
              </th>
              <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                {t('payments.amount')}
              </th>
              <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                {t('payments.paymentMethod')}
              </th>
              <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                {t('payments.reference')}
              </th>
              <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">
                {t('common:labels.actions')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {paginatedPayments.map((payment) => {
              const invoice = invoices.find((i) => i.id === payment.invoiceId);
              const client = clients.find((c) => c.id === payment.clientId);
              return (
                <tr
                  key={payment.id}
                  onClick={() => openEditModal(payment)}
                  className="hover:bg-slate-50/50 cursor-pointer transition-colors"
                >
                  <td className="px-6 py-4 text-sm text-slate-600">
                    {new Date(payment.paymentDate).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-4 font-bold text-slate-800">
                    {client?.name || t('payments.unknownClient')}
                  </td>
                  <td className="px-6 py-4">
                    {invoice ? (
                      <span className="bg-slate-100 text-slate-600 px-2 py-1 rounded text-xs font-bold">
                        #{invoice.invoiceNumber}
                      </span>
                    ) : (
                      <span className="text-slate-400 text-xs italic">
                        {t('payments.unlinked')}
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 font-bold text-emerald-600">
                    {payment.amount.toFixed(2)} {currency}
                  </td>
                  <td className="px-6 py-4">
                    <StatusBadge
                      type={
                        (
                          {
                            bank_transfer: 'sent',
                            credit_card: 'accepted',
                            cash: 'paid',
                            check: 'pending',
                            other: 'draft',
                          } as Record<string, StatusType>
                        )[payment.paymentMethod] || 'draft'
                      }
                      label={
                        paymentMethodOptions.find((opt) => opt.id === payment.paymentMethod)
                          ?.name || payment.paymentMethod
                      }
                    />
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-500 font-mono">
                    {payment.reference || '-'}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        openEditModal(payment);
                      }}
                      className="p-2 text-slate-400 hover:text-praetor hover:bg-slate-100 rounded-lg transition-all"
                    >
                      <i className="fa-solid fa-pen-to-square"></i>
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setPaymentToDelete(payment);
                        setIsDeleteConfirmOpen(true);
                      }}
                      className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                    >
                      <i className="fa-solid fa-trash-can"></i>
                    </button>
                  </td>
                </tr>
              );
            })}
            {paginatedPayments.length === 0 && (
              <tr>
                <td colSpan={7} className="p-12 text-center text-slate-400 text-sm font-bold">
                  {t('payments.noPayments')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </StandardTable>
    </div>
  );
};

export default PaymentsView;
