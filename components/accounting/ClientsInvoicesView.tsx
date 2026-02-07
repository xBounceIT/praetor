import type React from 'react';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Client, ClientsOrder, Invoice, InvoiceItem, Product } from '../../types';
import { roundToTwoDecimals } from '../../utils/numbers';
import CustomSelect from '../shared/CustomSelect';
import Modal from '../shared/Modal';
import StandardTable from '../shared/StandardTable';
import StatusBadge, { type StatusType } from '../shared/StatusBadge';
import ValidatedNumberInput from '../shared/ValidatedNumberInput';

interface ClientsInvoicesViewProps {
  invoices: Invoice[];
  clients: Client[];
  products: Product[];
  clientsOrders: ClientsOrder[];
  onAddInvoice: (invoiceData: Partial<Invoice>) => void;
  onUpdateInvoice: (id: string, updates: Partial<Invoice>) => void;
  onDeleteInvoice: (id: string) => void;
  currency: string;
}

const calcProductSalePrice = (costo: number, molPercentage: number) => {
  if (molPercentage >= 100) return costo;
  return costo / (1 - molPercentage / 100);
};

const ClientsInvoicesView: React.FC<ClientsInvoicesViewProps> = ({
  invoices,
  clients,
  products,
  clientsOrders: _clientsOrders,
  onAddInvoice,
  onUpdateInvoice,
  onDeleteInvoice,
  currency,
}) => {
  const { t } = useTranslation(['accounting', 'common']);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState<Invoice | null>(null);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [invoiceToDelete, setInvoiceToDelete] = useState<Invoice | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const statusOptions = useMemo(
    () => [
      { id: 'draft', name: t('accounting:clientsInvoices.statusDraft') },
      { id: 'sent', name: t('accounting:clientsInvoices.statusSent') },
      { id: 'paid', name: t('accounting:clientsInvoices.statusPaid') },
      { id: 'overdue', name: t('accounting:clientsInvoices.statusOverdue') },
      { id: 'cancelled', name: t('accounting:clientsInvoices.statusCancelled') },
    ],
    [t],
  );

  // Form State
  const defaultInvoice = useMemo(() => {
    const now = new Date();
    const dueDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    return {
      clientId: '',
      clientName: '',
      invoiceNumber: '',
      items: [],
      issueDate: now.toISOString().split('T')[0],
      dueDate: dueDate.toISOString().split('T')[0],
      status: 'draft' as const,
      notes: '',
      amountPaid: 0,
      subtotal: 0,
      taxAmount: 0,
      total: 0,
    };
  }, []);

  const [formData, setFormData] = useState<Partial<Invoice>>(defaultInvoice);

  const generateInvoiceNumber = () => {
    const year = new Date().getFullYear();
    const count = invoices.length + 1;
    return `INV-${year}-${count.toString().padStart(4, '0')}`;
  };

  const openAddModal = () => {
    setEditingInvoice(null);
    setFormData({
      clientId: '',
      clientName: '',
      invoiceNumber: generateInvoiceNumber(),
      items: [],
      issueDate: new Date().toISOString().split('T')[0],
      dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      status: 'draft',
      notes: '',
      amountPaid: 0,
      subtotal: 0,
      taxAmount: 0,
      total: 0,
    });
    setErrors({});
    setIsModalOpen(true);
  };

  const openEditModal = useCallback((invoice: Invoice) => {
    setEditingInvoice(invoice);
    setFormData({
      ...invoice,
    });
    setErrors({});
    setIsModalOpen(true);
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const newErrors: Record<string, string> = {};

    if (!formData.clientId)
      newErrors.clientId = t('accounting:clientsInvoices.client') + ' is required';
    if (!formData.invoiceNumber)
      newErrors.invoiceNumber = t('accounting:clientsInvoices.invoiceNumber') + ' is required';
    if (!formData.issueDate)
      newErrors.issueDate = t('accounting:clientsInvoices.issueDate') + ' is required';
    if (!formData.dueDate)
      newErrors.dueDate = t('accounting:clientsInvoices.dueDate') + ' is required';
    if (!formData.items || formData.items.length === 0)
      newErrors.items = t('crm:quotes.errors.itemsRequired');

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    // Round items first
    const items = formData.items || [];
    const roundedItems = items.map((item) => ({
      ...item,
      unitPrice: roundToTwoDecimals(item.unitPrice),
      discount: item.discount ? roundToTwoDecimals(item.discount) : 0,
      taxRate: roundToTwoDecimals(item.taxRate || 0),
    }));

    // Recalculate totals before submit to be safe
    const { subtotal, totalTax, total } = calculateTotals(roundedItems);
    const finalData = {
      ...formData,
      items: roundedItems,
      amountPaid: formData.amountPaid ? roundToTwoDecimals(formData.amountPaid) : 0,
      subtotal: roundToTwoDecimals(subtotal),
      taxAmount: roundToTwoDecimals(totalTax),
      total: roundToTwoDecimals(total),
    };

    if (editingInvoice) {
      onUpdateInvoice(editingInvoice.id, finalData);
    } else {
      onAddInvoice(finalData);
    }
    setIsModalOpen(false);
  };

  const confirmDelete = useCallback((invoice: Invoice) => {
    setInvoiceToDelete(invoice);
    setIsDeleteConfirmOpen(true);
  }, []);

  const handleDelete = () => {
    if (invoiceToDelete) {
      onDeleteInvoice(invoiceToDelete.id);
      setIsDeleteConfirmOpen(false);
      setInvoiceToDelete(null);
    }
  };

  const handleClientChange = (clientId: string) => {
    const client = clients.find((c) => c.id === clientId);
    setFormData({
      ...formData,
      clientId,
      clientName: client?.name || '',
    });
    if (errors.clientId) {
      setErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors.clientId;
        return newErrors;
      });
    }
  };

  const addItemRow = () => {
    const newItem: Partial<InvoiceItem> = {
      id: 'temp-' + Date.now(),
      productId: undefined,
      description: '',
      quantity: 1,
      unitPrice: 0,
      taxRate: 22, // Default tax rate
      discount: 0,
    };
    setFormData({
      ...formData,
      items: [...(formData.items || []), newItem as InvoiceItem],
    });
    if (errors.items) {
      setErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors.items;
        return newErrors;
      });
    }
  };

  const removeItemRow = (index: number) => {
    const newItems = [...(formData.items || [])];
    newItems.splice(index, 1);
    setFormData({ ...formData, items: newItems });
  };

  const updateItemRow = (index: number, field: keyof InvoiceItem, value: string | number) => {
    const newItems = [...(formData.items || [])];
    newItems[index] = { ...newItems[index], [field]: value };

    // Auto-fill from product
    if (field === 'productId') {
      const product = products.find((p) => p.id === value);
      if (product) {
        newItems[index].description = product.name;
        newItems[index].unitPrice = calcProductSalePrice(product.costo, product.molPercentage);
        newItems[index].taxRate = product.taxRate;
      }
    }

    setFormData({ ...formData, items: newItems });
  };

  const calculateTotals = (items: InvoiceItem[]) => {
    let subtotal = 0;
    const taxGroups: Record<number, number> = {};

    items.forEach((item) => {
      const lineSubtotal = item.quantity * item.unitPrice;
      const lineDiscount = item.discount ? (lineSubtotal * item.discount) / 100 : 0;
      const lineNet = lineSubtotal - lineDiscount;

      subtotal += lineNet;

      const taxRate = item.taxRate || 0;
      const taxAmount = lineNet * (taxRate / 100);
      taxGroups[taxRate] = (taxGroups[taxRate] || 0) + taxAmount;
    });

    const totalTax = Object.values(taxGroups).reduce((sum, val) => sum + val, 0);
    const total = subtotal + totalTax;

    return { subtotal, totalTax, total, taxGroups };
  };

  const activeClients = clients.filter((c) => !c.isDisabled);
  const activeProducts = products.filter((p) => !p.isDisabled);

  // Form Calculation for display
  const { subtotal, total, taxGroups } = calculateTotals(formData.items || []);

  // Table columns definition with TableFilter support
  const columns = useMemo(
    () => [
      {
        header: t('accounting:clientsInvoices.invoiceNumber'),
        accessorFn: (row: Invoice) => row.invoiceNumber,
        cell: ({ row }: { row: Invoice }) => (
          <span className="font-bold text-slate-700">{row.invoiceNumber}</span>
        ),
      },
      {
        header: t('accounting:clientsInvoices.client'),
        accessorFn: (row: Invoice) => row.clientName,
        cell: ({ row }: { row: Invoice }) => (
          <span className="font-bold text-slate-800">{row.clientName}</span>
        ),
      },
      {
        header: t('common:labels.date'),
        accessorFn: (row: Invoice) => new Date(row.issueDate).toLocaleDateString(),
        cell: ({ row }: { row: Invoice }) => (
          <span className="text-sm text-slate-600">
            {new Date(row.issueDate).toLocaleDateString()}
          </span>
        ),
      },
      {
        header: t('accounting:clientsInvoices.dueDate'),
        accessorFn: (row: Invoice) => new Date(row.dueDate).toLocaleDateString(),
        cell: ({ row }: { row: Invoice }) => (
          <span className="text-sm text-slate-600">
            {new Date(row.dueDate).toLocaleDateString()}
          </span>
        ),
      },
      {
        header: t('common:labels.amount'),
        accessorFn: (row: Invoice) => row.total,
        cell: ({ row }: { row: Invoice }) => (
          <span className="font-bold text-slate-700">
            {(row.total ?? 0).toFixed(2)} {currency}
          </span>
        ),
        filterFormat: (val: unknown) => (val as number).toFixed(2),
      },
      {
        header: t('accounting:clientsInvoices.balance'),
        accessorFn: (row: Invoice) => row.total - row.amountPaid,
        cell: ({ row }: { row: Invoice }) => {
          const balance = row.total - row.amountPaid;
          return (
            <span className={`font-bold ${balance > 0 ? 'text-red-500' : 'text-emerald-600'}`}>
              {balance.toFixed(2)} {currency}
            </span>
          );
        },
        filterFormat: (val: unknown) => (val as number).toFixed(2),
      },
      {
        header: t('accounting:clientsInvoices.status'),
        accessorFn: (row: Invoice) =>
          statusOptions.find((opt) => opt.id === row.status)?.name || row.status,
        cell: ({ row }: { row: Invoice }) => (
          <StatusBadge
            type={row.status as StatusType}
            label={statusOptions.find((opt) => opt.id === row.status)?.name || row.status}
          />
        ),
      },
      {
        header: t('common:common.more'),
        id: 'actions',
        disableSorting: true,
        disableFiltering: true,
        align: 'right' as const,
        cell: ({ row }: { row: Invoice }) => (
          <div className="flex justify-end gap-2">
            <button
              onClick={(e) => {
                e.stopPropagation();
                openEditModal(row);
              }}
              className="p-2 text-slate-400 hover:text-praetor hover:bg-slate-100 rounded-lg transition-all"
            >
              <i className="fa-solid fa-pen-to-square"></i>
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                confirmDelete(row);
              }}
              className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
            >
              <i className="fa-solid fa-trash-can"></i>
            </button>
          </div>
        ),
      },
    ],
    [currency, statusOptions, t, confirmDelete, openEditModal],
  );

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Modal */}
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl overflow-hidden animate-in zoom-in duration-200 flex flex-col max-h-[90vh]">
          <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
            <h3 className="text-xl font-black text-slate-800 flex items-center gap-3">
              <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center text-praetor">
                <i className={`fa-solid ${editingInvoice ? 'fa-pen-to-square' : 'fa-plus'}`}></i>
              </div>
              {editingInvoice
                ? t('accounting:clientsInvoices.editInvoice')
                : t('accounting:clientsInvoices.addInvoice')}
            </h3>
            <button
              onClick={() => setIsModalOpen(false)}
              className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-slate-100 text-slate-400 transition-colors"
            >
              <i className="fa-solid fa-xmark text-lg"></i>
            </button>
          </div>

          <form onSubmit={handleSubmit} className="overflow-y-auto p-8 space-y-8 flex-1">
            {/* Header Info */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-500 ml-1">
                  {t('accounting:clientsInvoices.invoiceNumber')}
                </label>
                <input
                  type="text"
                  required
                  value={formData.invoiceNumber}
                  onChange={(e) => setFormData({ ...formData, invoiceNumber: e.target.value })}
                  className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none font-bold"
                  placeholder="INV-YYYY-XXXX"
                />
                {errors.invoiceNumber && (
                  <p className="text-red-500 text-[10px] font-bold ml-1">{errors.invoiceNumber}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-500 ml-1">
                  {t('accounting:clientsInvoices.issueDate')}
                </label>
                <input
                  type="date"
                  required
                  value={formData.issueDate}
                  onChange={(e) => setFormData({ ...formData, issueDate: e.target.value })}
                  className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-500 ml-1">
                  {t('accounting:clientsInvoices.dueDate')}
                </label>
                <input
                  type="date"
                  required
                  value={formData.dueDate}
                  onChange={(e) => setFormData({ ...formData, dueDate: e.target.value })}
                  className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-500 ml-1">
                  {t('accounting:clientsInvoices.client')}
                </label>
                <CustomSelect
                  options={activeClients.map((c) => ({ id: c.id, name: c.name }))}
                  value={formData.clientId || ''}
                  onChange={(val) => handleClientChange(val as string)}
                  placeholder={t('accounting:clientsInvoices.allClients')}
                  searchable={true}
                  className={errors.clientId ? 'border-red-300' : ''}
                />
                {errors.clientId && (
                  <p className="text-red-500 text-[10px] font-bold ml-1">{errors.clientId}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-500 ml-1">
                  {t('accounting:clientsInvoices.status')}
                </label>
                <CustomSelect
                  options={statusOptions}
                  value={formData.status || 'draft'}
                  onChange={(val) => setFormData({ ...formData, status: val as Invoice['status'] })}
                  searchable={false}
                />
              </div>
            </div>

            {/* Line Items */}
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h4 className="text-xs font-black text-praetor uppercase tracking-widest flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-praetor"></span>
                  {t('accounting:clientsInvoices.items')}
                </h4>
                <button
                  type="button"
                  onClick={addItemRow}
                  className="text-xs font-bold text-praetor hover:text-slate-700 flex items-center gap-1"
                >
                  <i className="fa-solid fa-plus"></i> {t('accounting:clientsInvoices.addItem')}
                </button>
              </div>
              {errors.items && (
                <p className="text-red-500 text-[10px] font-bold ml-1 -mt-2">{errors.items}</p>
              )}

              {formData.items && formData.items.length > 0 && (
                <div className="grid grid-cols-12 gap-2 px-3 mb-1">
                  <div className="col-span-12 md:col-span-4 text-[10px] font-black text-slate-400 uppercase tracking-wider ml-1">
                    {t('accounting:clientsInvoices.items')} / {t('common:labels.product')}
                  </div>
                  <div className="hidden md:block md:col-span-1 text-[10px] font-black text-slate-400 uppercase tracking-wider">
                    {t('common:labels.quantity')}
                  </div>
                  <div className="hidden md:block md:col-span-2 text-[10px] font-black text-slate-400 uppercase tracking-wider">
                    {t('common:labels.price')}
                  </div>
                  <div className="hidden md:block md:col-span-1 text-[10px] font-black text-slate-400 uppercase tracking-wider">
                    {t('accounting:clientsInvoices.tax')}%
                  </div>
                  <div className="hidden md:block md:col-span-1 text-[10px] font-black text-slate-400 uppercase tracking-wider">
                    {t('common:labels.discount')}%
                  </div>
                  <div className="hidden md:block md:col-span-2 text-[10px] font-black text-slate-400 uppercase tracking-wider text-right pr-2">
                    {t('accounting:clientsInvoices.total')}
                  </div>
                  <div className="hidden md:block md:col-span-1"></div>
                </div>
              )}

              <div className="space-y-3">
                {formData.items?.map((item, index) => (
                  <div
                    key={item.id}
                    className="flex gap-2 items-start bg-slate-50 p-3 rounded-xl border border-slate-100"
                  >
                    <div className="flex-1 grid grid-cols-12 gap-2">
                      <div className="col-span-4 space-y-2">
                        <CustomSelect
                          options={[
                            { id: '', name: t('accounting:clientsInvoices.customItem') },
                            ...activeProducts.map((p) => ({ id: p.id, name: p.name })),
                          ]}
                          value={item.productId || ''}
                          onChange={(val) => updateItemRow(index, 'productId', val as string)}
                          placeholder={t('accounting:clientsInvoices.selectProductPlaceholder')}
                          searchable={true}
                          buttonClassName="px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs"
                        />
                        <input
                          type="text"
                          required
                          placeholder={t('accounting:clientsInvoices.descriptionPlaceholder')}
                          value={item.description}
                          onChange={(e) => updateItemRow(index, 'description', e.target.value)}
                          className="w-full text-sm px-3 py-2 bg-white border border-slate-200 rounded-lg outline-none"
                        />
                      </div>
                      <div className="col-span-1">
                        <ValidatedNumberInput
                          min="0"
                          step="0.01"
                          required
                          value={item.quantity}
                          onValueChange={(value) => {
                            const parsed = parseFloat(value);
                            updateItemRow(
                              index,
                              'quantity',
                              value === '' || Number.isNaN(parsed) ? 0 : parsed,
                            );
                          }}
                          className="w-full text-sm px-3 py-2 bg-white border border-slate-200 rounded-lg outline-none"
                        />
                      </div>
                      <div className="col-span-2">
                        <ValidatedNumberInput
                          min="0"
                          step="0.01"
                          required
                          value={item.unitPrice}
                          onValueChange={(value) => {
                            const parsed = parseFloat(value);
                            updateItemRow(
                              index,
                              'unitPrice',
                              value === '' || Number.isNaN(parsed) ? 0 : parsed,
                            );
                          }}
                          className="w-full text-sm px-3 py-2 bg-white border border-slate-200 rounded-lg outline-none"
                        />
                      </div>
                      <div className="col-span-1">
                        <ValidatedNumberInput
                          min="0"
                          max="100"
                          value={item.taxRate}
                          onValueChange={(value) => {
                            const parsed = parseFloat(value);
                            updateItemRow(
                              index,
                              'taxRate',
                              value === '' || Number.isNaN(parsed) ? 0 : parsed,
                            );
                          }}
                          className="w-full text-sm px-3 py-2 bg-white border border-slate-200 rounded-lg outline-none"
                        />
                      </div>
                      <div className="col-span-1">
                        <ValidatedNumberInput
                          min="0"
                          max="100"
                          value={item.discount || 0}
                          onValueChange={(value) => {
                            const parsed = parseFloat(value);
                            updateItemRow(
                              index,
                              'discount',
                              value === '' || Number.isNaN(parsed) ? 0 : parsed,
                            );
                          }}
                          className="w-full text-sm px-3 py-2 bg-white border border-slate-200 rounded-lg outline-none"
                        />
                      </div>
                      <div className="col-span-2 flex items-center justify-end font-bold text-slate-600 text-sm">
                        {(
                          item.quantity *
                          item.unitPrice *
                          (1 - (item.discount || 0) / 100)
                        ).toFixed(2)}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeItemRow(index)}
                      className="col-span-1 p-2 text-slate-400 hover:text-red-600 rounded-lg"
                    >
                      <i className="fa-solid fa-trash-can"></i>
                    </button>
                  </div>
                ))}
                {(!formData.items || formData.items.length === 0) && (
                  <div className="text-center py-8 text-slate-400 text-sm border-2 border-dashed border-slate-200 rounded-xl">
                    {t('accounting:clientsInvoices.noItems')}
                  </div>
                )}
              </div>
            </div>

            {/* Totals */}
            <div className="flex flex-col md:flex-row gap-8 justify-end border-t border-slate-100 pt-6">
              <div className="w-full md:w-1/3 space-y-3">
                <div className="flex justify-between">
                  <span className="text-sm font-bold text-slate-500">
                    {t('accounting:clientsInvoices.subtotal')}
                  </span>
                  <span className="text-sm font-bold text-slate-700">
                    {subtotal.toFixed(2)} {currency}
                  </span>
                </div>
                {Object.entries(taxGroups).map(([rate, amount]) => (
                  <div key={rate} className="flex justify-between text-xs">
                    <span className="font-semibold text-slate-500">
                      {t('accounting:clientsInvoices.vat')} {rate}%
                    </span>
                    <span className="font-semibold text-slate-700">
                      {amount.toFixed(2)} {currency}
                    </span>
                  </div>
                ))}
                <div className="flex justify-between pt-3 border-t border-slate-200">
                  <span className="text-lg font-black text-slate-800">
                    {t('accounting:clientsInvoices.total')}
                  </span>
                  <span className="text-lg font-black text-praetor">
                    {total.toFixed(2)} {currency}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="font-bold text-slate-500">
                    {t('accounting:clientsInvoices.amountPaid')}
                  </span>
                  <span className="font-bold text-emerald-600">
                    {formData.amountPaid?.toFixed(2)} {currency}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="font-bold text-slate-500">
                    {t('accounting:clientsInvoices.balanceDue')}
                  </span>
                  <span className="font-bold text-red-500">
                    {(total - (formData.amountPaid || 0)).toFixed(2)} {currency}
                  </span>
                </div>
              </div>
            </div>

            <div className="pt-6">
              <label className="text-xs font-bold text-slate-500 ml-1">
                {t('accounting:clientsInvoices.notes')}
              </label>
              <textarea
                rows={2}
                value={formData.notes || ''}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                className="w-full text-sm px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none"
                placeholder={t('accounting:clientsInvoices.notesPlaceholder')}
              />
            </div>

            <div className="flex justify-end gap-3 pt-4">
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="px-6 py-3 font-bold text-slate-500 hover:bg-slate-50 rounded-xl"
              >
                {t('common:buttons.cancel')}
              </button>
              <button
                type="submit"
                className="px-8 py-3 bg-praetor text-white font-bold rounded-xl hover:bg-slate-700 shadow-lg shadow-slate-200"
              >
                {t('common:buttons.save')}
              </button>
            </div>
          </form>
        </div>
      </Modal>

      <Modal isOpen={isDeleteConfirmOpen} onClose={() => setIsDeleteConfirmOpen(false)}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden p-6 text-center space-y-4">
          <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto text-red-600">
            <i className="fa-solid fa-triangle-exclamation text-xl"></i>
          </div>
          <h3 className="text-lg font-black text-slate-800">
            {t('accounting:clientsInvoices.deleteConfirm')}?
          </h3>
          <p className="text-sm text-slate-500">
            {t('accounting:clientsInvoices.deleteConfirm')} <b>{invoiceToDelete?.invoiceNumber}</b>?{' '}
            {t('common:messages.unsavedChanges')}
          </p>
          <div className="flex gap-3 pt-2">
            <button
              onClick={() => setIsDeleteConfirmOpen(false)}
              className="flex-1 py-3 font-bold text-slate-500 hover:bg-slate-50 rounded-xl"
            >
              {t('common:buttons.cancel')}
            </button>
            <button
              onClick={handleDelete}
              className="flex-1 py-3 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700"
            >
              {t('common:buttons.delete')}
            </button>
          </div>
        </div>
      </Modal>

      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h2 className="text-2xl font-black text-slate-800">
              {t('accounting:clientsInvoices.title')}
            </h2>
            <p className="text-slate-500 text-sm">{t('accounting:clientsInvoices.subtitle')}</p>
          </div>
          <button
            onClick={openAddModal}
            className="bg-praetor text-white px-5 py-2.5 rounded-xl text-sm font-black shadow-xl shadow-slate-200 transition-all hover:bg-slate-700 active:scale-95 flex items-center gap-2"
          >
            <i className="fa-solid fa-plus"></i> {t('accounting:clientsInvoices.addInvoice')}
          </button>
        </div>
      </div>

      {/* Main Table with all invoices and TableFilter */}
      <StandardTable
        title={t('accounting:clientsInvoices.allInvoices')}
        data={invoices}
        columns={columns}
        defaultRowsPerPage={10}
        containerClassName="overflow-visible"
        onRowClick={(row: Invoice) => openEditModal(row)}
      />
    </div>
  );
};

export default ClientsInvoicesView;
