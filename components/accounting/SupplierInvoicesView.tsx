import type React from 'react';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { Product, Supplier, SupplierInvoice, SupplierInvoiceItem } from '../../types';
import {
  addDaysToDateOnly,
  formatDateOnlyForLocale,
  getLocalDateString,
  normalizeDateOnlyString,
} from '../../utils/date';
import CostSummaryPanel from '../shared/CostSummaryPanel';
import DeleteConfirmModal from '../shared/DeleteConfirmModal';
import Modal from '../shared/Modal';
import {
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '../shared/ModalLayout';
import SelectControl from '../shared/SelectControl';
import StandardTable from '../shared/StandardTable';
import StatusBadge, { type StatusType } from '../shared/StatusBadge';
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
          <span className="font-bold text-zinc-700">{row.id}</span>
        ),
      },
      {
        header: t('accounting:supplierInvoices.supplier'),
        id: 'supplierName',
        accessorFn: (row: SupplierInvoice) => row.supplierName,
        cell: ({ row }: { row: SupplierInvoice }) => {
          const isMuted = row.status === 'paid' || row.status === 'cancelled';

          return (
            <span className={`font-bold ${isMuted ? 'text-zinc-400' : 'text-zinc-800'}`}>
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
          <span className="text-sm text-zinc-600">{formatDateOnlyForLocale(row.issueDate)}</span>
        ),
      },
      {
        header: t('accounting:supplierInvoices.dueDate'),
        id: 'dueDate',
        accessorFn: (row: SupplierInvoice) => formatDateOnlyForLocale(row.dueDate),
        cell: ({ row }: { row: SupplierInvoice }) => (
          <span className="text-sm text-zinc-600">{formatDateOnlyForLocale(row.dueDate)}</span>
        ),
      },
      {
        header: t('common:labels.amount'),
        id: 'invoiceTotal',
        accessorFn: (row: SupplierInvoice) => Number(row.total),
        cell: ({ row }: { row: SupplierInvoice }) => (
          <span className="font-bold text-zinc-700">
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
        header: t('accounting:supplierInvoices.actionsColumn'),
        id: 'actions',
        className: 'whitespace-nowrap',
        headerClassName: 'min-w-[8rem]',
        disableSorting: true,
        disableFiltering: true,
        align: 'right' as const,
        cell: ({ row }: { row: SupplierInvoice }) => (
          <div className="flex justify-end gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      openEditModal(row);
                    }}
                    aria-label={t('common:buttons.edit')}
                    className="rounded-lg p-2 text-zinc-400 transition-all hover:bg-zinc-100 hover:text-praetor"
                  >
                    <i className="fa-solid fa-pen-to-square"></i>
                  </button>
                </span>
              </TooltipTrigger>
              <TooltipContent>{t('common:buttons.edit')}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      confirmDelete(row);
                    }}
                    aria-label={t('common:buttons.delete')}
                    className="rounded-lg p-2 text-red-600 transition-all hover:bg-red-50 hover:text-red-600"
                  >
                    <i className="fa-solid fa-trash-can"></i>
                  </button>
                </span>
              </TooltipTrigger>
              <TooltipContent>{t('common:buttons.delete')}</TooltipContent>
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
        <ModalContent size="full" className="max-h-[90vh]">
          <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
            <ModalHeader>
              <ModalTitle className="gap-3">
                <span className="flex size-10 items-center justify-center rounded-md bg-muted text-primary">
                  <i
                    className={`fa-solid ${editingInvoice ? 'fa-pen-to-square' : 'fa-plus'}`}
                    aria-hidden="true"
                  ></i>
                </span>
                {editingInvoice
                  ? t('accounting:supplierInvoices.editInvoice')
                  : t('accounting:supplierInvoices.addInvoice')}
              </ModalTitle>
              <ModalCloseButton onClick={() => setIsModalOpen(false)} />
            </ModalHeader>

            <ModalBody className="flex-1 space-y-5">
              <div className="space-y-2">
                <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-primary">
                  <span className="size-1.5 rounded-full bg-primary"></span>
                  {t('accounting:supplierInvoices.invoiceDetails')}
                </h4>
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <Field>
                    <SelectControl
                      id="supplier-invoice-supplier"
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
                      label={t('accounting:supplierInvoices.supplier')}
                      placeholder={t('accounting:supplierInvoices.selectSupplier')}
                      buttonClassName="h-9"
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="supplier-invoice-number">
                      {t('accounting:supplierInvoices.invoiceNumber')}
                    </FieldLabel>
                    <Input
                      id="supplier-invoice-number"
                      type="text"
                      required
                      value={formData.id || ''}
                      onChange={(event) =>
                        setFormData((prev) => ({ ...prev, id: event.target.value }))
                      }
                      className="font-medium"
                      placeholder="INV-XXXX"
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="supplier-invoice-issue-date">
                      {t('accounting:supplierInvoices.issueDate')}
                    </FieldLabel>
                    <Input
                      id="supplier-invoice-issue-date"
                      type="date"
                      required
                      value={formData.issueDate || ''}
                      onChange={(event) =>
                        setFormData((prev) => ({ ...prev, issueDate: event.target.value }))
                      }
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="supplier-invoice-due-date">
                      {t('accounting:supplierInvoices.dueDate')}
                    </FieldLabel>
                    <Input
                      id="supplier-invoice-due-date"
                      type="date"
                      required
                      value={formData.dueDate || ''}
                      onChange={(event) =>
                        setFormData((prev) => ({ ...prev, dueDate: event.target.value }))
                      }
                    />
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <Field>
                    <SelectControl
                      id="supplier-invoice-status"
                      options={statusOptions}
                      value={formData.status || 'draft'}
                      onChange={(value) =>
                        setFormData((prev) => ({
                          ...prev,
                          status: value as SupplierInvoice['status'],
                        }))
                      }
                      label={t('accounting:supplierInvoices.status')}
                      searchable={false}
                      buttonClassName="h-9"
                    />
                  </Field>
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-primary">
                    <span className="size-1.5 rounded-full bg-primary"></span>
                    {t('accounting:supplierInvoices.items')}
                  </h4>
                </div>

                {(formData.items || []).length > 0 && (
                  <div className="mb-1 hidden items-center gap-2 px-3 lg:flex">
                    <div className="grid flex-1 grid-cols-12 gap-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      <div className="col-span-2 ml-1">{t('crm:quotes.productsServices')}</div>
                      <div className="col-span-3">
                        {t('accounting:supplierInvoices.descriptionPlaceholder')}
                      </div>
                      <div className="col-span-1">{t('common:labels.quantity')}</div>
                      <div className="col-span-2">{t('crm:internalListing.salePrice')}</div>
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
                          className="space-y-3 rounded-md border border-border bg-muted/30 p-3"
                        >
                          <div className="lg:hidden space-y-2">
                            <SelectControl
                              options={productOptions}
                              value={item.productId || ''}
                              onChange={(value) => updateItem(index, 'productId', value as string)}
                              searchable={true}
                              buttonClassName="h-9"
                            />
                            <Input
                              type="text"
                              value={item.description}
                              placeholder={t('accounting:supplierInvoices.descriptionPlaceholder')}
                              onChange={(event) =>
                                updateItem(index, 'description', event.target.value)
                              }
                            />
                            <div className="grid grid-cols-2 gap-2">
                              <div className="space-y-1">
                                <FieldLabel className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                                  {t('common:labels.quantity')}
                                </FieldLabel>
                                <ValidatedNumberInput
                                  value={item.quantity}
                                  onValueChange={(value) =>
                                    updateItem(index, 'quantity', value === '' ? 0 : Number(value))
                                  }
                                  className="text-center"
                                />
                                <div className="mt-1 flex items-center justify-center gap-1 text-xs font-medium text-muted-foreground">
                                  <span>/</span>
                                  <span>{t('accounting:clientsInvoices.unit')}</span>
                                </div>
                              </div>
                              <div className="space-y-1">
                                <FieldLabel className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                                  {t('crm:internalListing.salePrice')}
                                </FieldLabel>
                                <div className="flex items-center gap-1">
                                  <ValidatedNumberInput
                                    value={item.unitPrice}
                                    formatDecimals={2}
                                    onValueChange={(value) =>
                                      updateItem(
                                        index,
                                        'unitPrice',
                                        value === '' ? 0 : Number(value),
                                      )
                                    }
                                    className="min-w-0 text-center"
                                  />
                                  <span className="shrink-0 text-xs font-medium text-muted-foreground">
                                    {currency}
                                  </span>
                                </div>
                              </div>
                              <div className="space-y-1">
                                <FieldLabel className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                                  {t('accounting:supplierOrders.discount')}
                                </FieldLabel>
                                <div className="flex items-center gap-1">
                                  <ValidatedNumberInput
                                    value={item.discount || 0}
                                    formatDecimals={2}
                                    onValueChange={(value) =>
                                      updateItem(
                                        index,
                                        'discount',
                                        value === '' ? 0 : Number(value),
                                      )
                                    }
                                    className="min-w-0 text-center"
                                  />
                                  <span className="shrink-0 text-xs font-medium text-muted-foreground">
                                    %
                                  </span>
                                </div>
                              </div>
                              <div className="space-y-1">
                                <FieldLabel className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                                  {t('common:labels.total')}
                                </FieldLabel>
                                <div className="flex items-center justify-end whitespace-nowrap px-3 py-2 text-sm font-semibold text-foreground">
                                  {lineTotal.toFixed(2)} {currency}
                                </div>
                              </div>
                            </div>
                            <div className="flex justify-end">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                onClick={() => removeItem(index)}
                                className="text-muted-foreground hover:text-destructive"
                              >
                                <i className="fa-solid fa-trash-can" aria-hidden="true"></i>
                                <span className="sr-only">{t('common:buttons.delete')}</span>
                              </Button>
                            </div>
                          </div>
                          <div className="hidden lg:flex items-start gap-2">
                            <div className="grid flex-1 grid-cols-12 gap-2">
                              <div className="lg:col-span-2 min-w-0">
                                <SelectControl
                                  options={productOptions}
                                  value={item.productId || ''}
                                  onChange={(value) =>
                                    updateItem(index, 'productId', value as string)
                                  }
                                  searchable={true}
                                  buttonClassName="h-9"
                                />
                              </div>
                              <div className="lg:col-span-3">
                                <Input
                                  type="text"
                                  value={item.description}
                                  onChange={(event) =>
                                    updateItem(index, 'description', event.target.value)
                                  }
                                />
                              </div>
                              <div className="lg:col-span-1">
                                <div className="flex items-center gap-1">
                                  <ValidatedNumberInput
                                    value={item.quantity}
                                    onValueChange={(value) =>
                                      updateItem(
                                        index,
                                        'quantity',
                                        value === '' ? 0 : Number(value),
                                      )
                                    }
                                    className="min-w-0 font-medium"
                                  />
                                  <span className="shrink-0 text-xs font-medium text-muted-foreground">
                                    /
                                  </span>
                                  <span className="shrink-0 text-xs font-medium text-muted-foreground">
                                    {t('accounting:clientsInvoices.unit')}
                                  </span>
                                </div>
                              </div>
                              <div className="lg:col-span-2">
                                <div className="flex items-center gap-1">
                                  <ValidatedNumberInput
                                    value={item.unitPrice}
                                    formatDecimals={2}
                                    onValueChange={(value) =>
                                      updateItem(
                                        index,
                                        'unitPrice',
                                        value === '' ? 0 : Number(value),
                                      )
                                    }
                                    className="min-w-0 font-medium"
                                  />
                                  <span className="shrink-0 text-xs font-medium text-muted-foreground">
                                    {currency}
                                  </span>
                                </div>
                              </div>
                              <div className="lg:col-span-1">
                                <div className="flex items-center gap-1">
                                  <ValidatedNumberInput
                                    value={item.discount || 0}
                                    formatDecimals={2}
                                    onValueChange={(value) =>
                                      updateItem(
                                        index,
                                        'discount',
                                        value === '' ? 0 : Number(value),
                                      )
                                    }
                                    className="min-w-0 font-medium"
                                  />
                                  <span className="shrink-0 text-xs font-medium text-muted-foreground">
                                    %
                                  </span>
                                </div>
                              </div>
                              <div className="flex items-center justify-end whitespace-nowrap px-3 py-2 text-sm font-semibold text-foreground lg:col-span-2">
                                {lineTotal.toFixed(2)} {currency}
                              </div>
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => removeItem(index)}
                              className="shrink-0 text-muted-foreground hover:text-destructive"
                            >
                              <i className="fa-solid fa-trash-can" aria-hidden="true"></i>
                              <span className="sr-only">{t('common:buttons.delete')}</span>
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-md border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
                    {t('accounting:supplierInvoices.noItems')}
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-4 border-t border-border pt-4 md:flex-row">
                <Field className="md:w-2/3">
                  <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-primary">
                    <span className="size-1.5 rounded-full bg-primary"></span>
                    {t('accounting:supplierInvoices.notes')}
                  </h4>
                  <FieldLabel htmlFor="supplier-invoice-notes" className="sr-only">
                    {t('accounting:supplierInvoices.notes')}
                  </FieldLabel>
                  <Textarea
                    id="supplier-invoice-notes"
                    rows={4}
                    value={formData.notes || ''}
                    onChange={(event) =>
                      setFormData((prev) => ({ ...prev, notes: event.target.value }))
                    }
                    className="min-h-28 resize-none"
                    placeholder={t('accounting:supplierInvoices.notesPlaceholder')}
                  />
                </Field>

                <div className="space-y-2 md:w-1/3">
                  <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-primary">
                    <span className="size-1.5 rounded-full bg-primary"></span>
                    {t('accounting:supplierInvoices.summary', { defaultValue: 'Summary' })}
                  </h4>
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
            </ModalBody>

            <ModalFooter>
              <Button type="button" variant="outline" onClick={() => setIsModalOpen(false)}>
                {t('common:buttons.cancel')}
              </Button>
              <Button type="submit">
                {editingInvoice ? t('common:buttons.update') : t('common:buttons.save')}
              </Button>
            </ModalFooter>
          </form>
        </ModalContent>
      </Modal>

      <DeleteConfirmModal
        isOpen={isDeleteConfirmOpen}
        onClose={() => setIsDeleteConfirmOpen(false)}
        onConfirm={() => {
          void handleDelete();
        }}
        title={t('accounting:supplierInvoices.deleteTitle')}
        description={`${invoiceToDelete?.supplierName ?? ''} · ${invoiceToDelete?.id ?? ''}`}
      />

      <div className="space-y-4">
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-2xl font-semibold text-zinc-800">
              {t('accounting:supplierInvoices.title')}
            </h2>
            <p className="text-sm text-zinc-500">{t('accounting:supplierInvoices.subtitle')}</p>
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
            ? 'bg-zinc-50 text-zinc-400'
            : 'hover:bg-zinc-50/50'
        }
        onRowClick={(row: SupplierInvoice) => openEditModal(row)}
      />
    </div>
  );
};

export default SupplierInvoicesView;
