import type React from 'react';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Product, Supplier, SupplierInvoice, SupplierInvoiceItem } from '../../types';
import {
  addDaysToDateOnly,
  formatDateOnlyForLocale,
  getLocalDateString,
  normalizeDateOnlyString,
} from '../../utils/date';
import CostSummaryPanel from '../shared/CostSummaryPanel';
import CustomSelect from '../shared/CustomSelect';
import Modal from '../shared/Modal';
import StandardTable from '../shared/StandardTable';
import StatusBadge, { type StatusType } from '../shared/StatusBadge';
import Tooltip from '../shared/Tooltip';
import ValidatedNumberInput from '../shared/ValidatedNumberInput';

const statusLabelMap: Record<string, string> = {
  draft: 'accounting:supplierInvoices.statusDraft',
  sent: 'accounting:supplierInvoices.statusSent',
  paid: 'accounting:supplierInvoices.statusPaid',
  overdue: 'accounting:supplierInvoices.statusOverdue',
  cancelled: 'accounting:supplierInvoices.statusCancelled',
};

const getStatusOptions = (t: (key: string, options?: Record<string, unknown>) => string) =>
  Object.entries(statusLabelMap).map(([id, key]) => ({ id, name: t(key) }));

const getStatusLabel = (
  status: SupplierInvoice['status'],
  t: (key: string, options?: Record<string, unknown>) => string,
) => t(statusLabelMap[status] ?? String(status));

const calculateTotals = (items: SupplierInvoiceItem[]) => {
  let subtotal = 0;

  items.forEach((item) => {
    const lineSubtotal = Number(item.quantity ?? 0) * Number(item.unitPrice ?? 0);
    const lineDiscount = (lineSubtotal * Number(item.discount ?? 0)) / 100;
    const lineNet = lineSubtotal - lineDiscount;
    subtotal += lineNet;
  });

  return { subtotal, total: subtotal };
};

export interface SupplierInvoicesViewProps {
  invoices: SupplierInvoice[];
  suppliers: Supplier[];
  products: Product[];
  onUpdateInvoice: (id: string, updates: Partial<SupplierInvoice>) => void | Promise<void>;
  onDeleteInvoice: (id: string) => void | Promise<void>;
  currency: string;
}

const SupplierInvoicesView: React.FC<SupplierInvoicesViewProps> = ({
  invoices,
  suppliers,
  products,
  onUpdateInvoice,
  onDeleteInvoice,
  currency,
}) => {
  const { t } = useTranslation(['accounting', 'sales', 'common', 'crm']);
  const statusOptions = useMemo(() => getStatusOptions(t), [t]);
  const activeSuppliers = useMemo(
    () => suppliers.filter((supplier) => !supplier.isDisabled),
    [suppliers],
  );
  const activeProducts = useMemo(
    () => products.filter((product) => !product.isDisabled),
    [products],
  );
  const productOptions = useMemo(
    () => activeProducts.map((product) => ({ id: product.id, name: product.name })),
    [activeProducts],
  );
  const supplierOptions = useMemo(
    () => activeSuppliers.map((supplier) => ({ id: supplier.id, name: supplier.name })),
    [activeSuppliers],
  );

  const [editingInvoice, setEditingInvoice] = useState<SupplierInvoice | null>(null);
  const [invoiceToDelete, setInvoiceToDelete] = useState<SupplierInvoice | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [formData, setFormData] = useState<Partial<SupplierInvoice>>({
    linkedSaleId: '',
    supplierId: '',
    supplierName: '',
    id: '',
    issueDate: getLocalDateString(),
    dueDate: addDaysToDateOnly(getLocalDateString(), 30),
    status: 'draft',
    subtotal: 0,
    total: 0,
    amountPaid: 0,
    notes: '',
    items: [],
  });

  const openEditModal = useCallback((invoice: SupplierInvoice) => {
    setEditingInvoice(invoice);
    setFormData({
      ...invoice,
      issueDate: invoice.issueDate ? normalizeDateOnlyString(invoice.issueDate) : '',
      dueDate: invoice.dueDate ? normalizeDateOnlyString(invoice.dueDate) : '',
      items: invoice.items.map((item) => ({ ...item })),
    });
    setIsModalOpen(true);
  }, []);

  const confirmDelete = useCallback((invoice: SupplierInvoice) => {
    setInvoiceToDelete(invoice);
    setIsDeleteConfirmOpen(true);
  }, []);

  const handleDelete = useCallback(async () => {
    if (!invoiceToDelete) return;
    await onDeleteInvoice(invoiceToDelete.id);
    setIsDeleteConfirmOpen(false);
    setInvoiceToDelete(null);
  }, [invoiceToDelete, onDeleteInvoice]);

  const updateItem = useCallback(
    (index: number, field: keyof SupplierInvoiceItem, value: string | number) => {
      setFormData((prev) => {
        const items = [...(prev.items || [])];
        const nextItem = { ...items[index], [field]: value };

        if (field === 'productId') {
          const product = products.find((item) => item.id === value);
          if (product) {
            nextItem.description = product.name;
            nextItem.unitPrice = Number(product.costo);
          }
        }

        items[index] = nextItem;
        const totals = calculateTotals(items);
        return { ...prev, items, ...totals };
      });
    },
    [products],
  );

  const removeItem = useCallback((index: number) => {
    setFormData((prev) => ({
      ...prev,
      items: (prev.items || []).filter((_, i) => i !== index),
    }));
  }, []);

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (!editingInvoice) return;

      const totals = calculateTotals(formData.items || []);
      await onUpdateInvoice(editingInvoice.id, {
        ...formData,
        ...totals,
        amountPaid: Number(formData.amountPaid ?? 0),
        items: (formData.items || []).map((item) => ({
          ...item,
          quantity: Number(item.quantity ?? 0),
          unitPrice: Number(item.unitPrice ?? 0),
          discount: Number(item.discount ?? 0),
        })),
      });

      setIsModalOpen(false);
    },
    [editingInvoice, formData, onUpdateInvoice],
  );

  const totals = useMemo(() => calculateTotals(formData.items || []), [formData.items]);
  const balanceDue = Number(totals.total) - Number(formData.amountPaid || 0);
  const totalDiscount = useMemo(
    () =>
      (formData.items || []).reduce((sum, item) => {
        const lineSubtotal = Number(item.quantity ?? 0) * Number(item.unitPrice ?? 0);
        return sum + (lineSubtotal * Number(item.discount ?? 0)) / 100;
      }, 0),
    [formData.items],
  );
  const grossSubtotal = totals.subtotal + totalDiscount;

  const columns = useMemo(
    () => [
      {
        header: t('accounting:supplierInvoices.invoiceNumber'),
        id: 'id',
        accessorFn: (row: SupplierInvoice) => row.id,
        cell: ({ row }: { row: SupplierInvoice }) => (
          <span className="font-bold text-slate-700">{row.id}</span>
        ),
      },
      {
        header: t('accounting:supplierInvoices.supplier'),
        id: 'supplierName',
        accessorFn: (row: SupplierInvoice) => row.supplierName,
        cell: ({ row }: { row: SupplierInvoice }) => {
          const isMuted = row.status === 'paid' || row.status === 'cancelled';

          return (
            <span className={`font-bold ${isMuted ? 'text-slate-400' : 'text-slate-800'}`}>
              {row.supplierName}
            </span>
          );
        },
      },
      {
        header: t('common:labels.date'),
        id: 'issueDate',
        accessorFn: (row: SupplierInvoice) => formatDateOnlyForLocale(row.issueDate),
        cell: ({ row }: { row: SupplierInvoice }) => (
          <span className="text-sm text-slate-600">{formatDateOnlyForLocale(row.issueDate)}</span>
        ),
      },
      {
        header: t('accounting:supplierInvoices.dueDate'),
        id: 'dueDate',
        accessorFn: (row: SupplierInvoice) => formatDateOnlyForLocale(row.dueDate),
        cell: ({ row }: { row: SupplierInvoice }) => (
          <span className="text-sm text-slate-600">{formatDateOnlyForLocale(row.dueDate)}</span>
        ),
      },
      {
        header: t('common:labels.amount'),
        id: 'invoiceTotal',
        accessorFn: (row: SupplierInvoice) => Number(row.total),
        cell: ({ row }: { row: SupplierInvoice }) => (
          <span className="font-bold text-slate-700">
            {Number(row.total).toFixed(2)} {currency}
          </span>
        ),
        filterFormat: (value: unknown) => Number(value).toFixed(2),
      },
      {
        header: t('accounting:supplierInvoices.amountPaid'),
        id: 'amountPaid',
        accessorFn: (row: SupplierInvoice) => Number(row.amountPaid),
        cell: ({ row }: { row: SupplierInvoice }) => (
          <span className="font-bold text-emerald-600">
            {(Number(row.amountPaid) ?? 0).toFixed(2)} {currency}
          </span>
        ),
        filterFormat: (value: unknown) => Number(value).toFixed(2),
      },
      {
        header: t('accounting:supplierInvoices.balance'),
        id: 'balance',
        accessorFn: (row: SupplierInvoice) => Number(row.total) - Number(row.amountPaid || 0),
        cell: ({ row }: { row: SupplierInvoice }) => {
          const balance = Number(row.total) - Number(row.amountPaid || 0);
          return (
            <span className={`font-bold ${balance > 0 ? 'text-red-500' : 'text-emerald-600'}`}>
              {balance.toFixed(2)} {currency}
            </span>
          );
        },
        filterFormat: (value: unknown) => Number(value).toFixed(2),
      },
      {
        header: t('accounting:supplierInvoices.status'),
        id: 'invoiceStatus',
        accessorFn: (row: SupplierInvoice) => getStatusLabel(row.status, t),
        className: 'whitespace-nowrap',
        headerClassName: 'min-w-[9rem]',
        cell: ({ row }: { row: SupplierInvoice }) => (
          <div className={row.status === 'paid' || row.status === 'cancelled' ? 'opacity-60' : ''}>
            <StatusBadge type={row.status as StatusType} label={getStatusLabel(row.status, t)} />
          </div>
        ),
      },
      {
        header: t('common:common.more'),
        id: 'actions',
        className: 'whitespace-nowrap',
        headerClassName: 'min-w-[8rem]',
        disableSorting: true,
        disableFiltering: true,
        align: 'right' as const,
        cell: ({ row }: { row: SupplierInvoice }) => (
          <div className="flex justify-end gap-2">
            <Tooltip label={t('common:buttons.edit')}>
              {() => (
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    openEditModal(row);
                  }}
                  className="rounded-lg p-2 text-slate-400 transition-all hover:bg-slate-100 hover:text-praetor"
                >
                  <i className="fa-solid fa-pen-to-square"></i>
                </button>
              )}
            </Tooltip>
            <Tooltip label={t('common:buttons.delete')}>
              {() => (
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    confirmDelete(row);
                  }}
                  className="rounded-lg p-2 text-slate-400 transition-all hover:bg-red-50 hover:text-red-600"
                >
                  <i className="fa-solid fa-trash-can"></i>
                </button>
              )}
            </Tooltip>
          </div>
        ),
      },
    ],
    [confirmDelete, currency, openEditModal, t],
  );

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)}>
        <div className="flex max-h-[90vh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl animate-in zoom-in duration-200">
          <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/50 p-6">
            <h3 className="flex items-center gap-3 text-xl font-black text-slate-800">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-praetor">
                <i className={`fa-solid ${editingInvoice ? 'fa-pen-to-square' : 'fa-plus'}`}></i>
              </div>
              {editingInvoice
                ? t('accounting:supplierInvoices.editInvoice')
                : t('accounting:supplierInvoices.addInvoice')}
            </h3>
            <button
              onClick={() => setIsModalOpen(false)}
              className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-400 transition-colors hover:bg-slate-100"
            >
              <i className="fa-solid fa-xmark text-lg"></i>
            </button>
          </div>

          <form onSubmit={handleSubmit} className="flex-1 space-y-4 overflow-y-auto p-8">
            <div className="space-y-2">
              <h4 className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-praetor">
                <span className="h-1.5 w-1.5 rounded-full bg-praetor"></span>
                {t('accounting:supplierInvoices.invoiceDetails')}
              </h4>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="space-y-1.5">
                  <label className="ml-1 text-xs font-bold text-slate-500">
                    {t('accounting:supplierInvoices.supplier')}
                  </label>
                  <CustomSelect
                    options={supplierOptions}
                    value={formData.supplierId || ''}
                    onChange={(value) => {
                      const supplier = suppliers.find((item) => item.id === value);
                      setFormData((prev) => ({
                        ...prev,
                        supplierId: value as string,
                        supplierName: supplier?.name || '',
                      }));
                    }}
                    searchable={true}
                    placeholder={t('accounting:supplierInvoices.selectSupplier')}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="ml-1 text-xs font-bold text-slate-500">
                    {t('accounting:supplierInvoices.invoiceNumber')}
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.id || ''}
                    onChange={(event) =>
                      setFormData((prev) => ({ ...prev, id: event.target.value }))
                    }
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-praetor"
                    placeholder="INV-XXXX"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="ml-1 text-xs font-bold text-slate-500">
                    {t('accounting:supplierInvoices.issueDate')}
                  </label>
                  <input
                    type="date"
                    required
                    value={formData.issueDate || ''}
                    onChange={(event) =>
                      setFormData((prev) => ({ ...prev, issueDate: event.target.value }))
                    }
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-praetor"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="ml-1 text-xs font-bold text-slate-500">
                    {t('accounting:supplierInvoices.dueDate')}
                  </label>
                  <input
                    type="date"
                    required
                    value={formData.dueDate || ''}
                    onChange={(event) =>
                      setFormData((prev) => ({ ...prev, dueDate: event.target.value }))
                    }
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-praetor"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="space-y-1.5">
                  <label className="ml-1 text-xs font-bold text-slate-500">
                    {t('accounting:supplierInvoices.status')}
                  </label>
                  <CustomSelect
                    options={statusOptions}
                    value={formData.status || 'draft'}
                    onChange={(value) =>
                      setFormData((prev) => ({
                        ...prev,
                        status: value as SupplierInvoice['status'],
                      }))
                    }
                    searchable={false}
                  />
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-praetor">
                  <span className="h-1.5 w-1.5 rounded-full bg-praetor"></span>
                  {t('accounting:supplierInvoices.items')}
                </h4>
              </div>

              {(formData.items || []).length > 0 && (
                <div className="hidden lg:flex gap-2 px-3 mb-1 items-center">
                  <div className="grid flex-1 grid-cols-12 gap-2 text-[10px] font-black uppercase tracking-wider text-slate-400">
                    <div className="col-span-2 ml-1">{t('crm:quotes.productsServices')}</div>
                    <div className="col-span-3">
                      {t('accounting:supplierInvoices.descriptionPlaceholder')}
                    </div>
                    <div className="col-span-1">{t('common:labels.quantity')}</div>
                    <div className="col-span-2">
                      {t('crm:internalListing.salePrice')} ({currency})
                    </div>
                    <div className="col-span-1">{t('accounting:supplierOrders.discount')}</div>
                    <div className="col-span-2 pr-2 text-right">{t('common:labels.total')}</div>
                  </div>
                  <div className="w-8 shrink-0"></div>
                </div>
              )}

              {(formData.items || []).length > 0 ? (
                <div className="space-y-3">
                  {formData.items?.map((item, index) => {
                    const lineSubtotal = Number(item.quantity ?? 0) * Number(item.unitPrice ?? 0);
                    const lineDiscount = (lineSubtotal * Number(item.discount ?? 0)) / 100;
                    const lineTotal = lineSubtotal - lineDiscount;

                    return (
                      <div
                        key={item.id}
                        className="rounded-xl border border-slate-100 bg-slate-50 p-3 space-y-3"
                      >
                        <div className="lg:hidden space-y-2">
                          <CustomSelect
                            options={productOptions}
                            value={item.productId || ''}
                            onChange={(value) => updateItem(index, 'productId', value as string)}
                            searchable={true}
                            buttonClassName="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                          />
                          <input
                            type="text"
                            value={item.description}
                            placeholder={t('accounting:supplierInvoices.descriptionPlaceholder')}
                            onChange={(event) =>
                              updateItem(index, 'description', event.target.value)
                            }
                            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none"
                          />
                          <div className="grid grid-cols-2 gap-2">
                            <div className="space-y-1">
                              <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                                {t('common:labels.quantity')}
                              </label>
                              <ValidatedNumberInput
                                value={item.quantity}
                                onValueChange={(value) =>
                                  updateItem(index, 'quantity', value === '' ? 0 : Number(value))
                                }
                                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none text-center"
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                                {t('crm:internalListing.salePrice')}
                              </label>
                              <ValidatedNumberInput
                                value={item.unitPrice}
                                formatDecimals={2}
                                onValueChange={(value) =>
                                  updateItem(index, 'unitPrice', value === '' ? 0 : Number(value))
                                }
                                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none text-center"
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                                {t('accounting:supplierOrders.discount')}
                              </label>
                              <ValidatedNumberInput
                                value={item.discount || 0}
                                formatDecimals={2}
                                onValueChange={(value) =>
                                  updateItem(index, 'discount', value === '' ? 0 : Number(value))
                                }
                                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none text-center"
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                                {t('common:labels.total')}
                              </label>
                              <div className="flex items-center justify-end whitespace-nowrap px-3 py-2 text-sm font-bold text-slate-700">
                                {lineTotal.toFixed(2)} {currency}
                              </div>
                            </div>
                          </div>
                          <div className="flex justify-end">
                            <button
                              type="button"
                              onClick={() => removeItem(index)}
                              className="w-10 h-10 flex items-center justify-center text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                            >
                              <i className="fa-solid fa-trash-can"></i>
                            </button>
                          </div>
                        </div>
                        <div className="hidden lg:flex items-start gap-2">
                          <div className="grid flex-1 grid-cols-12 gap-2">
                            <div className="lg:col-span-2 min-w-0">
                              <CustomSelect
                                options={productOptions}
                                value={item.productId || ''}
                                onChange={(value) =>
                                  updateItem(index, 'productId', value as string)
                                }
                                searchable={true}
                                buttonClassName="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                              />
                            </div>
                            <div className="lg:col-span-3">
                              <input
                                type="text"
                                value={item.description}
                                onChange={(event) =>
                                  updateItem(index, 'description', event.target.value)
                                }
                                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none"
                              />
                            </div>
                            <div className="lg:col-span-1">
                              <ValidatedNumberInput
                                value={item.quantity}
                                onValueChange={(value) =>
                                  updateItem(index, 'quantity', value === '' ? 0 : Number(value))
                                }
                                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none"
                              />
                            </div>
                            <div className="lg:col-span-2">
                              <ValidatedNumberInput
                                value={item.unitPrice}
                                formatDecimals={2}
                                onValueChange={(value) =>
                                  updateItem(index, 'unitPrice', value === '' ? 0 : Number(value))
                                }
                                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none"
                              />
                            </div>
                            <div className="lg:col-span-1">
                              <ValidatedNumberInput
                                value={item.discount || 0}
                                formatDecimals={2}
                                onValueChange={(value) =>
                                  updateItem(index, 'discount', value === '' ? 0 : Number(value))
                                }
                                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none"
                              />
                            </div>
                            <div className="lg:col-span-2 flex items-center justify-end whitespace-nowrap px-3 py-2 text-sm font-bold text-slate-700">
                              {lineTotal.toFixed(2)} {currency}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => removeItem(index)}
                            className="w-8 h-10 flex items-center justify-center text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all shrink-0"
                          >
                            <i className="fa-solid fa-trash-can"></i>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-xl border-2 border-dashed border-slate-200 py-8 text-center text-sm text-slate-400">
                  {t('accounting:supplierInvoices.noItems')}
                </div>
              )}
            </div>

            <div className="flex flex-col gap-4 border-t border-slate-100 pt-4 md:flex-row">
              <div className="md:w-2/3 space-y-1.5">
                <label className="ml-1 text-xs font-bold text-slate-500">
                  {t('accounting:supplierInvoices.notes')}
                </label>
                <textarea
                  rows={4}
                  value={formData.notes || ''}
                  onChange={(event) =>
                    setFormData((prev) => ({ ...prev, notes: event.target.value }))
                  }
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none resize-none focus:ring-2 focus:ring-praetor transition-all"
                  placeholder={t('accounting:supplierInvoices.notesPlaceholder')}
                />
              </div>

              <div className="md:w-1/3">
                <CostSummaryPanel
                  currency={currency}
                  subtotal={grossSubtotal}
                  total={totals.total}
                  subtotalLabel={t('accounting:supplierInvoices.subtotal')}
                  totalLabel={t('accounting:supplierInvoices.total')}
                  discountRow={
                    totalDiscount > 0
                      ? {
                          label: t('accounting:supplierInvoices.totalDiscount'),
                          amount: totalDiscount,
                        }
                      : undefined
                  }
                  amountPaid={{
                    label: t('accounting:supplierInvoices.amountPaid'),
                    value: formData.amountPaid || 0,
                    onChange: (value) =>
                      setFormData((prev) => ({
                        ...prev,
                        amountPaid: value === '' ? 0 : Number(value),
                      })),
                  }}
                  balanceDue={{
                    label: t('accounting:supplierInvoices.balanceDue'),
                    amount: balanceDue,
                    colorClass: balanceDue > 0 ? 'text-red-500' : 'text-emerald-600',
                  }}
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-4">
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="rounded-xl px-6 py-3 font-bold text-slate-500 hover:bg-slate-50"
              >
                {t('common:buttons.cancel')}
              </button>
              <button
                type="submit"
                className="rounded-xl bg-praetor px-8 py-3 font-bold text-white shadow-lg shadow-slate-200 transition-all hover:bg-slate-700 active:scale-95"
              >
                {editingInvoice ? t('common:buttons.update') : t('common:buttons.save')}
              </button>
            </div>
          </form>
        </div>
      </Modal>

      <Modal isOpen={isDeleteConfirmOpen} onClose={() => setIsDeleteConfirmOpen(false)}>
        <div className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-2xl animate-in zoom-in duration-200">
          <div className="space-y-4 p-6 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600">
              <i className="fa-solid fa-triangle-exclamation text-xl"></i>
            </div>
            <div>
              <h3 className="text-lg font-black text-slate-800">
                {t('accounting:supplierInvoices.deleteTitle')}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-500">
                {invoiceToDelete?.supplierName} · {invoiceToDelete?.id}
              </p>
            </div>
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setIsDeleteConfirmOpen(false)}
                className="flex-1 rounded-xl py-3 text-sm font-bold text-slate-500 transition-colors hover:bg-slate-50"
              >
                {t('common:buttons.cancel')}
              </button>
              <button
                onClick={() => {
                  void handleDelete();
                }}
                className="flex-1 rounded-xl bg-red-600 py-3 text-sm font-bold text-white shadow-lg shadow-red-200 transition-all hover:bg-red-700 active:scale-95"
              >
                {t('common:buttons.delete')}
              </button>
            </div>
          </div>
        </div>
      </Modal>

      <div className="space-y-4">
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-2xl font-black text-slate-800">
              {t('accounting:supplierInvoices.title')}
            </h2>
            <p className="text-sm text-slate-500">{t('accounting:supplierInvoices.subtitle')}</p>
          </div>
        </div>
      </div>

      <StandardTable<SupplierInvoice>
        title={t('accounting:supplierInvoices.title')}
        data={invoices}
        columns={columns}
        defaultRowsPerPage={10}
        containerClassName="overflow-visible"
        rowClassName={(row: SupplierInvoice) =>
          row.status === 'paid' || row.status === 'cancelled'
            ? 'bg-slate-50 text-slate-400'
            : 'hover:bg-slate-50/50'
        }
        onRowClick={(row: SupplierInvoice) => openEditModal(row)}
      />
    </div>
  );
};

export default SupplierInvoicesView;
