import type React from 'react';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Product, Supplier, SupplierSaleOrder, SupplierSaleOrderItem } from '../../types';
import { roundToTwoDecimals } from '../../utils/numbers';
import CustomSelect from '../shared/CustomSelect';
import Modal from '../shared/Modal';
import StandardTable from '../shared/StandardTable';
import StatusBadge, { type StatusType } from '../shared/StatusBadge';
import Tooltip from '../shared/Tooltip';
import ValidatedNumberInput from '../shared/ValidatedNumberInput';

const getPaymentTermsOptions = (t: (key: string, options?: Record<string, unknown>) => string) => [
  { id: 'immediate', name: t('crm:paymentTerms.immediate') },
  { id: '15gg', name: t('crm:paymentTerms.15gg') },
  { id: '21gg', name: t('crm:paymentTerms.21gg') },
  { id: '30gg', name: t('crm:paymentTerms.30gg') },
  { id: '45gg', name: t('crm:paymentTerms.45gg') },
  { id: '60gg', name: t('crm:paymentTerms.60gg') },
  { id: '90gg', name: t('crm:paymentTerms.90gg') },
  { id: '120gg', name: t('crm:paymentTerms.120gg') },
  { id: '180gg', name: t('crm:paymentTerms.180gg') },
  { id: '240gg', name: t('crm:paymentTerms.240gg') },
  { id: '365gg', name: t('crm:paymentTerms.365gg') },
];

const getStatusOptions = (t: (key: string, options?: Record<string, unknown>) => string) => [
  { id: 'draft', name: t('accounting:supplierOrders.statusDraft') },
  { id: 'sent', name: t('accounting:supplierOrders.statusSent') },
  { id: 'confirmed', name: t('accounting:supplierOrders.statusConfirmed') },
  { id: 'denied', name: t('accounting:supplierOrders.statusDenied') },
];

const getOrderStatusLabel = (
  status: SupplierSaleOrder['status'],
  t: (key: string, options?: Record<string, unknown>) => string,
) => {
  if (status === 'sent') return t('accounting:supplierOrders.statusSent');
  if (status === 'confirmed') return t('accounting:supplierOrders.statusConfirmed');
  if (status === 'denied') return t('accounting:supplierOrders.statusDenied');
  return t('accounting:supplierOrders.statusDraft');
};

const getPaymentTermsLabel = (
  paymentTerms: SupplierSaleOrder['paymentTerms'],
  t: (key: string, options?: Record<string, unknown>) => string,
) => {
  if (paymentTerms === 'immediate') return t('crm:paymentTerms.immediate');
  return paymentTerms;
};

const calculateTotals = (items: SupplierSaleOrderItem[], globalDiscount: number) => {
  let subtotal = 0;
  let taxAmount = 0;

  items.forEach((item) => {
    const lineSubtotal = Number(item.quantity ?? 0) * Number(item.unitPrice ?? 0);
    const lineDiscount = (lineSubtotal * Number(item.discount ?? 0)) / 100;
    const lineNet = lineSubtotal - lineDiscount;
    subtotal += lineNet;
    taxAmount += lineNet * (1 - globalDiscount / 100) * (Number(item.productTaxRate ?? 0) / 100);
  });

  const discountAmount = subtotal * (globalDiscount / 100);
  const taxableAmount = subtotal - discountAmount;
  const total = taxableAmount + taxAmount;

  return {
    subtotal,
    discountAmount,
    taxableAmount,
    taxAmount,
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
  currency,
  quoteFilterId,
}) => {
  const { t } = useTranslation(['accounting', 'sales', 'common', 'crm']);
  const paymentTermsOptions = useMemo(() => getPaymentTermsOptions(t), [t]);
  const statusOptions = useMemo(() => getStatusOptions(t), [t]);
  const activeSuppliers = useMemo(
    () => suppliers.filter((supplier) => !supplier.isDisabled),
    [suppliers],
  );
  const activeProducts = useMemo(
    () => products.filter((product) => !product.isDisabled),
    [products],
  );

  const [editingOrder, setEditingOrder] = useState<SupplierSaleOrder | null>(null);
  const [orderToDelete, setOrderToDelete] = useState<SupplierSaleOrder | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [formData, setFormData] = useState<Partial<SupplierSaleOrder>>({
    linkedQuoteId: '',
    supplierId: '',
    supplierName: '',
    items: [],
    paymentTerms: 'immediate',
    discount: 0,
    status: 'draft',
    notes: '',
  });

  const isReadOnly = Boolean(editingOrder && editingOrder.status !== 'draft');

  const openEditModal = useCallback((order: SupplierSaleOrder) => {
    setEditingOrder(order);
    setFormData({
      ...order,
      items: order.items.map((item) => ({ ...item })),
    });
    setIsModalOpen(true);
  }, []);

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
            nextItem.productTaxRate = Number(product.taxRate ?? 0);
          }
        }

        items[index] = nextItem;
        return { ...prev, items };
      });
    },
    [isReadOnly, products],
  );

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (!editingOrder) return;

      await onUpdateOrder(editingOrder.id, {
        ...formData,
        discount: roundToTwoDecimals(Number(formData.discount ?? 0)),
        items: (formData.items || []).map((item) => ({
          ...item,
          unitPrice: roundToTwoDecimals(Number(item.unitPrice ?? 0)),
          productTaxRate: roundToTwoDecimals(Number(item.productTaxRate ?? 0)),
          discount: roundToTwoDecimals(Number(item.discount ?? 0)),
        })),
      });

      setIsModalOpen(false);
    },
    [editingOrder, formData, onUpdateOrder],
  );

  const totals = useMemo(
    () => calculateTotals(formData.items || [], Number(formData.discount || 0)),
    [formData.discount, formData.items],
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
        header: t('accounting:supplierOrders.orderNumber', { defaultValue: 'Order Number' }),
        id: 'id',
        accessorFn: (row: SupplierSaleOrder) => row.id,
        cell: ({ row }: { row: SupplierSaleOrder }) => (
          <span className="font-bold text-slate-700">{row.id}</span>
        ),
      },
      {
        header: t('accounting:supplierOrders.supplier'),
        id: 'supplierName',
        accessorFn: (row: SupplierSaleOrder) => row.supplierName,
        cell: ({ row }: { row: SupplierSaleOrder }) => {
          const isMuted = row.status === 'confirmed' || row.status === 'denied';

          return (
            <div>
              <div className={`font-bold ${isMuted ? 'text-slate-400' : 'text-slate-800'}`}>
                {row.supplierName}
              </div>
              <div className="font-mono text-[10px] font-black uppercase tracking-wider text-slate-400">
                {row.linkedQuoteId ||
                  t('accounting:supplierOrders.noQuoteLink', {
                    defaultValue: 'No quote link',
                  })}
              </div>
            </div>
          );
        },
      },
      {
        header: t('accounting:supplierOrders.total'),
        id: 'orderTotal',
        accessorFn: (row: SupplierSaleOrder) => calculateTotals(row.items, row.discount).total,
        className: 'whitespace-nowrap',
        headerClassName: 'min-w-[8rem]',
        cell: ({ row }: { row: SupplierSaleOrder }) => {
          const { total } = calculateTotals(row.items, row.discount);
          const isMuted = row.status === 'confirmed' || row.status === 'denied';

          return (
            <span className={`text-sm font-bold ${isMuted ? 'text-slate-400' : 'text-slate-700'}`}>
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
          const isMuted = row.status === 'confirmed' || row.status === 'denied';

          return (
            <span
              className={`text-sm font-semibold ${isMuted ? 'text-slate-400' : 'text-slate-600'}`}
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
          <div
            className={row.status === 'confirmed' || row.status === 'denied' ? 'opacity-60' : ''}
          >
            <StatusBadge
              type={row.status as StatusType}
              label={getOrderStatusLabel(row.status, t)}
            />
          </div>
        ),
      },
      {
        header: t('common:common.more'),
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
                <Tooltip label={t('accounting:supplierOrders.viewQuote')}>
                  {() => (
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        const linkedQuoteId = row.linkedQuoteId;
                        if (!linkedQuoteId) return;
                        onViewQuote(linkedQuoteId);
                      }}
                      className="rounded-lg p-2 text-slate-400 transition-all hover:bg-slate-100 hover:text-praetor"
                    >
                      <i className="fa-solid fa-link"></i>
                    </button>
                  )}
                </Tooltip>
              )}
              <Tooltip
                label={
                  isDraft
                    ? t('accounting:supplierOrders.editOrder')
                    : t('accounting:supplierOrders.viewOrder')
                }
              >
                {() => (
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      openEditModal(row);
                    }}
                    className="rounded-lg p-2 text-slate-400 transition-all hover:bg-slate-100 hover:text-praetor"
                  >
                    <i className={`fa-solid ${isDraft ? 'fa-pen-to-square' : 'fa-eye'}`}></i>
                  </button>
                )}
              </Tooltip>

              {row.status === 'draft' && (
                <Tooltip label={t('accounting:supplierOrders.markSent')}>
                  {() => (
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        void onUpdateOrder(row.id, { status: 'sent' });
                      }}
                      className="rounded-lg p-2 text-slate-400 transition-all hover:bg-blue-50 hover:text-blue-600"
                    >
                      <i className="fa-solid fa-paper-plane"></i>
                    </button>
                  )}
                </Tooltip>
              )}

              {row.status === 'sent' && (
                <>
                  <Tooltip label={t('accounting:supplierOrders.markConfirmed')}>
                    {() => (
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          void onUpdateOrder(row.id, { status: 'confirmed' });
                        }}
                        className="rounded-lg p-2 text-slate-400 transition-all hover:bg-emerald-50 hover:text-emerald-600"
                      >
                        <i className="fa-solid fa-check"></i>
                      </button>
                    )}
                  </Tooltip>
                  <Tooltip label={t('accounting:supplierOrders.markDenied')}>
                    {() => (
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          void onUpdateOrder(row.id, { status: 'denied' });
                        }}
                        className="rounded-lg p-2 text-slate-400 transition-all hover:bg-red-50 hover:text-red-600"
                      >
                        <i className="fa-solid fa-xmark"></i>
                      </button>
                    )}
                  </Tooltip>
                </>
              )}

              {row.status === 'confirmed' && !hasInvoice && onCreateInvoice && (
                <Tooltip label={t('accounting:supplierOrders.createInvoice')}>
                  {() => (
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        void onCreateInvoice(row);
                      }}
                      className="rounded-lg p-2 text-slate-400 transition-all hover:bg-slate-100 hover:text-praetor"
                    >
                      <i className="fa-solid fa-file-invoice-dollar"></i>
                    </button>
                  )}
                </Tooltip>
              )}

              {row.status === 'draft' && (
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
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)}>
        <div className="flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl animate-in zoom-in duration-200">
          <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/50 p-6">
            <h3 className="flex items-center gap-3 text-xl font-black text-slate-800">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-praetor">
                <i className={`fa-solid ${isReadOnly ? 'fa-eye' : 'fa-pen-to-square'}`}></i>
              </div>
              {t('accounting:supplierOrders.editOrder', { defaultValue: 'Supplier Order' })}
            </h3>
            <button
              onClick={() => setIsModalOpen(false)}
              className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-400 transition-colors hover:bg-slate-100"
            >
              <i className="fa-solid fa-xmark text-lg"></i>
            </button>
          </div>

          <form onSubmit={handleSubmit} className="flex-1 space-y-8 overflow-y-auto p-8">
            {isReadOnly && (
              <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                <span className="text-xs font-bold text-amber-700">
                  {t('accounting:supplierOrders.readOnlyStatus', {
                    defaultValue:
                      'Non-draft orders are read-only. Change status from the list actions.',
                  })}
                </span>
              </div>
            )}

            {/* Linked Quote Info */}
            {formData.linkedQuoteId && (
              <div className="bg-slate-50 border border-slate-100 rounded-xl p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center text-praetor">
                    <i className="fa-solid fa-link"></i>
                  </div>
                  <div>
                    <div className="text-sm font-bold text-slate-900">
                      {t('accounting:supplierOrders.linkedQuote')}
                    </div>
                    <div className="text-xs text-praetor">
                      {t('accounting:supplierOrders.linkedQuoteInfo', {
                        number: formData.linkedQuoteId,
                      })}
                    </div>
                    <div className="text-[10px] text-slate-400 mt-0.5">
                      {t('accounting:supplierOrders.quoteDetailsReadOnly')}
                    </div>
                  </div>
                </div>
                {onViewQuote && (
                  <button
                    type="button"
                    onClick={() => {
                      const linkedQuoteId = formData.linkedQuoteId;
                      if (!linkedQuoteId) return;
                      onViewQuote(linkedQuoteId);
                    }}
                    className="text-xs font-bold text-praetor hover:text-slate-800 hover:underline"
                  >
                    {t('accounting:supplierOrders.viewQuote')}
                  </button>
                )}
              </div>
            )}

            <div className="space-y-4">
              <h4 className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-praetor">
                <span className="h-1.5 w-1.5 rounded-full bg-praetor"></span>
                {t('accounting:clientsInvoices.invoiceDetails')}
              </h4>
              <div className="space-y-6">
                <div className="grid grid-cols-1 gap-6 md:grid-cols-4">
                  <div className="space-y-1.5">
                    <label className="ml-1 text-xs font-bold text-slate-500">
                      {t('accounting:supplierOrders.supplier')}
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
                      disabled={isReadOnly}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="ml-1 text-xs font-bold text-slate-500">
                      {t('accounting:supplierOrders.paymentTerms')}
                    </label>
                    <CustomSelect
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
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="ml-1 text-xs font-bold text-slate-500">
                      {t('accounting:supplierOrders.status')}
                    </label>
                    <CustomSelect
                      options={statusOptions}
                      value={formData.status || 'draft'}
                      onChange={(value) =>
                        setFormData((prev) => ({
                          ...prev,
                          status: value as SupplierSaleOrder['status'],
                        }))
                      }
                      searchable={false}
                      disabled={isReadOnly}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="ml-1 text-xs font-bold text-slate-500">
                      {t('accounting:supplierOrders.discount')}
                    </label>
                    <div
                      className={`overflow-hidden rounded-xl border border-slate-200 bg-slate-50 transition-all focus-within:ring-2 focus-within:ring-praetor ${isReadOnly ? 'opacity-60' : ''}`}
                    >
                      <div className="flex items-center">
                        <div className="flex w-12 items-center justify-center self-stretch border-r border-slate-200 bg-slate-100/30 text-xs font-bold text-slate-400">
                          %
                        </div>
                        <ValidatedNumberInput
                          value={formData.discount || 0}
                          disabled={isReadOnly}
                          onValueChange={(value) =>
                            setFormData((prev) => ({
                              ...prev,
                              discount: value === '' ? 0 : Number(value),
                            }))
                          }
                          className="flex-1 bg-transparent px-4 py-2.5 text-sm font-semibold outline-none disabled:bg-transparent disabled:text-slate-400"
                        />
                      </div>
                    </div>
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
                    <div className="col-span-3 ml-1">{t('crm:quotes.productsServices')}</div>
                    <div className="col-span-1">{t('common:labels.quantity')}</div>
                    <div className="col-span-2">
                      {t('crm:internalListing.salePrice')} ({currency})
                    </div>
                    <div className="col-span-1">{t('accounting:clientsInvoices.vat')}</div>
                    <div className="col-span-1">{t('accounting:supplierOrders.discount')}</div>
                    <div className="col-span-2">{t('accounting:supplierOrders.notes')}</div>
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
                            <div className="space-y-1 md:col-span-3 min-w-0">
                              <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 md:hidden">
                                {t('crm:quotes.productsServices')}
                              </label>
                              <CustomSelect
                                options={activeProducts.map((product) => ({
                                  id: product.id,
                                  name: product.name,
                                }))}
                                value={item.productId}
                                onChange={(value) =>
                                  updateItem(index, 'productId', value as string)
                                }
                                searchable={true}
                                disabled={isReadOnly}
                                buttonClassName="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                              />
                            </div>

                            <div className="space-y-1 md:col-span-1">
                              <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 md:hidden">
                                {t('crm:quotes.qty')}
                              </label>
                              <ValidatedNumberInput
                                value={item.quantity}
                                disabled={isReadOnly}
                                onValueChange={(value) =>
                                  updateItem(index, 'quantity', value === '' ? 0 : Number(value))
                                }
                                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none disabled:bg-slate-50 disabled:text-slate-400"
                              />
                            </div>

                            <div className="space-y-1 md:col-span-2">
                              <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 md:hidden">
                                {t('crm:internalListing.salePrice')} ({currency})
                              </label>
                              <ValidatedNumberInput
                                value={item.unitPrice}
                                disabled={isReadOnly}
                                onValueChange={(value) =>
                                  updateItem(index, 'unitPrice', value === '' ? 0 : Number(value))
                                }
                                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none disabled:bg-slate-50 disabled:text-slate-400"
                              />
                            </div>

                            <div className="space-y-1 md:col-span-1">
                              <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 md:hidden">
                                {t('accounting:clientsInvoices.vat')}
                              </label>
                              <div className="flex min-h-[42px] items-center px-3 py-2 text-sm text-slate-500">
                                {Number(item.productTaxRate ?? 0).toFixed(0)}%
                              </div>
                            </div>

                            <div className="space-y-1 md:col-span-1">
                              <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 md:hidden">
                                {t('accounting:supplierOrders.discount')}
                              </label>
                              <ValidatedNumberInput
                                value={item.discount || 0}
                                disabled={isReadOnly}
                                onValueChange={(value) =>
                                  updateItem(index, 'discount', value === '' ? 0 : Number(value))
                                }
                                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none disabled:bg-slate-50 disabled:text-slate-400"
                              />
                            </div>

                            <div className="space-y-1 md:col-span-2">
                              <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 md:hidden">
                                {t('accounting:supplierOrders.notes')}
                              </label>
                              <input
                                type="text"
                                value={item.note || ''}
                                disabled={isReadOnly}
                                onChange={(event) => updateItem(index, 'note', event.target.value)}
                                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none disabled:bg-slate-50 disabled:text-slate-400"
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
                  {t('accounting:supplierOrders.noItemsAdded', {
                    defaultValue: 'No items added yet',
                  })}
                </div>
              )}
            </div>

            <div className="flex flex-col gap-8 border-t border-slate-100 pt-6 md:flex-row">
              <div className="w-full space-y-4 md:w-2/3">
                <h4 className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-praetor">
                  <span className="h-1.5 w-1.5 rounded-full bg-praetor"></span>
                  {t('accounting:supplierOrders.notes')}
                </h4>
                <textarea
                  rows={4}
                  value={formData.notes || ''}
                  disabled={isReadOnly}
                  onChange={(event) =>
                    setFormData((prev) => ({ ...prev, notes: event.target.value }))
                  }
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm outline-none disabled:bg-slate-50 disabled:text-slate-400"
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
                    {totals.subtotal.toFixed(2)} {currency}
                  </span>
                </div>
                {Number(formData.discount || 0) > 0 && (
                  <div className="flex justify-between">
                    <span className="text-sm font-bold text-slate-500">
                      {t('crm:quotes.discountAmount', {
                        discount: Number(formData.discount || 0),
                      })}
                    </span>
                    <span className="text-sm font-bold text-amber-600">
                      -{totals.discountAmount.toFixed(2)} {currency}
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
                    {t('accounting:supplierOrders.total')}
                  </span>
                  <span className="text-lg font-black text-praetor">
                    {totals.total.toFixed(2)} {currency}
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
              {!isReadOnly && (
                <button
                  type="submit"
                  className="rounded-xl bg-praetor px-8 py-3 font-bold text-white shadow-lg shadow-slate-200 transition-all hover:bg-slate-700 active:scale-95"
                >
                  {t('common:buttons.update')}
                </button>
              )}
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
                {t('accounting:supplierOrders.deleteTitle', {
                  defaultValue: 'Delete supplier order?',
                })}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-500">
                {orderToDelete?.supplierName} · {orderToDelete?.linkedQuoteId || orderToDelete?.id}
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
              {t('accounting:supplierOrders.title', { defaultValue: 'Supplier Orders' })}
            </h2>
            <p className="text-sm text-slate-500">
              {t('accounting:supplierOrders.subtitle', {
                defaultValue: 'Orders created from supplier quotes.',
              })}
            </p>
          </div>
        </div>
      </div>

      <StandardTable<SupplierSaleOrder>
        title={t('accounting:supplierOrders.title', { defaultValue: 'Supplier Orders' })}
        data={filteredOrders}
        columns={columns}
        defaultRowsPerPage={10}
        containerClassName="overflow-visible"
        rowClassName={(row: SupplierSaleOrder) =>
          row.status === 'confirmed' || row.status === 'denied'
            ? 'bg-slate-50 text-slate-400'
            : 'hover:bg-slate-50/50'
        }
        onRowClick={(row: SupplierSaleOrder) => openEditModal(row)}
      />
    </div>
  );
};

export default SupplierOrdersView;
