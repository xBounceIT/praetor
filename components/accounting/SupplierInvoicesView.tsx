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
import { roundToTwoDecimals } from '../../utils/numbers';
import CustomSelect from '../shared/CustomSelect';
import Modal from '../shared/Modal';
import StandardTable from '../shared/StandardTable';
import StatusBadge, { type StatusType } from '../shared/StatusBadge';
import Tooltip from '../shared/Tooltip';
import ValidatedNumberInput from '../shared/ValidatedNumberInput';

const getStatusOptions = (t: (key: string, options?: Record<string, unknown>) => string) => [
  { id: 'draft', name: t('accounting:clientsInvoices.statusDraft') },
  { id: 'sent', name: t('accounting:clientsInvoices.statusSent') },
  { id: 'paid', name: t('accounting:clientsInvoices.statusPaid') },
  { id: 'overdue', name: t('accounting:clientsInvoices.statusOverdue') },
  { id: 'cancelled', name: t('accounting:clientsInvoices.statusCancelled') },
];

const getStatusLabel = (
  status: SupplierInvoice['status'],
  t: (key: string, options?: Record<string, unknown>) => string,
) => {
  if (status === 'sent') return t('accounting:clientsInvoices.statusSent');
  if (status === 'paid') return t('accounting:clientsInvoices.statusPaid');
  if (status === 'overdue') return t('accounting:clientsInvoices.statusOverdue');
  if (status === 'cancelled') return t('accounting:clientsInvoices.statusCancelled');
  return t('accounting:clientsInvoices.statusDraft');
};

const calculateTotals = (items: SupplierInvoiceItem[]) => {
  let subtotal = 0;
  let taxAmount = 0;

  items.forEach((item) => {
    const lineSubtotal = Number(item.quantity ?? 0) * Number(item.unitPrice ?? 0);
    const lineDiscount = (lineSubtotal * Number(item.discount ?? 0)) / 100;
    const lineNet = lineSubtotal - lineDiscount;
    subtotal += lineNet;
    taxAmount += lineNet * (Number(item.taxRate ?? 0) / 100);
  });

  return { subtotal, taxAmount, total: subtotal + taxAmount };
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
  const { t } = useTranslation(['accounting', 'common', 'crm']);
  const statusOptions = useMemo(() => getStatusOptions(t), [t]);
  const activeSuppliers = useMemo(
    () => suppliers.filter((supplier) => !supplier.isDisabled),
    [suppliers],
  );
  const activeProducts = useMemo(
    () => products.filter((product) => !product.isDisabled),
    [products],
  );

  const [editingInvoice, setEditingInvoice] = useState<SupplierInvoice | null>(null);
  const [invoiceToDelete, setInvoiceToDelete] = useState<SupplierInvoice | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [formData, setFormData] = useState<Partial<SupplierInvoice>>({
    linkedSaleId: '',
    supplierId: '',
    supplierName: '',
    invoiceNumber: '',
    issueDate: getLocalDateString(),
    dueDate: addDaysToDateOnly(getLocalDateString(), 30),
    status: 'draft',
    subtotal: 0,
    taxAmount: 0,
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
            nextItem.taxRate = Number(product.taxRate ?? 0);
          }
        }

        items[index] = nextItem;
        const totals = calculateTotals(items);
        return { ...prev, items, ...totals };
      });
    },
    [products],
  );

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (!editingInvoice) return;

      const totals = calculateTotals(formData.items || []);
      await onUpdateInvoice(editingInvoice.id, {
        ...formData,
        ...totals,
        amountPaid: roundToTwoDecimals(Number(formData.amountPaid ?? 0)),
        items: (formData.items || []).map((item) => ({
          ...item,
          quantity: roundToTwoDecimals(Number(item.quantity ?? 0)),
          unitPrice: roundToTwoDecimals(Number(item.unitPrice ?? 0)),
          taxRate: roundToTwoDecimals(Number(item.taxRate ?? 0)),
          discount: roundToTwoDecimals(Number(item.discount ?? 0)),
        })),
      });

      setIsModalOpen(false);
    },
    [editingInvoice, formData, onUpdateInvoice],
  );

  const totals = useMemo(() => calculateTotals(formData.items || []), [formData.items]);
  const balanceDue = roundToTwoDecimals(Number(totals.total) - Number(formData.amountPaid || 0));
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
        id: 'invoiceNumber',
        accessorFn: (row: SupplierInvoice) => row.invoiceNumber,
        cell: ({ row }: { row: SupplierInvoice }) => (
          <span className="font-bold text-slate-700">{row.invoiceNumber}</span>
        ),
      },
      {
        header: t('accounting:supplierInvoices.supplier'),
        id: 'supplierName',
        accessorFn: (row: SupplierInvoice) => row.supplierName,
        cell: ({ row }: { row: SupplierInvoice }) => {
          const isMuted = row.status === 'paid' || row.status === 'cancelled';

          return (
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-praetor text-sm">
                <i className="fa-solid fa-file-invoice-dollar"></i>
              </div>
              <div>
                <div className={`font-bold ${isMuted ? 'text-slate-400' : 'text-slate-800'}`}>
                  {row.supplierName}
                </div>
              </div>
            </div>
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
        header: t('accounting:clientsInvoices.dueDate'),
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
        header: t('accounting:clientsInvoices.amountPaid'),
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
        header: t('accounting:clientsInvoices.balance'),
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
        cell: ({ row }: { row: SupplierInvoice }) => (
          <div className={row.status === 'paid' || row.status === 'cancelled' ? 'opacity-60' : ''}>
            <StatusBadge type={row.status as StatusType} label={getStatusLabel(row.status, t)} />
          </div>
        ),
      },
      {
        header: t('common:common.more'),
        id: 'actions',
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
        <div className="flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl animate-in zoom-in duration-200">
          <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/50 p-6">
            <h3 className="flex items-center gap-3 text-xl font-black text-slate-800">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-praetor">
                <i className={`fa-solid ${editingInvoice ? 'fa-pen-to-square' : 'fa-plus'}`}></i>
              </div>
              {editingInvoice
                ? t('accounting:supplierInvoices.editInvoice', {
                    defaultValue: 'Edit Supplier Invoice',
                  })
                : t('accounting:supplierInvoices.addInvoice', {
                    defaultValue: 'Add Supplier Invoice',
                  })}
            </h3>
            <button
              onClick={() => setIsModalOpen(false)}
              className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-400 transition-colors hover:bg-slate-100"
            >
              <i className="fa-solid fa-xmark text-lg"></i>
            </button>
          </div>

          <form onSubmit={handleSubmit} className="flex-1 space-y-8 overflow-y-auto p-8">
            <div className="space-y-4">
              <h4 className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-praetor">
                <span className="h-1.5 w-1.5 rounded-full bg-praetor"></span>
                {t('accounting:clientsInvoices.invoiceDetails')}
              </h4>
              <div className="space-y-6">
                <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
                  <div className="space-y-1.5">
                    <label className="ml-1 text-xs font-bold text-slate-500">
                      {t('accounting:supplierInvoices.invoiceNumber')}
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.invoiceNumber || ''}
                      onChange={(event) =>
                        setFormData((prev) => ({ ...prev, invoiceNumber: event.target.value }))
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

                <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <label className="ml-1 text-xs font-bold text-slate-500">
                      {t('accounting:supplierInvoices.supplier')}
                    </label>
                    <CustomSelect
                      options={activeSuppliers.map((supplier) => ({
                        id: supplier.id,
                        name: supplier.name,
                      }))}
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
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-praetor">
                  <span className="h-1.5 w-1.5 rounded-full bg-praetor"></span>
                  {t('accounting:clientsInvoices.items')}
                </h4>
              </div>

              {(formData.items || []).length > 0 && (
                <div className="mb-1 hidden items-center gap-2 px-3 md:flex">
                  <div className="grid flex-1 grid-cols-12 gap-2 text-[10px] font-black uppercase tracking-wider text-slate-400">
                    <div className="col-span-2 ml-1">{t('crm:quotes.productsServices')}</div>
                    <div className="col-span-3">
                      {t('accounting:clientsInvoices.descriptionPlaceholder')}
                    </div>
                    <div className="col-span-1">{t('common:labels.quantity')}</div>
                    <div className="col-span-2">
                      {t('crm:internalListing.salePrice')} ({currency})
                    </div>
                    <div className="col-span-1">{t('accounting:clientsInvoices.vat')}</div>
                    <div className="col-span-1">{t('accounting:supplierOrders.discount')}</div>
                    <div className="col-span-2 pr-2 text-right">{t('common:labels.total')}</div>
                  </div>
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
                        className="rounded-xl border border-slate-100 bg-slate-50 p-3"
                      >
                        <div className="flex items-start gap-2">
                          <div className="grid flex-1 grid-cols-1 gap-2 md:grid-cols-12">
                            <div className="space-y-1 md:col-span-2 min-w-0">
                              <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 md:hidden">
                                {t('crm:quotes.productsServices')}
                              </label>
                              <CustomSelect
                                options={activeProducts.map((product) => ({
                                  id: product.id,
                                  name: product.name,
                                }))}
                                value={item.productId || ''}
                                onChange={(value) =>
                                  updateItem(index, 'productId', value as string)
                                }
                                searchable={true}
                                buttonClassName="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                              />
                            </div>

                            <div className="space-y-1 md:col-span-3">
                              <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 md:hidden">
                                {t('accounting:clientsInvoices.descriptionPlaceholder')}
                              </label>
                              <input
                                type="text"
                                value={item.description}
                                onChange={(event) =>
                                  updateItem(index, 'description', event.target.value)
                                }
                                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none"
                              />
                            </div>

                            <div className="space-y-1 md:col-span-1">
                              <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 md:hidden">
                                {t('crm:quotes.qty')}
                              </label>
                              <ValidatedNumberInput
                                value={item.quantity}
                                onValueChange={(value) =>
                                  updateItem(index, 'quantity', value === '' ? 0 : Number(value))
                                }
                                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none"
                              />
                            </div>

                            <div className="space-y-1 md:col-span-2">
                              <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 md:hidden">
                                {t('crm:internalListing.salePrice')} ({currency})
                              </label>
                              <ValidatedNumberInput
                                value={item.unitPrice}
                                onValueChange={(value) =>
                                  updateItem(index, 'unitPrice', value === '' ? 0 : Number(value))
                                }
                                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none"
                              />
                            </div>

                            <div className="space-y-1 md:col-span-1">
                              <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 md:hidden">
                                {t('accounting:clientsInvoices.vat')}
                              </label>
                              <ValidatedNumberInput
                                value={item.taxRate}
                                onValueChange={(value) =>
                                  updateItem(index, 'taxRate', value === '' ? 0 : Number(value))
                                }
                                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none"
                              />
                            </div>

                            <div className="space-y-1 md:col-span-1">
                              <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 md:hidden">
                                {t('accounting:supplierOrders.discount')}
                              </label>
                              <ValidatedNumberInput
                                value={item.discount || 0}
                                onValueChange={(value) =>
                                  updateItem(index, 'discount', value === '' ? 0 : Number(value))
                                }
                                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none"
                              />
                            </div>

                            <div className="space-y-1 md:col-span-2">
                              <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 md:hidden">
                                {t('common:labels.total')}
                              </label>
                              <div className="flex min-h-[42px] items-center justify-end whitespace-nowrap px-3 py-2 text-sm font-bold text-slate-700">
                                {lineTotal.toFixed(2)} {currency}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-xl border-2 border-dashed border-slate-200 py-8 text-center text-sm text-slate-400">
                  {t('accounting:clientsInvoices.noItems')}
                </div>
              )}
            </div>

            <div className="flex flex-col gap-8 border-t border-slate-100 pt-6 md:flex-row">
              <div className="w-full space-y-4 md:w-2/3">
                <h4 className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-praetor">
                  <span className="h-1.5 w-1.5 rounded-full bg-praetor"></span>
                  {t('accounting:supplierInvoices.notes')}
                </h4>
                <textarea
                  rows={4}
                  value={formData.notes || ''}
                  onChange={(event) =>
                    setFormData((prev) => ({ ...prev, notes: event.target.value }))
                  }
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm outline-none"
                  placeholder={t('accounting:clientsInvoices.notesPlaceholder')}
                />
              </div>

              <div className="w-full space-y-3 md:w-1/3">
                <h4 className="mb-4 flex items-center gap-2 text-xs font-black uppercase tracking-widest text-praetor">
                  <span className="h-1.5 w-1.5 rounded-full bg-praetor"></span>
                  {t('accounting:clientsInvoices.costSummary')}
                </h4>
                <div className="flex justify-between">
                  <span className="text-sm font-bold text-slate-500">
                    {t('accounting:clientsInvoices.subtotal')}
                  </span>
                  <span className="text-sm font-bold text-slate-700">
                    {grossSubtotal.toFixed(2)} {currency}
                  </span>
                </div>
                {totalDiscount > 0 && (
                  <div className="flex justify-between">
                    <span className="text-sm font-bold text-slate-500">
                      {t('accounting:clientsInvoices.totalDiscount')}
                    </span>
                    <span className="text-sm font-bold text-amber-600">
                      -{totalDiscount.toFixed(2)} {currency}
                    </span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-sm font-bold text-slate-500">
                    {t('accounting:clientsInvoices.vat')}
                  </span>
                  <span className="text-sm font-bold text-slate-700">
                    {totals.taxAmount.toFixed(2)} {currency}
                  </span>
                </div>
                <div className="flex justify-between border-t border-slate-200 pt-3">
                  <span className="text-lg font-black text-slate-800">
                    {t('accounting:supplierInvoices.total')}
                  </span>
                  <span className="text-lg font-black text-praetor">
                    {totals.total.toFixed(2)} {currency}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="font-bold text-slate-500">
                    {t('accounting:supplierInvoices.amountPaid')}
                  </span>
                  <div className="flex items-center gap-2">
                    <ValidatedNumberInput
                      value={formData.amountPaid || 0}
                      onValueChange={(value) =>
                        setFormData((prev) => ({
                          ...prev,
                          amountPaid: value === '' ? 0 : Number(value),
                        }))
                      }
                      className="w-24 rounded-lg border border-slate-200 bg-white px-2 py-1 text-right text-sm font-bold text-emerald-600"
                    />
                    <span className="text-xs font-bold text-slate-400">{currency}</span>
                  </div>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="font-bold text-slate-500">
                    {t('accounting:clientsInvoices.balanceDue')}
                  </span>
                  <span
                    className={`font-bold ${balanceDue > 0 ? 'text-red-500' : 'text-emerald-600'}`}
                  >
                    {balanceDue.toFixed(2)} {currency}
                  </span>
                </div>
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
                {t('accounting:supplierInvoices.deleteTitle', {
                  defaultValue: 'Delete supplier invoice?',
                })}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-500">
                {invoiceToDelete?.supplierName} · {invoiceToDelete?.invoiceNumber}
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
              {t('accounting:supplierInvoices.title', { defaultValue: 'Supplier Invoices' })}
            </h2>
            <p className="text-sm text-slate-500">
              {t('accounting:supplierInvoices.subtitle', {
                defaultValue: 'Invoices created from supplier orders.',
              })}
            </p>
          </div>
        </div>
      </div>

      <StandardTable<SupplierInvoice>
        title={t('accounting:supplierInvoices.title', { defaultValue: 'Supplier Invoices' })}
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
