import type React from 'react';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type {
  Product,
  Supplier,
  SupplierOrderVersion,
  SupplierSaleOrder,
  SupplierSaleOrderItem,
} from '../../types';
import { formatInsertDateTime } from '../../utils/date';
import { formatDiscountValue } from '../../utils/numbers';
import { getPaymentTermsOptions } from '../../utils/options';
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
import SupplierOrderVersionsPanel from './SupplierOrderVersionsPanel';

const getOrderStatusLabel = (
  status: SupplierSaleOrder['status'],
  t: (key: string, options?: Record<string, unknown>) => string,
) => {
  if (status === 'sent') return t('accounting:supplierOrders.statusSent');
  return t('accounting:supplierOrders.statusDraft');
};

const getPaymentTermsLabel = (
  paymentTerms: SupplierSaleOrder['paymentTerms'],
  t: (key: string, options?: Record<string, unknown>) => string,
) => {
  if (paymentTerms === 'immediate') return t('crm:paymentTerms.immediate');
  return paymentTerms;
};

const calculateTotals = (
  items: SupplierSaleOrderItem[],
  globalDiscount: number,
  discountType: 'percentage' | 'currency' = 'percentage',
) => {
  let subtotal = 0;

  items.forEach((item) => {
    const lineSubtotal = Number(item.quantity ?? 0) * Number(item.unitPrice ?? 0);
    const lineDiscount = (lineSubtotal * Number(item.discount ?? 0)) / 100;
    const lineNet = lineSubtotal - lineDiscount;
    subtotal += lineNet;
  });

  const discountAmount =
    discountType === 'currency'
      ? Math.min(Math.max(globalDiscount, 0), subtotal)
      : subtotal * (globalDiscount / 100);
  const total = subtotal - discountAmount;

  return {
    subtotal,
    discountAmount,
    total,
  };
};

export interface SupplierOrdersViewProps {
  orders: SupplierSaleOrder[];
  suppliers: Supplier[];
  products: Product[];
  orderIdsWithInvoices: ReadonlySet<string>;
  onUpdateOrder: (id: string, updates: Partial<SupplierSaleOrder>) => void | Promise<void>;
  onDeleteOrder: (id: string) => void | Promise<void>;
  onCreateInvoice?: (order: SupplierSaleOrder) => void | Promise<void>;
  onViewQuote?: (quoteId: string) => void;
  onOrderRestored?: (order: SupplierSaleOrder) => void | Promise<void>;
  currency: string;
  quoteFilterId?: string | null;
}

const SupplierOrdersView: React.FC<SupplierOrdersViewProps> = ({
  orders,
  suppliers,
  products,
  orderIdsWithInvoices,
  onUpdateOrder,
  onDeleteOrder,
  onCreateInvoice,
  onViewQuote,
  onOrderRestored,
  currency,
  quoteFilterId,
}) => {
  const { t, i18n } = useTranslation(['accounting', 'sales', 'common', 'crm']);
  const paymentTermsOptions = useMemo(() => getPaymentTermsOptions(t), [t]);
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

  const [editingOrder, setEditingOrder] = useState<SupplierSaleOrder | null>(null);
  const [orderToDelete, setOrderToDelete] = useState<SupplierSaleOrder | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [previewVersion, setPreviewVersion] = useState<SupplierOrderVersion | null>(null);
  const [formData, setFormData] = useState<Partial<SupplierSaleOrder>>({
    linkedQuoteId: '',
    supplierId: '',
    supplierName: '',
    items: [],
    paymentTerms: 'immediate',
    discount: 0,
    discountType: 'percentage',
    status: 'draft',
    notes: '',
  });

  const baseReadOnly = Boolean(editingOrder && editingOrder.status !== 'draft');
  const isReadOnly = baseReadOnly || previewVersion !== null;

  const openEditModal = useCallback((order: SupplierSaleOrder) => {
    setEditingOrder(order);
    setFormData({
      ...order,
      items: order.items.map((item) => ({ ...item })),
    });
    setPreviewVersion(null);
    setIsModalOpen(true);
  }, []);

  const closeEditModal = useCallback(() => {
    setIsModalOpen(false);
    setPreviewVersion(null);
  }, []);

  const handleVersionPreview = useCallback((version: SupplierOrderVersion) => {
    setPreviewVersion(version);
    setFormData({
      ...version.snapshot.order,
      items: version.snapshot.items.map((item) => ({ ...item })),
    });
  }, []);

  const handleClearPreview = useCallback(() => {
    if (editingOrder) {
      setFormData({
        ...editingOrder,
        items: editingOrder.items.map((item) => ({ ...item })),
      });
    }
    setPreviewVersion(null);
  }, [editingOrder]);

  const handleVersionRestored = useCallback(
    async (updated: SupplierSaleOrder) => {
      setEditingOrder(updated);
      setFormData({
        ...updated,
        items: updated.items.map((item) => ({ ...item })),
      });
      setPreviewVersion(null);
      if (onOrderRestored) await onOrderRestored(updated);
    },
    [onOrderRestored],
  );

  const confirmDelete = useCallback((order: SupplierSaleOrder) => {
    setOrderToDelete(order);
    setIsDeleteConfirmOpen(true);
  }, []);

  const handleDelete = useCallback(async () => {
    if (!orderToDelete) return;
    await onDeleteOrder(orderToDelete.id);
    setIsDeleteConfirmOpen(false);
    setOrderToDelete(null);
  }, [onDeleteOrder, orderToDelete]);

  const updateItem = useCallback(
    (index: number, field: keyof SupplierSaleOrderItem, value: string | number) => {
      if (isReadOnly) return;

      setFormData((prev) => {
        const items = [...(prev.items || [])];
        const nextItem = { ...items[index], [field]: value };

        if (field === 'productId') {
          const product = products.find((item) => item.id === value);
          if (product) {
            nextItem.productName = product.name;
            nextItem.unitPrice = Number(product.costo);
          }
        }

        items[index] = nextItem;
        return { ...prev, items };
      });
    },
    [isReadOnly, products],
  );

  const removeItem = useCallback(
    (index: number) => {
      if (isReadOnly) return;
      setFormData((prev) => ({
        ...prev,
        items: (prev.items || []).filter((_, i) => i !== index),
      }));
    },
    [isReadOnly],
  );

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (!editingOrder) return;

      await onUpdateOrder(editingOrder.id, {
        ...formData,
        discount: Number(formData.discount ?? 0),
        items: (formData.items || []).map((item) => ({
          ...item,
          unitPrice: Number(item.unitPrice ?? 0),
          discount: Number(item.discount ?? 0),
        })),
      });

      setIsModalOpen(false);
    },
    [editingOrder, formData, onUpdateOrder],
  );

  const totals = useMemo(
    () =>
      calculateTotals(
        formData.items || [],
        Number(formData.discount || 0),
        formData.discountType || 'percentage',
      ),
    [formData.discount, formData.discountType, formData.items],
  );

  // Filter orders by quoteFilterId if provided
  const filteredOrders = useMemo(() => {
    if (quoteFilterId) {
      return orders.filter((o) => o.linkedQuoteId === quoteFilterId);
    }
    return orders;
  }, [orders, quoteFilterId]);

  const columns = useMemo(
    () => [
      {
        header: t('accounting:supplierOrders.orderNumber'),
        id: 'id',
        accessorFn: (row: SupplierSaleOrder) => row.id,
        cell: ({ row }: { row: SupplierSaleOrder }) => (
          <span className="font-bold text-zinc-700">{row.id}</span>
        ),
      },
      {
        header: t('accounting:supplierOrders.supplier'),
        id: 'supplierName',
        accessorFn: (row: SupplierSaleOrder) => row.supplierName,
        cell: ({ row }: { row: SupplierSaleOrder }) => {
          const isMuted = row.status === 'sent';

          return (
            <div>
              <div className={`font-bold ${isMuted ? 'text-zinc-400' : 'text-zinc-800'}`}>
                {row.supplierName}
              </div>
              <div className="font-mono text-[10px] font-black uppercase tracking-wider text-zinc-400">
                {row.linkedQuoteId || t('accounting:supplierOrders.noQuoteLink')}
              </div>
            </div>
          );
        },
      },
      {
        header: t('accounting:supplierOrders.total'),
        id: 'orderTotal',
        accessorFn: (row: SupplierSaleOrder) =>
          calculateTotals(row.items, row.discount, row.discountType).total,
        className: 'whitespace-nowrap',
        headerClassName: 'min-w-[8rem]',
        cell: ({ row }: { row: SupplierSaleOrder }) => {
          const { total } = calculateTotals(row.items, row.discount, row.discountType);
          const isMuted = row.status === 'sent';

          return (
            <span className={`text-sm font-bold ${isMuted ? 'text-zinc-400' : 'text-zinc-700'}`}>
              {total.toFixed(2)} {currency}
            </span>
          );
        },
        filterFormat: (value: unknown) => (value as number).toFixed(2),
      },
      {
        header: t('accounting:supplierOrders.paymentTerms'),
        id: 'paymentTerms',
        accessorFn: (row: SupplierSaleOrder) => getPaymentTermsLabel(row.paymentTerms, t),
        className: 'whitespace-nowrap',
        headerClassName: 'min-w-[10rem]',
        cell: ({ row }: { row: SupplierSaleOrder }) => {
          const isMuted = row.status === 'sent';

          return (
            <span
              className={`text-sm font-semibold ${isMuted ? 'text-zinc-400' : 'text-zinc-600'}`}
            >
              {getPaymentTermsLabel(row.paymentTerms, t)}
            </span>
          );
        },
      },
      {
        header: t('accounting:supplierOrders.status'),
        id: 'orderStatus',
        accessorFn: (row: SupplierSaleOrder) => getOrderStatusLabel(row.status, t),
        className: 'whitespace-nowrap',
        headerClassName: 'min-w-[9rem]',
        cell: ({ row }: { row: SupplierSaleOrder }) => (
          <div className={row.status === 'sent' ? 'opacity-60' : ''}>
            <StatusBadge
              type={row.status as StatusType}
              label={getOrderStatusLabel(row.status, t)}
            />
          </div>
        ),
      },
      {
        header: t('accounting:supplierOrders.actionsColumn'),
        id: 'actions',
        className: 'whitespace-nowrap',
        headerClassName: 'min-w-[9rem]',
        disableSorting: true,
        disableFiltering: true,
        align: 'right' as const,
        cell: ({ row }: { row: SupplierSaleOrder }) => {
          const hasInvoice = orderIdsWithInvoices.has(row.id);
          const isDraft = row.status === 'draft';

          return (
            <div className="flex justify-end gap-2">
              {onViewQuote && row.linkedQuoteId && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex">
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          const linkedQuoteId = row.linkedQuoteId;
                          if (!linkedQuoteId) return;
                          onViewQuote(linkedQuoteId);
                        }}
                        className="rounded-lg p-2 text-zinc-400 transition-all hover:bg-zinc-100 hover:text-praetor"
                      >
                        <i className="fa-solid fa-link"></i>
                      </button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{t('accounting:supplierOrders.viewQuote')}</TooltipContent>
                </Tooltip>
              )}
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
                      <i className={`fa-solid ${isDraft ? 'fa-pen-to-square' : 'fa-eye'}`}></i>
                    </button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {isDraft
                    ? t('accounting:supplierOrders.editOrder')
                    : t('accounting:supplierOrders.viewOrder')}
                </TooltipContent>
              </Tooltip>

              {row.status === 'draft' && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex">
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          void onUpdateOrder(row.id, { status: 'sent' });
                        }}
                        className="rounded-lg p-2 text-blue-700 transition-all hover:bg-blue-50 hover:text-blue-600"
                      >
                        <i className="fa-solid fa-paper-plane"></i>
                      </button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{t('accounting:supplierOrders.markSent')}</TooltipContent>
                </Tooltip>
              )}

              {row.status === 'sent' && !hasInvoice && onCreateInvoice && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex">
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          void onCreateInvoice(row);
                        }}
                        className="rounded-lg p-2 text-zinc-400 transition-all hover:bg-zinc-100 hover:text-praetor"
                      >
                        <i className="fa-solid fa-file-invoice-dollar"></i>
                      </button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{t('accounting:supplierOrders.createInvoice')}</TooltipContent>
                </Tooltip>
              )}

              {row.status === 'draft' && (
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
              )}
            </div>
          );
        },
      },
    ],
    [
      confirmDelete,
      currency,
      onCreateInvoice,
      onUpdateOrder,
      onViewQuote,
      openEditModal,
      orderIdsWithInvoices,
      t,
    ],
  );

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <Modal isOpen={isModalOpen} onClose={closeEditModal}>
        <div className="flex max-w-[calc(100vw-2rem)] items-start gap-4">
          <ModalContent size="full" className="max-h-[90vh]">
            <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
              <ModalHeader>
                <ModalTitle className="gap-3">
                  <span className="flex size-10 items-center justify-center rounded-md bg-muted text-primary">
                    <i
                      className={`fa-solid ${isReadOnly ? 'fa-eye' : 'fa-pen-to-square'}`}
                      aria-hidden="true"
                    ></i>
                  </span>
                  {t('accounting:supplierOrders.editOrder')}
                </ModalTitle>
                <ModalCloseButton onClick={closeEditModal} />
              </ModalHeader>

              <ModalBody className="flex-1 space-y-5">
                {previewVersion && (
                  <div className="flex items-center justify-between gap-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-3">
                    <span className="flex items-center gap-2 text-xs font-medium text-amber-700 dark:text-amber-300">
                      <i className="fa-solid fa-clock-rotate-left" aria-hidden="true"></i>
                      {t('accounting:supplierOrders.versionHistory.previewBanner', {
                        date: formatInsertDateTime(previewVersion.createdAt, i18n.language),
                      })}
                    </span>
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      onClick={handleClearPreview}
                      className="h-auto px-0 text-amber-700 dark:text-amber-300"
                    >
                      {t('accounting:supplierOrders.versionHistory.backToCurrent')}
                    </Button>
                  </div>
                )}
                {baseReadOnly && (
                  <div className="flex items-center gap-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-3">
                    <span className="text-xs font-medium text-amber-700 dark:text-amber-300">
                      {t('accounting:supplierOrders.readOnlyStatus')}
                    </span>
                  </div>
                )}

                {/* Linked Quote Info */}
                {formData.linkedQuoteId && (
                  <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 p-4">
                    <div className="flex items-center gap-3">
                      <div className="flex size-8 items-center justify-center rounded-md bg-muted text-primary">
                        <i className="fa-solid fa-link" aria-hidden="true"></i>
                      </div>
                      <div>
                        <div className="text-sm font-medium text-foreground">
                          {t('accounting:supplierOrders.linkedQuote')}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {t('accounting:supplierOrders.linkedQuoteInfo', {
                            number: formData.linkedQuoteId,
                          })}
                        </div>
                        <div className="mt-0.5 text-[10px] text-muted-foreground">
                          {t('accounting:supplierOrders.quoteDetailsReadOnly')}
                        </div>
                      </div>
                    </div>
                    {onViewQuote && (
                      <Button
                        type="button"
                        variant="link"
                        size="sm"
                        onClick={() => {
                          const linkedQuoteId = formData.linkedQuoteId;
                          if (!linkedQuoteId) return;
                          onViewQuote(linkedQuoteId);
                        }}
                        className="px-0"
                      >
                        {t('accounting:supplierOrders.viewQuote')}
                      </Button>
                    )}
                  </div>
                )}

                <div className="space-y-2">
                  <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-primary">
                    <span className="size-1.5 rounded-full bg-primary"></span>
                    {t('accounting:supplierOrders.orderDetails')}
                  </h4>
                  <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                    <Field>
                      <SelectControl
                        id="supplier-order-supplier"
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
                        disabled={isReadOnly}
                        label={t('accounting:supplierOrders.supplier')}
                        buttonClassName="h-9"
                      />
                    </Field>
                    <Field>
                      <FieldLabel>{t('accounting:supplierOrders.orderNumber')}</FieldLabel>
                      <div className="flex h-9 items-center rounded-md border border-border bg-muted/30 px-3 text-sm font-medium text-foreground">
                        {editingOrder?.id || '-'}
                      </div>
                    </Field>
                    <Field>
                      <SelectControl
                        id="supplier-order-payment-terms"
                        options={paymentTermsOptions}
                        value={formData.paymentTerms || 'immediate'}
                        onChange={(value) =>
                          setFormData((prev) => ({
                            ...prev,
                            paymentTerms: value as SupplierSaleOrder['paymentTerms'],
                          }))
                        }
                        searchable={false}
                        disabled={isReadOnly}
                        label={t('accounting:supplierOrders.paymentTerms')}
                        buttonClassName="h-9"
                      />
                    </Field>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-primary">
                      <span className="size-1.5 rounded-full bg-primary"></span>
                      {t('accounting:supplierOrders.items')}
                    </h4>
                  </div>

                  {(formData.items || []).length > 0 && (
                    <div className="mb-1 hidden items-center gap-2 px-3 lg:flex">
                      <div className="grid flex-1 grid-cols-12 gap-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        <div className="col-span-3 ml-1">{t('crm:quotes.productsServices')}</div>
                        <div className="col-span-1">{t('common:labels.quantity')}</div>
                        <div className="col-span-2">
                          {t('crm:internalListing.salePrice')} ({currency})
                        </div>
                        <div className="col-span-1">{t('accounting:supplierOrders.discount')}</div>
                        <div className="col-span-2">{t('accounting:supplierOrders.notes')}</div>
                        <div className="col-span-2 pr-2 text-right">{t('common:labels.total')}</div>
                      </div>
                      <div className="w-8 shrink-0"></div>
                    </div>
                  )}

                  {(formData.items || []).length > 0 ? (
                    <div className="space-y-3">
                      {formData.items?.map((item, index) => {
                        const lineSubtotal =
                          Number(item.quantity ?? 0) * Number(item.unitPrice ?? 0);
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
                                value={item.productId}
                                onChange={(value) =>
                                  updateItem(index, 'productId', value as string)
                                }
                                searchable={true}
                                disabled={isReadOnly}
                                buttonClassName="h-9"
                              />
                              <div className="grid grid-cols-2 gap-2">
                                <div className="space-y-1">
                                  <FieldLabel className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                                    {t('common:labels.quantity')}
                                  </FieldLabel>
                                  <ValidatedNumberInput
                                    value={item.quantity}
                                    disabled={isReadOnly}
                                    onValueChange={(value) =>
                                      updateItem(
                                        index,
                                        'quantity',
                                        value === '' ? 0 : Number(value),
                                      )
                                    }
                                    className="text-center"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <FieldLabel className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                                    {t('crm:internalListing.salePrice')}
                                  </FieldLabel>
                                  <ValidatedNumberInput
                                    value={item.unitPrice}
                                    formatDecimals={2}
                                    disabled={isReadOnly}
                                    onValueChange={(value) =>
                                      updateItem(
                                        index,
                                        'unitPrice',
                                        value === '' ? 0 : Number(value),
                                      )
                                    }
                                    className="text-center"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <FieldLabel className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                                    {t('accounting:supplierOrders.discount')}
                                  </FieldLabel>
                                  <ValidatedNumberInput
                                    value={item.discount || 0}
                                    formatDecimals={2}
                                    disabled={isReadOnly}
                                    onValueChange={(value) =>
                                      updateItem(
                                        index,
                                        'discount',
                                        value === '' ? 0 : Number(value),
                                      )
                                    }
                                    className="text-center"
                                  />
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
                              <Input
                                type="text"
                                value={item.note || ''}
                                disabled={isReadOnly}
                                placeholder={t('accounting:supplierOrders.notes')}
                                onChange={(event) => updateItem(index, 'note', event.target.value)}
                              />
                              <div className="flex justify-end">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon-sm"
                                  onClick={() => removeItem(index)}
                                  disabled={isReadOnly}
                                  className="text-muted-foreground hover:text-destructive"
                                >
                                  <i className="fa-solid fa-trash-can" aria-hidden="true"></i>
                                  <span className="sr-only">{t('common:buttons.delete')}</span>
                                </Button>
                              </div>
                            </div>
                            <div className="hidden lg:flex items-start gap-2">
                              <div className="grid flex-1 grid-cols-12 gap-2">
                                <div className="lg:col-span-3 min-w-0">
                                  <SelectControl
                                    options={productOptions}
                                    value={item.productId}
                                    onChange={(value) =>
                                      updateItem(index, 'productId', value as string)
                                    }
                                    searchable={true}
                                    disabled={isReadOnly}
                                    buttonClassName="h-9"
                                  />
                                </div>
                                <div className="lg:col-span-1">
                                  <ValidatedNumberInput
                                    value={item.quantity}
                                    disabled={isReadOnly}
                                    onValueChange={(value) =>
                                      updateItem(
                                        index,
                                        'quantity',
                                        value === '' ? 0 : Number(value),
                                      )
                                    }
                                    className="font-medium"
                                  />
                                </div>
                                <div className="lg:col-span-2">
                                  <ValidatedNumberInput
                                    value={item.unitPrice}
                                    formatDecimals={2}
                                    disabled={isReadOnly}
                                    onValueChange={(value) =>
                                      updateItem(
                                        index,
                                        'unitPrice',
                                        value === '' ? 0 : Number(value),
                                      )
                                    }
                                    className="font-medium"
                                  />
                                </div>
                                <div className="lg:col-span-1">
                                  <ValidatedNumberInput
                                    value={item.discount || 0}
                                    formatDecimals={2}
                                    disabled={isReadOnly}
                                    onValueChange={(value) =>
                                      updateItem(
                                        index,
                                        'discount',
                                        value === '' ? 0 : Number(value),
                                      )
                                    }
                                    className="font-medium"
                                  />
                                </div>
                                <div className="lg:col-span-2">
                                  <Input
                                    type="text"
                                    value={item.note || ''}
                                    disabled={isReadOnly}
                                    onChange={(event) =>
                                      updateItem(index, 'note', event.target.value)
                                    }
                                  />
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
                                disabled={isReadOnly}
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
                      {t('accounting:supplierOrders.noItemsAdded')}
                    </div>
                  )}
                </div>

                <div className="flex flex-col gap-4 border-t border-border pt-4 md:flex-row">
                  <Field className="md:w-2/3">
                    <FieldLabel htmlFor="supplier-order-notes">
                      {t('accounting:supplierOrders.notes')}
                    </FieldLabel>
                    <Textarea
                      id="supplier-order-notes"
                      rows={4}
                      value={formData.notes || ''}
                      disabled={isReadOnly}
                      onChange={(event) =>
                        setFormData((prev) => ({ ...prev, notes: event.target.value }))
                      }
                      className="min-h-28 resize-none"
                    />
                  </Field>

                  <div className="space-y-2 md:w-1/3">
                    <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-primary">
                      <span className="size-1.5 rounded-full bg-primary"></span>
                      {t('accounting:supplierOrders.summary', { defaultValue: 'Summary' })}
                    </h4>
                    <CostSummaryPanel
                      currency={currency}
                      subtotal={totals.subtotal}
                      total={totals.total}
                      subtotalLabel={t('accounting:supplierOrders.subtotal')}
                      totalLabel={t('accounting:supplierOrders.total')}
                      globalDiscount={{
                        label: t('accounting:supplierOrders.discount'),
                        value: formData.discount || 0,
                        type: formData.discountType || 'percentage',
                        onChange: (value) =>
                          setFormData((prev) => ({
                            ...prev,
                            discount: value === '' ? 0 : Number(value),
                          })),
                        onTypeChange: (type) =>
                          setFormData((prev) => ({ ...prev, discountType: type })),
                        disabled: isReadOnly,
                      }}
                      discountRow={
                        totals.discountAmount > 0
                          ? {
                              label: t('sales:clientOffers.discountAmount', {
                                value: formatDiscountValue(
                                  formData.discount ?? 0,
                                  formData.discountType ?? 'percentage',
                                  currency,
                                ),
                              }),
                              amount: totals.discountAmount,
                            }
                          : undefined
                      }
                    />
                  </div>
                </div>
              </ModalBody>

              <ModalFooter>
                <Button type="button" variant="outline" onClick={closeEditModal}>
                  {t('common:buttons.cancel')}
                </Button>
                {!isReadOnly && <Button type="submit">{t('common:buttons.update')}</Button>}
              </ModalFooter>
            </form>
          </ModalContent>
          {editingOrder?.id && (
            <SupplierOrderVersionsPanel
              orderId={editingOrder.id}
              selectedVersionId={previewVersion?.id ?? null}
              onPreview={handleVersionPreview}
              onClearPreview={handleClearPreview}
              onRestored={handleVersionRestored}
              disabled={baseReadOnly}
            />
          )}
        </div>
      </Modal>

      <DeleteConfirmModal
        isOpen={isDeleteConfirmOpen}
        onClose={() => setIsDeleteConfirmOpen(false)}
        onConfirm={() => {
          void handleDelete();
        }}
        title={t('accounting:supplierOrders.deleteTitle')}
        description={`${orderToDelete?.supplierName ?? ''} · ${
          orderToDelete?.linkedQuoteId || orderToDelete?.id || ''
        }`}
      />

      <div className="space-y-4">
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-2xl font-semibold text-zinc-800">
              {t('accounting:supplierOrders.title')}
            </h2>
            <p className="text-sm text-zinc-500">{t('accounting:supplierOrders.subtitle')}</p>
          </div>
        </div>
      </div>

      <StandardTable<SupplierSaleOrder>
        title={t('accounting:supplierOrders.title')}
        data={filteredOrders}
        columns={columns}
        defaultRowsPerPage={10}
        containerClassName="overflow-visible"
        rowClassName={(row: SupplierSaleOrder) =>
          row.status === 'sent' ? 'bg-zinc-50 text-zinc-400' : 'hover:bg-zinc-50/50'
        }
        onRowClick={(row: SupplierSaleOrder) => openEditModal(row)}
      />
    </div>
  );
};

export default SupplierOrdersView;
