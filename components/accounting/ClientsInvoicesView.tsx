import type React from 'react';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { Client, Invoice, InvoiceItem, Product } from '../../types';
import { addDaysToDateOnly, formatDateOnlyForLocale, getLocalDateString } from '../../utils/date';
import { calcProductSalePrice } from '../../utils/numbers';
import CostSummaryPanel from '../shared/CostSummaryPanel';
import DeleteConfirmModal from '../shared/DeleteConfirmModal';
import HeaderAddButton from '../shared/HeaderAddButton';
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

export interface ClientsInvoicesViewProps {
  invoices: Invoice[];
  clients: Client[];
  products: Product[];
  onAddInvoice: (invoiceData: Partial<Invoice>) => void;
  onUpdateInvoice: (id: string, updates: Partial<Invoice>) => void;
  onDeleteInvoice: (id: string) => void;
  currency: string;
}

// Italian standard VAT rate, used as the per-line default.
const DEFAULT_TAX_RATE = 22;

const getLineTaxable = (item: InvoiceItem) =>
  item.quantity * item.unitPrice * (1 - Number(item.discount || 0) / 100);

const getLineTotal = (item: InvoiceItem) =>
  getLineTaxable(item) * (1 + Number(item.taxRate || 0) / 100);

const normalizeUnitOfMeasure = (
  unitOfMeasure?: InvoiceItem['unitOfMeasure'],
): InvoiceItem['unitOfMeasure'] => (unitOfMeasure === 'hours' ? 'hours' : 'unit');

const ClientsInvoicesView: React.FC<ClientsInvoicesViewProps> = ({
  invoices,
  clients,
  products,
  onAddInvoice,
  onUpdateInvoice,
  onDeleteInvoice,
  currency,
}) => {
  const { t } = useTranslation(['accounting', 'sales', 'common']);
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

  const unitOptions = useMemo(
    () => [
      { id: 'unit', name: t('accounting:clientsInvoices.unit') },
      { id: 'hours', name: t('accounting:clientsInvoices.hours') },
    ],
    [t],
  );

  const defaultInvoice = useMemo(() => {
    const issueDate = getLocalDateString();
    return {
      clientId: '',
      clientName: '',
      id: '',
      items: [],
      issueDate,
      dueDate: addDaysToDateOnly(issueDate, 30),
      status: 'draft' as const,
      notes: '',
      amountPaid: 0,
      subtotal: 0,
      taxTotal: 0,
      total: 0,
    };
  }, []);

  const [formData, setFormData] = useState<Partial<Invoice>>(defaultInvoice);

  const activeClients = useMemo(() => clients.filter((client) => !client.isDisabled), [clients]);
  const activeProducts = useMemo(
    () => products.filter((product) => !product.isDisabled),
    [products],
  );

  const generateInvoiceId = () => {
    const year = new Date().getFullYear();
    const count = invoices.length + 1;
    return `INV-${year}-${count.toString().padStart(4, '0')}`;
  };

  const clearItemsError = useCallback(() => {
    if (errors.items) {
      setErrors((prev) => {
        const nextErrors = { ...prev };
        delete nextErrors.items;
        return nextErrors;
      });
    }
  }, [errors.items]);

  const applyProductPricing = useCallback(
    (
      item: InvoiceItem,
      product: Product,
      options?: { preserveDescription?: boolean },
    ): InvoiceItem => {
      const mol = product.molPercentage ? Number(product.molPercentage) : 0;
      const cost = Number(product.costo);

      return {
        ...item,
        productId: product.id,
        description: options?.preserveDescription ? item.description : product.name,
        unitOfMeasure: normalizeUnitOfMeasure(product.costUnit),
        unitPrice: calcProductSalePrice(cost, mol),
      };
    },
    [],
  );

  const openAddModal = () => {
    const issueDate = getLocalDateString();
    setEditingInvoice(null);
    setFormData({
      clientId: '',
      clientName: '',
      id: generateInvoiceId(),
      items: [],
      issueDate,
      dueDate: addDaysToDateOnly(issueDate, 30),
      status: 'draft',
      notes: '',
      amountPaid: 0,
      subtotal: 0,
      taxTotal: 0,
      total: 0,
    });
    setErrors({});
    setIsModalOpen(true);
  };

  const openEditModal = useCallback((invoice: Invoice) => {
    setEditingInvoice(invoice);
    setFormData({
      ...invoice,
      items: invoice.items.map((item) => ({
        ...item,
        unitOfMeasure: normalizeUnitOfMeasure(item.unitOfMeasure),
      })),
    });
    setErrors({});
    setIsModalOpen(true);
  }, []);

  const calculateTotals = useCallback((items: InvoiceItem[]) => {
    let subtotal = 0;
    let taxTotal = 0;

    items.forEach((item) => {
      const taxable = getLineTaxable(item);
      subtotal += taxable;
      taxTotal += (taxable * Number(item.taxRate || 0)) / 100;
    });

    const total = subtotal + taxTotal;

    return { subtotal, taxTotal, total };
  }, []);

  const handleClientChange = (clientId: string) => {
    const client = clients.find((item) => item.id === clientId);
    setFormData((prev) => ({
      ...prev,
      clientId,
      clientName: client?.name || '',
    }));

    if (errors.clientId) {
      setErrors((prev) => {
        const nextErrors = { ...prev };
        delete nextErrors.clientId;
        return nextErrors;
      });
    }
  };

  const addItemRow = () => {
    const newItem: Partial<InvoiceItem> = {
      id: `temp-${Date.now()}`,
      productId: undefined,
      description: '',
      unitOfMeasure: 'unit',
      quantity: 1,
      unitPrice: 0,
      discount: 0,
      taxRate: DEFAULT_TAX_RATE,
    };

    setFormData((prev) => ({
      ...prev,
      items: [...(prev.items || []), newItem as InvoiceItem],
    }));
    clearItemsError();
  };

  const removeItemRow = (index: number) => {
    const nextItems = [...(formData.items || [])];
    nextItems.splice(index, 1);
    setFormData((prev) => ({ ...prev, items: nextItems }));
  };

  const updateItemRow = (
    index: number,
    field: keyof InvoiceItem,
    value: string | number | undefined,
  ) => {
    setFormData((prev) => {
      const nextItems = [...(prev.items || [])];
      const currentItem = { ...nextItems[index], [field]: value } as InvoiceItem;
      let nextItem = currentItem;

      if (field === 'productId') {
        if (!value) {
          nextItem = {
            ...currentItem,
            productId: undefined,
          };
        } else {
          const product = products.find((item) => item.id === value);
          if (product) {
            nextItem = applyProductPricing(currentItem, product);
          }
        }
      }

      if (field === 'unitOfMeasure') {
        nextItem = {
          ...currentItem,
          unitOfMeasure: normalizeUnitOfMeasure(value as InvoiceItem['unitOfMeasure']),
        };
      }

      nextItems[index] = nextItem;
      return { ...prev, items: nextItems };
    });

    clearItemsError();
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();

    const nextErrors: Record<string, string> = {};
    if (!formData.clientId) nextErrors.clientId = t('accounting:clientsInvoices.clientRequired');
    if (!formData.id) {
      nextErrors.id = t('accounting:clientsInvoices.invoiceNumberRequired');
    }
    if (!formData.issueDate) {
      nextErrors.issueDate = t('accounting:clientsInvoices.issueDateRequired');
    }
    if (!formData.dueDate) nextErrors.dueDate = t('accounting:clientsInvoices.dueDateRequired');
    if (!formData.items || formData.items.length === 0) {
      nextErrors.items = t('accounting:clientsInvoices.itemsRequired');
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    const roundedItems = (formData.items || []).map((item) => ({
      ...item,
      unitOfMeasure: normalizeUnitOfMeasure(item.unitOfMeasure),
      quantity: Number(item.quantity ?? 0),
      unitPrice: Number(item.unitPrice ?? 0),
      discount: Number(item.discount || 0),
      taxRate: Number(item.taxRate || 0),
    }));

    const { subtotal, taxTotal, total } = calculateTotals(roundedItems);
    const payload = {
      ...formData,
      items: roundedItems,
      amountPaid: Number(formData.amountPaid || 0),
      subtotal,
      taxTotal,
      total,
    };

    if (editingInvoice) {
      onUpdateInvoice(editingInvoice.id, payload);
    } else {
      onAddInvoice(payload);
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

  const { subtotal, taxTotal, total } = calculateTotals(formData.items || []);
  const totalDiscount = (formData.items || []).reduce(
    (sum, item) => sum + item.quantity * item.unitPrice * (Number(item.discount || 0) / 100),
    0,
  );
  const grossSubtotal = subtotal + totalDiscount;

  const columns = useMemo(
    () => [
      {
        header: t('accounting:clientsInvoices.invoiceNumber'),
        id: 'id',
        accessorFn: (row: Invoice) => row.id,
        className: 'whitespace-nowrap',
        headerClassName: 'min-w-[8rem]',
        cell: ({ row }: { row: Invoice }) => (
          <span className="font-bold text-zinc-700">{row.id}</span>
        ),
      },
      {
        header: t('accounting:clientsInvoices.client'),
        id: 'clientName',
        accessorFn: (row: Invoice) => row.clientName,
        cell: ({ row }: { row: Invoice }) => (
          <span className="font-bold text-zinc-800">{row.clientName}</span>
        ),
      },
      {
        header: t('common:labels.date'),
        id: 'issueDate',
        accessorFn: (row: Invoice) => formatDateOnlyForLocale(row.issueDate),
        className: 'whitespace-nowrap',
        headerClassName: 'min-w-[8rem]',
        cell: ({ row }: { row: Invoice }) => (
          <span className="text-sm text-zinc-600">{formatDateOnlyForLocale(row.issueDate)}</span>
        ),
      },
      {
        header: t('accounting:clientsInvoices.dueDate'),
        id: 'dueDate',
        accessorFn: (row: Invoice) => formatDateOnlyForLocale(row.dueDate),
        className: 'whitespace-nowrap',
        headerClassName: 'min-w-[8rem]',
        cell: ({ row }: { row: Invoice }) => (
          <span className="text-sm text-zinc-600">{formatDateOnlyForLocale(row.dueDate)}</span>
        ),
      },
      {
        header: t('common:labels.amount'),
        id: 'invoiceTotal',
        accessorFn: (row: Invoice) => row.total,
        className: 'whitespace-nowrap',
        headerClassName: 'min-w-[8rem]',
        cell: ({ row }: { row: Invoice }) => (
          <span className="font-bold text-zinc-700">
            {(row.total ?? 0).toFixed(2)} {currency}
          </span>
        ),
        filterFormat: (value: unknown) => (value as number).toFixed(2),
      },
      {
        header: t('accounting:clientsInvoices.amountPaid'),
        id: 'amountPaid',
        accessorFn: (row: Invoice) => row.amountPaid,
        cell: ({ row }: { row: Invoice }) => (
          <span className="font-bold text-emerald-600">
            {(row.amountPaid ?? 0).toFixed(2)} {currency}
          </span>
        ),
        filterFormat: (value: unknown) => (value as number).toFixed(2),
      },
      {
        header: t('accounting:clientsInvoices.balance'),
        id: 'balance',
        accessorFn: (row: Invoice) => row.total - row.amountPaid,
        cell: ({ row }: { row: Invoice }) => {
          const balance = row.total - row.amountPaid;
          return (
            <span className={`font-bold ${balance > 0 ? 'text-red-500' : 'text-emerald-600'}`}>
              {balance.toFixed(2)} {currency}
            </span>
          );
        },
        filterFormat: (value: unknown) => (value as number).toFixed(2),
      },
      {
        header: t('accounting:clientsInvoices.status'),
        id: 'invoiceStatus',
        accessorFn: (row: Invoice) =>
          statusOptions.find((opt) => opt.id === row.status)?.name || row.status,
        className: 'whitespace-nowrap',
        headerClassName: 'min-w-[9rem]',
        cell: ({ row }: { row: Invoice }) => (
          <StatusBadge
            type={row.status as StatusType}
            label={statusOptions.find((option) => option.id === row.status)?.name || row.status}
          />
        ),
      },
      {
        header: t('accounting:clientsInvoices.actionsColumn'),
        id: 'actions',
        className: 'whitespace-nowrap',
        headerClassName: 'min-w-[8rem]',
        disableSorting: true,
        disableFiltering: true,
        align: 'right' as const,
        cell: ({ row }: { row: Invoice }) => (
          <div className="flex justify-end gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex">
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      openEditModal(row);
                    }}
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
                    onClick={(event) => {
                      event.stopPropagation();
                      confirmDelete(row);
                    }}
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
    [currency, statusOptions, t, confirmDelete, openEditModal],
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
                  ? t('accounting:clientsInvoices.editInvoice')
                  : t('accounting:clientsInvoices.addInvoice')}
              </ModalTitle>
              <ModalCloseButton onClick={() => setIsModalOpen(false)} />
            </ModalHeader>

            <ModalBody className="flex-1 space-y-5">
              <div className="space-y-2">
                <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-primary">
                  <span className="size-1.5 rounded-full bg-primary"></span>
                  {t('accounting:clientsInvoices.invoiceDetails')}
                </h4>
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <Field data-invalid={Boolean(errors.clientId)}>
                    <SelectControl
                      id="client-invoice-client"
                      options={activeClients.map((client) => ({
                        id: client.id,
                        name: client.name,
                      }))}
                      value={formData.clientId || ''}
                      onChange={(value) => handleClientChange(value as string)}
                      label={t('accounting:clientsInvoices.client')}
                      placeholder={t('accounting:clientsInvoices.allClients')}
                      searchable={true}
                      buttonClassName={errors.clientId ? 'h-9 border-destructive' : 'h-9'}
                    />
                    <FieldError className="text-xs">{errors.clientId}</FieldError>
                  </Field>
                  <Field data-invalid={Boolean(errors.id)}>
                    <FieldLabel htmlFor="client-invoice-number">
                      {t('accounting:clientsInvoices.invoiceNumber')}
                    </FieldLabel>
                    <Input
                      id="client-invoice-number"
                      type="text"
                      required
                      value={formData.id || ''}
                      onChange={(event) =>
                        setFormData((prev) => ({ ...prev, id: event.target.value }))
                      }
                      aria-invalid={Boolean(errors.id)}
                      className="font-medium"
                      placeholder="INV-YYYY-XXXX"
                    />
                    <FieldError className="text-xs">{errors.id}</FieldError>
                  </Field>
                  <Field data-invalid={Boolean(errors.issueDate)}>
                    <FieldLabel htmlFor="client-invoice-issue-date">
                      {t('accounting:clientsInvoices.issueDate')}
                    </FieldLabel>
                    <Input
                      id="client-invoice-issue-date"
                      type="date"
                      required
                      value={formData.issueDate}
                      onChange={(event) =>
                        setFormData((prev) => ({ ...prev, issueDate: event.target.value }))
                      }
                      aria-invalid={Boolean(errors.issueDate)}
                    />
                    <FieldError className="text-xs">{errors.issueDate}</FieldError>
                  </Field>
                  <Field data-invalid={Boolean(errors.dueDate)}>
                    <FieldLabel htmlFor="client-invoice-due-date">
                      {t('accounting:clientsInvoices.dueDate')}
                    </FieldLabel>
                    <Input
                      id="client-invoice-due-date"
                      type="date"
                      required
                      value={formData.dueDate}
                      onChange={(event) =>
                        setFormData((prev) => ({ ...prev, dueDate: event.target.value }))
                      }
                      aria-invalid={Boolean(errors.dueDate)}
                    />
                    <FieldError className="text-xs">{errors.dueDate}</FieldError>
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <Field>
                    <SelectControl
                      id="client-invoice-status"
                      options={statusOptions}
                      value={formData.status || 'draft'}
                      onChange={(value) =>
                        setFormData((prev) => ({ ...prev, status: value as Invoice['status'] }))
                      }
                      label={t('accounting:clientsInvoices.status')}
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
                    {t('accounting:clientsInvoices.items')}
                  </h4>
                  <Button type="button" size="sm" onClick={addItemRow}>
                    <i className="fa-solid fa-plus text-[10px]" aria-hidden="true"></i>
                    {t('accounting:clientsInvoices.addItem')}
                  </Button>
                </div>
                <FieldError className="-mt-2 text-xs">{errors.items}</FieldError>

                {formData.items && formData.items.length > 0 && (
                  <div className="mb-1 hidden items-center gap-2 px-3 lg:flex">
                    <div className="grid flex-1 grid-cols-12 gap-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      <div className="col-span-3">{t('common:labels.product')}</div>
                      <div className="col-span-2">{t('common:labels.quantity')}</div>
                      <div className="col-span-2">{t('common:labels.price')}</div>
                      <div className="col-span-1">{t('common:labels.discount')}</div>
                      <div className="col-span-2">
                        {t('accounting:clientsInvoices.taxRate', { defaultValue: 'IVA %' })}
                      </div>
                      <div className="col-span-2 pr-2 text-right">{t('common:labels.total')}</div>
                    </div>
                    <div className="w-8 shrink-0"></div>
                  </div>
                )}

                <div className="space-y-3">
                  {formData.items?.map((item, index) => {
                    const lineTotal = getLineTotal(item);

                    return (
                      <div
                        key={item.id}
                        className="space-y-3 rounded-md border border-border bg-muted/30 p-3"
                      >
                        <div className="flex items-start gap-2">
                          <div className="grid flex-1 grid-cols-1 gap-2 lg:grid-cols-12">
                            <div className="space-y-1 lg:col-span-3 min-w-0">
                              <FieldLabel className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground lg:hidden">
                                {t('common:labels.product')}
                              </FieldLabel>
                              <SelectControl
                                options={[
                                  { id: '', name: t('accounting:clientsInvoices.customItem') },
                                  ...activeProducts.map((product) => ({
                                    id: product.id,
                                    name: product.name,
                                  })),
                                ]}
                                value={item.productId || ''}
                                onChange={(value) =>
                                  updateItemRow(index, 'productId', (value as string) || undefined)
                                }
                                placeholder={t(
                                  'accounting:clientsInvoices.selectProductPlaceholder',
                                )}
                                searchable={true}
                                buttonClassName="h-9"
                              />
                            </div>
                            <div className="space-y-1 lg:col-span-2">
                              <FieldLabel className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground lg:hidden">
                                {t('common:labels.quantity')}
                              </FieldLabel>
                              <div className="flex items-center gap-1">
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
                                  className="min-w-0"
                                />
                                <span className="shrink-0 text-xs font-medium text-muted-foreground">
                                  /
                                </span>
                                <span className="shrink-0 text-xs font-medium text-muted-foreground">
                                  {unitOptions.find((u) => u.id === (item.unitOfMeasure || 'unit'))
                                    ?.name || t('accounting:clientsInvoices.unit')}
                                </span>
                              </div>
                            </div>
                            <div className="space-y-1 lg:col-span-2">
                              <FieldLabel className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground lg:hidden">
                                {t('common:labels.price')}
                              </FieldLabel>
                              <div className="flex items-center gap-1">
                                <ValidatedNumberInput
                                  min="0"
                                  step="0.01"
                                  required
                                  value={item.unitPrice}
                                  formatDecimals={2}
                                  onValueChange={(value) => {
                                    const parsed = parseFloat(value);
                                    updateItemRow(
                                      index,
                                      'unitPrice',
                                      value === '' || Number.isNaN(parsed) ? 0 : parsed,
                                    );
                                  }}
                                  className="min-w-0 font-medium"
                                />
                                <span className="shrink-0 text-xs font-medium text-muted-foreground">
                                  {currency}
                                </span>
                              </div>
                            </div>
                            <div className="space-y-1 lg:col-span-1">
                              <FieldLabel className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground lg:hidden">
                                {t('common:labels.discount')}
                              </FieldLabel>
                              <div className="flex items-center gap-1">
                                <ValidatedNumberInput
                                  min="0"
                                  max="100"
                                  value={item.discount || 0}
                                  formatDecimals={2}
                                  onValueChange={(value) => {
                                    const parsed = parseFloat(value);
                                    updateItemRow(
                                      index,
                                      'discount',
                                      value === '' || Number.isNaN(parsed) ? 0 : parsed,
                                    );
                                  }}
                                  className="min-w-0 font-medium"
                                />
                                <span className="shrink-0 text-xs font-medium text-muted-foreground">
                                  %
                                </span>
                              </div>
                            </div>
                            <div className="space-y-1 lg:col-span-2">
                              <FieldLabel className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground lg:hidden">
                                {t('accounting:clientsInvoices.taxRate', {
                                  defaultValue: 'IVA %',
                                })}
                              </FieldLabel>
                              <div className="flex items-center gap-1">
                                <ValidatedNumberInput
                                  min="0"
                                  max="100"
                                  value={item.taxRate ?? DEFAULT_TAX_RATE}
                                  formatDecimals={2}
                                  onValueChange={(value) => {
                                    const parsed = parseFloat(value);
                                    updateItemRow(
                                      index,
                                      'taxRate',
                                      value === '' || Number.isNaN(parsed) ? 0 : parsed,
                                    );
                                  }}
                                  className="min-w-0 font-medium"
                                />
                                <span className="shrink-0 text-xs font-medium text-muted-foreground">
                                  %
                                </span>
                              </div>
                            </div>
                            <div className="space-y-1 lg:col-span-2">
                              <FieldLabel className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground lg:hidden">
                                {t('common:labels.total')}
                              </FieldLabel>
                              <div className="flex min-h-[42px] items-center justify-end whitespace-nowrap px-3 py-2 text-sm font-semibold text-foreground">
                                {lineTotal.toFixed(2)} {currency}
                              </div>
                            </div>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => removeItemRow(index)}
                            className="text-muted-foreground hover:text-destructive"
                          >
                            <i className="fa-solid fa-trash-can" aria-hidden="true"></i>
                            <span className="sr-only">{t('common:buttons.delete')}</span>
                          </Button>
                        </div>

                        <Field>
                          <FieldLabel
                            htmlFor={`client-invoice-item-description-${index}`}
                            className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground"
                          >
                            {t('common:labels.description')}
                          </FieldLabel>
                          <Input
                            id={`client-invoice-item-description-${index}`}
                            type="text"
                            required
                            placeholder={t('accounting:clientsInvoices.descriptionPlaceholder')}
                            value={item.description}
                            onChange={(event) =>
                              updateItemRow(index, 'description', event.target.value)
                            }
                          />
                        </Field>
                      </div>
                    );
                  })}

                  {(!formData.items || formData.items.length === 0) && (
                    <div className="rounded-md border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
                      {t('accounting:clientsInvoices.noItems')}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-4 border-t border-border pt-4 md:flex-row">
                <Field className="md:w-2/3">
                  <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-primary">
                    <span className="size-1.5 rounded-full bg-primary"></span>
                    {t('accounting:clientsInvoices.notes')}
                  </h4>
                  <FieldLabel htmlFor="client-invoice-notes" className="sr-only">
                    {t('accounting:clientsInvoices.notes')}
                  </FieldLabel>
                  <Textarea
                    id="client-invoice-notes"
                    rows={4}
                    value={formData.notes || ''}
                    onChange={(event) =>
                      setFormData((prev) => ({ ...prev, notes: event.target.value }))
                    }
                    className="min-h-28 resize-none"
                    placeholder={t('accounting:clientsInvoices.notesPlaceholder')}
                  />
                </Field>

                <div className="space-y-2 md:w-1/3">
                  <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-primary">
                    <span className="size-1.5 rounded-full bg-primary"></span>
                    {t('accounting:clientsInvoices.summary', { defaultValue: 'Summary' })}
                  </h4>
                  <CostSummaryPanel
                    currency={currency}
                    subtotal={grossSubtotal}
                    total={total}
                    subtotalLabel={t('accounting:clientsInvoices.subtotal')}
                    totalLabel={t('accounting:clientsInvoices.total')}
                    discountRow={
                      totalDiscount > 0
                        ? {
                            label: t('accounting:clientsInvoices.totalDiscount'),
                            amount: totalDiscount,
                          }
                        : undefined
                    }
                    taxRow={{
                      label: t('accounting:clientsInvoices.taxTotal'),
                      amount: taxTotal,
                    }}
                    amountPaid={{
                      label: t('accounting:clientsInvoices.amountPaid'),
                      value: formData.amountPaid || 0,
                      onChange: (value) =>
                        setFormData((prev) => ({
                          ...prev,
                          amountPaid: value === '' ? 0 : Number(value),
                        })),
                    }}
                    balanceDue={{
                      label: t('accounting:clientsInvoices.balanceDue'),
                      amount: total - Number(formData.amountPaid || 0),
                    }}
                  />
                </div>
              </div>
            </ModalBody>

            <ModalFooter>
              <Button type="button" variant="outline" onClick={() => setIsModalOpen(false)}>
                {t('common:buttons.cancel')}
              </Button>
              <Button type="submit">{t('common:buttons.save')}</Button>
            </ModalFooter>
          </form>
        </ModalContent>
      </Modal>

      <DeleteConfirmModal
        isOpen={isDeleteConfirmOpen}
        onClose={() => setIsDeleteConfirmOpen(false)}
        onConfirm={handleDelete}
        title={t('accounting:clientsInvoices.deleteTitle')}
        description={t('accounting:clientsInvoices.deleteMessage', {
          invoiceNumber: invoiceToDelete?.id || '',
        })}
      />

      <div className="space-y-4">
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-2xl font-semibold text-zinc-800">
              {t('accounting:clientsInvoices.title')}
            </h2>
            <p className="text-sm text-zinc-500">{t('accounting:clientsInvoices.subtitle')}</p>
          </div>
          <HeaderAddButton onClick={openAddModal}>
            {t('accounting:clientsInvoices.addInvoice')}
          </HeaderAddButton>
        </div>
      </div>

      <StandardTable<Invoice>
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
