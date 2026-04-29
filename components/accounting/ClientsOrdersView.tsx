import type { TFunction } from 'i18next';
import type React from 'react';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  Client,
  ClientsOrder,
  ClientsOrderItem,
  Product,
  SupplierUnitType,
} from '../../types';
import {
  addDaysToDateOnly,
  formatDateOnlyForLocale,
  formatInsertDate,
  getLocalDateString,
} from '../../utils/date';
import {
  calcProductSalePrice,
  calculatePricingTotals,
  convertUnitPrice,
  formatDiscountValue,
  getItemPricingContext,
  type PricingTotals,
  parseNumberInputValue,
} from '../../utils/numbers';
import { getPaymentTermsOptions } from '../../utils/options';
import { makeCostUpdater, makeMolUpdater } from '../../utils/pricingHandlers';
import CostSummaryPanel from '../shared/CostSummaryPanel';
import CustomSelect from '../shared/CustomSelect';
import Modal from '../shared/Modal';
import StandardTable from '../shared/StandardTable';
import StatusBadge, { type StatusType } from '../shared/StatusBadge';
import Tooltip from '../shared/Tooltip';
import UnitTypeSelector from '../shared/UnitTypeSelector';
import ValidatedNumberInput from '../shared/ValidatedNumberInput';

export interface ClientsOrdersViewProps {
  orders: ClientsOrder[];
  clients: Client[];
  products: Product[];
  onUpdateClientsOrder: (id: string, updates: Partial<ClientsOrder>) => void;
  onDeleteClientsOrder: (id: string) => void;
  onViewOffer?: (offerId: string) => void;
  currency: string;
  offerFilterId?: string | null;
}

const DEFAULT_UNIT_TYPE: SupplierUnitType = 'hours';

const compactInputClass =
  'w-full text-sm px-3 py-2 bg-white border border-slate-200 rounded-lg focus:ring-2 focus:ring-praetor outline-none text-center disabled:opacity-50 disabled:cursor-not-allowed';

const pillBadgeClass =
  'px-2 py-0.5 rounded-full text-white text-[8px] font-black uppercase tracking-wider';

const convertHourlyToUnit = (hourlyPrice: number, unitType: SupplierUnitType | undefined) =>
  convertUnitPrice(hourlyPrice, 'hours', unitType || DEFAULT_UNIT_TYPE);

const getOrderStatusLabel = (status: ClientsOrder['status'], t: (key: string) => string) => {
  if (status === 'confirmed') return t('accounting:clientsOrders.statusConfirmed');
  if (status === 'denied') return t('accounting:clientsOrders.statusDenied');
  return t('accounting:clientsOrders.statusDraft');
};

const isHistoryRow = (status: ClientsOrder['status']) =>
  status === 'confirmed' || status === 'denied';

interface PricingCellProps {
  value: number;
  isHistory: boolean;
  colorClass: string;
  bold?: boolean;
  prefix?: string;
  dashOnZero?: boolean;
  currency: string;
}

const PricingCell: React.FC<PricingCellProps> = ({
  value,
  isHistory,
  colorClass,
  bold = false,
  prefix = '',
  dashOnZero = false,
  currency,
}) => {
  if (dashOnZero && value <= 0) {
    return (
      <span className={`text-sm font-semibold ${isHistory ? 'text-slate-300' : 'text-slate-400'}`}>
        -
      </span>
    );
  }
  return (
    <span
      className={`text-sm ${bold ? 'font-bold' : 'font-semibold'} whitespace-nowrap ${isHistory ? 'text-slate-400' : colorClass}`}
    >
      {prefix}
      {value.toFixed(2)} {currency}
    </span>
  );
};

const computeDueDate = (
  createdAt: number | undefined,
  paymentTerms: string | undefined | null,
  t: TFunction,
): string => {
  if (!createdAt) return '—';
  if (paymentTerms === 'immediate') return t('crm:paymentTerms.immediate');
  const baseDate = getLocalDateString(new Date(createdAt));
  const days = Number.parseInt(paymentTerms ?? '', 10);
  if (!Number.isFinite(days) || days <= 0) return formatDateOnlyForLocale(baseDate);
  return formatDateOnlyForLocale(addDaysToDateOnly(baseDate, days));
};

const ClientsOrdersView: React.FC<ClientsOrdersViewProps> = ({
  orders,
  clients,
  products,
  onUpdateClientsOrder,
  onDeleteClientsOrder,
  onViewOffer,
  currency,
  offerFilterId,
}) => {
  const { t } = useTranslation(['accounting', 'crm', 'common', 'sales']);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState<ClientsOrder | null>(null);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [orderToDelete, setOrderToDelete] = useState<ClientsOrder | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Form State
  const [formData, setFormData] = useState<Partial<ClientsOrder>>({
    clientId: '',
    clientName: '',
    items: [],
    paymentTerms: 'immediate',
    discount: 0,
    discountType: 'percentage',
    status: 'draft',
    notes: '',
  });

  const openEditModal = useCallback((order: ClientsOrder) => {
    setEditingOrder(order);
    setFormData({
      linkedQuoteId: order.linkedQuoteId,
      linkedOfferId: order.linkedOfferId,
      clientId: order.clientId,
      clientName: order.clientName,
      items: order.items,
      paymentTerms: order.paymentTerms,
      discount: order.discount,
      discountType: order.discountType || 'percentage',
      status: order.status,
      notes: order.notes || '',
    });
    setErrors({});
    setIsModalOpen(true);
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingOrder) return;

    const newErrors: Record<string, string> = {};

    if (!formData.clientId) {
      newErrors.clientId = t('sales:clientQuotes.errors.clientRequired');
    }

    if (!formData.items || formData.items.length === 0) {
      newErrors.items = t('sales:clientQuotes.errors.itemsRequired');
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    const itemsWithSnapshots = (formData.items || []).map((item) => {
      return {
        ...item,
        unitPrice: item.unitPrice,
        discount: item.discount ? item.discount : 0,
        productCost: Number(item.productCost ?? 0),
        productMolPercentage:
          item.productMolPercentage === undefined || item.productMolPercentage === null
            ? null
            : Number(item.productMolPercentage),
      };
    });

    const payload = {
      ...formData,
      discount: formData.discount ? formData.discount : 0,
      items: itemsWithSnapshots,
    };

    onUpdateClientsOrder(editingOrder.id, payload);
    setIsModalOpen(false);
  };

  const confirmDelete = useCallback((order: ClientsOrder) => {
    setOrderToDelete(order);
    setIsDeleteConfirmOpen(true);
  }, []);

  const handleDelete = () => {
    if (orderToDelete) {
      onDeleteClientsOrder(orderToDelete.id);
      setIsDeleteConfirmOpen(false);
      setOrderToDelete(null);
    }
  };

  const handleClientChange = (clientId: string) => {
    const client = clients.find((c) => c.id === clientId);
    setFormData((prev) => ({
      ...prev,
      clientId,
      clientName: client?.name || '',
    }));
    if (errors.clientId) {
      setErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors.clientId;
        return newErrors;
      });
    }
  };

  const addProductRow = () => {
    const newItem: Partial<ClientsOrderItem> = {
      id: 'temp-' + Date.now(),
      productId: '',
      productName: '',
      quantity: 1,
      unitType: DEFAULT_UNIT_TYPE,
      unitPrice: 0,
      productCost: 0,
      productMolPercentage: null,
      discount: 0,
    };
    setFormData({
      ...formData,
      items: [...(formData.items || []), newItem as ClientsOrderItem],
    });
    if (errors.items) {
      setErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors.items;
        return newErrors;
      });
    }
  };

  const removeProductRow = (index: number) => {
    const newItems = [...(formData.items || [])];
    newItems.splice(index, 1);
    setFormData({ ...formData, items: newItems });
  };

  const updateProductRow = (
    index: number,
    field: keyof ClientsOrderItem,
    value: string | number,
  ) => {
    const newItems = [...(formData.items || [])];
    newItems[index] = { ...newItems[index], [field]: value };

    if (field === 'productId') {
      const product = activeProducts.find((p) => p.id === value);
      if (product) {
        newItems[index].productName = product.name;
        const mol = product.molPercentage ? Number(product.molPercentage) : 0;
        const hourlySalePrice = calcProductSalePrice(Number(product.costo), mol);
        newItems[index].unitPrice = convertHourlyToUnit(hourlySalePrice, newItems[index].unitType);
        newItems[index].productCost = Number(product.costo);
        newItems[index].productMolPercentage = product.molPercentage;
      }
    }

    setFormData({ ...formData, items: newItems });
  };

  const handleUnitTypeChange = (index: number, newType: SupplierUnitType) => {
    if (isReadOnly) return;
    const item = formData.items?.[index];
    if (!item) return;
    const oldType = item.unitType || DEFAULT_UNIT_TYPE;
    if (oldType === newType) return;
    const adjustedPrice = convertUnitPrice(item.unitPrice, oldType, newType);
    const newItems = [...(formData.items || [])];
    newItems[index] = {
      ...newItems[index],
      unitType: newType,
      unitPrice: adjustedPrice,
    };
    setFormData({ ...formData, items: newItems });
  };

  const activeClients = useMemo(() => clients.filter((c) => !c.isDisabled), [clients]);
  const activeProducts = useMemo(() => products.filter((p) => !p.isDisabled), [products]);

  const isLinkedOffer = Boolean(formData.linkedOfferId);
  const isReadOnly = Boolean(isLinkedOffer || (editingOrder && editingOrder.status !== 'draft'));

  // Filter orders by offerFilterId if provided
  const filteredOrders = useMemo(() => {
    if (offerFilterId) {
      return orders.filter((o) => o.linkedOfferId === offerFilterId);
    }
    return orders;
  }, [orders, offerFilterId]);

  const orderPricingMap = useMemo(() => {
    const map = new Map<string, PricingTotals>();
    for (const order of filteredOrders) {
      map.set(
        order.id,
        calculatePricingTotals(order.items, order.discount, DEFAULT_UNIT_TYPE, order.discountType),
      );
    }
    return map;
  }, [filteredOrders]);

  const paymentTermsOptions = useMemo(() => getPaymentTermsOptions(t), [t]);

  // Table columns definition with TableFilter support
  const columns = useMemo(
    () => [
      {
        header: t('accounting:clientsOrders.orderNumber', { defaultValue: 'Order Number' }),
        id: 'id',
        accessorFn: (row: ClientsOrder) => row.id,
        cell: ({ row }: { row: ClientsOrder }) => (
          <span className="font-bold text-slate-700">{row.id}</span>
        ),
      },
      {
        header: t('crm:clients.tableHeaders.insertDate'),
        id: 'createdAt',
        accessorFn: (row: ClientsOrder) => row.createdAt ?? 0,
        className: 'whitespace-nowrap',
        cell: ({ row }: { row: ClientsOrder }) => {
          if (!row.createdAt) return <span className="text-xs text-slate-400">-</span>;
          return (
            <span className="text-xs text-slate-500 whitespace-nowrap">
              {formatInsertDate(row.createdAt)}
            </span>
          );
        },
        filterFormat: (value: unknown) => {
          const timestamp = typeof value === 'number' ? value : Number(value);
          if (!Number.isFinite(timestamp) || timestamp <= 0) return '-';
          return formatInsertDate(timestamp);
        },
      },
      {
        header: t('accounting:clientsOrders.clientColumn'),
        accessorFn: (row: ClientsOrder) => row.clientName,
        cell: ({ row }: { row: ClientsOrder }) => (
          <div>
            <div
              className={`font-bold ${isHistoryRow(row.status) ? 'text-slate-400' : 'text-slate-800'}`}
            >
              {row.clientName}
            </div>
            <div className="text-[10px] font-black uppercase tracking-wider text-slate-400">
              {t('accounting:clientsOrders.itemsCount', { count: row.items.length })}
            </div>
          </div>
        ),
      },
      {
        header: t('sales:clientQuotes.globalDiscount'),
        id: 'globalDiscount',
        className: 'whitespace-nowrap',
        headerClassName: 'min-w-[9rem]',
        disableSorting: true,
        disableFiltering: true,
        cell: ({ row }: { row: ClientsOrder }) => {
          const history = isHistoryRow(row.status);
          return (
            <span
              className={`text-sm font-semibold whitespace-nowrap ${history ? 'text-slate-400' : 'text-slate-600'}`}
            >
              {formatDiscountValue(row.discount, row.discountType, currency)}
            </span>
          );
        },
      },
      {
        header: t('accounting:clientsOrders.subtotal', { defaultValue: 'Subtotal' }),
        id: 'subtotal',
        accessorFn: (row: ClientsOrder) => orderPricingMap.get(row.id)?.subtotal ?? 0,
        className: 'whitespace-nowrap',
        headerClassName: 'min-w-[8rem]',
        disableFiltering: true,
        cell: ({ row, value }: { row: ClientsOrder; value: unknown }) => (
          <PricingCell
            value={Number(value)}
            isHistory={isHistoryRow(row.status)}
            colorClass="text-slate-700"
            currency={currency}
          />
        ),
      },
      {
        header: t('common:labels.discount'),
        id: 'discountAmount',
        accessorFn: (row: ClientsOrder) => orderPricingMap.get(row.id)?.discountAmount ?? 0,
        className: 'whitespace-nowrap',
        headerClassName: 'min-w-[8rem]',
        disableFiltering: true,
        cell: ({ row, value }: { row: ClientsOrder; value: unknown }) => (
          <PricingCell
            value={Number(value)}
            isHistory={isHistoryRow(row.status)}
            colorClass="text-amber-600"
            prefix="-"
            dashOnZero
            currency={currency}
          />
        ),
      },
      {
        header: t('accounting:clientsOrders.margin'),
        id: 'margin',
        accessorFn: (row: ClientsOrder) => orderPricingMap.get(row.id)?.margin ?? 0,
        className: 'whitespace-nowrap',
        headerClassName: 'min-w-[8rem]',
        disableFiltering: true,
        cell: ({ row, value }: { row: ClientsOrder; value: unknown }) => (
          <PricingCell
            value={Number(value)}
            isHistory={isHistoryRow(row.status)}
            colorClass="text-emerald-600"
            bold
            currency={currency}
          />
        ),
      },
      {
        header: t('sales:clientQuotes.totalCost', { defaultValue: 'Total cost' }),
        id: 'totalCost',
        accessorFn: (row: ClientsOrder) => orderPricingMap.get(row.id)?.totalCost ?? 0,
        className: 'whitespace-nowrap',
        headerClassName: 'min-w-[8rem]',
        disableFiltering: true,
        cell: ({ row, value }: { row: ClientsOrder; value: unknown }) => (
          <PricingCell
            value={Number(value)}
            isHistory={isHistoryRow(row.status)}
            colorClass="text-slate-700"
            currency={currency}
          />
        ),
      },
      {
        header: t('accounting:clientsOrders.totalColumn'),
        accessorFn: (row: ClientsOrder) => orderPricingMap.get(row.id)?.total ?? 0,
        className: 'whitespace-nowrap',
        headerClassName: 'min-w-[8rem]',
        cell: ({ row, value }: { row: ClientsOrder; value: unknown }) => (
          <PricingCell
            value={Number(value)}
            isHistory={isHistoryRow(row.status)}
            colorClass="text-slate-700"
            bold
            currency={currency}
          />
        ),
        filterFormat: (val: unknown) => (val as number).toFixed(2),
      },
      {
        header: t('accounting:clientsOrders.paymentTermsColumn'),
        accessorFn: (row: ClientsOrder) =>
          row.paymentTerms === 'immediate' ? t('crm:paymentTerms.immediate') : row.paymentTerms,
        className: 'whitespace-nowrap',
        headerClassName: 'min-w-[10rem]',
        cell: ({ row }: { row: ClientsOrder }) => (
          <span
            className={`text-sm font-semibold ${isHistoryRow(row.status) ? 'text-slate-400' : 'text-slate-600'}`}
          >
            {row.paymentTerms === 'immediate' ? t('crm:paymentTerms.immediate') : row.paymentTerms}
          </span>
        ),
      },
      {
        header: t('accounting:clientsOrders.statusColumn'),
        accessorFn: (row: ClientsOrder) => getOrderStatusLabel(row.status, t),
        className: 'whitespace-nowrap',
        headerClassName: 'min-w-[9rem]',
        cell: ({ row }: { row: ClientsOrder }) => (
          <div className={isHistoryRow(row.status) ? 'opacity-60' : ''}>
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
        cell: ({ row }: { row: ClientsOrder }) => (
          <div className="flex justify-end gap-2">
            {onViewOffer && row.linkedOfferId && (
              <Tooltip label={t('sales:clientOffers.viewOffer', { defaultValue: 'View offer' })}>
                {() => {
                  const linkedOfferId = row.linkedOfferId;
                  if (!linkedOfferId) return null;
                  return (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onViewOffer(linkedOfferId);
                      }}
                      className="p-2 text-slate-400 hover:text-praetor hover:bg-slate-100 rounded-lg transition-all"
                    >
                      <i className="fa-solid fa-link"></i>
                    </button>
                  );
                }}
              </Tooltip>
            )}
            <Tooltip
              label={
                row.status === 'draft'
                  ? t('accounting:clientsOrders.editOrder')
                  : t('accounting:clientsOrders.viewOrder')
              }
            >
              {() => (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    openEditModal(row);
                  }}
                  className="p-2 text-slate-400 hover:text-praetor hover:bg-slate-100 rounded-lg transition-all"
                >
                  <i
                    className={`fa-solid ${row.status === 'draft' ? 'fa-pen-to-square' : 'fa-eye'}`}
                  ></i>
                </button>
              )}
            </Tooltip>
            {row.status === 'draft' && (
              <>
                <Tooltip label={t('accounting:clientsOrders.markAsConfirmed')}>
                  {() => (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onUpdateClientsOrder(row.id, { status: 'confirmed' });
                      }}
                      className="p-2 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-all"
                    >
                      <i className="fa-solid fa-check"></i>
                    </button>
                  )}
                </Tooltip>
                <Tooltip label={t('accounting:clientsOrders.markAsDenied')}>
                  {() => (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onUpdateClientsOrder(row.id, { status: 'denied' });
                      }}
                      className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                    >
                      <i className="fa-solid fa-xmark"></i>
                    </button>
                  )}
                </Tooltip>
                <Tooltip label={t('accounting:clientsOrders.deleteOrder')}>
                  {() => (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        confirmDelete(row);
                      }}
                      className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                    >
                      <i className="fa-solid fa-trash-can"></i>
                    </button>
                  )}
                </Tooltip>
              </>
            )}
          </div>
        ),
      },
    ],
    [currency, onUpdateClientsOrder, onViewOffer, t, confirmDelete, openEditModal, orderPricingMap],
  );

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Edit Modal */}
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)}>
        <div className="flex max-h-[90vh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl animate-in zoom-in duration-200">
          <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/50 p-6">
            <h3 className="flex items-center gap-3 text-xl font-black text-slate-800">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-praetor">
                <i className={`fa-solid ${isReadOnly ? 'fa-eye' : 'fa-pen-to-square'}`}></i>
              </div>
              {isReadOnly ? t('common:buttons.view') : t('accounting:clientsOrders.editOrder')}
            </h3>
            <button
              onClick={() => setIsModalOpen(false)}
              className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-400 transition-colors hover:bg-slate-100"
            >
              <i className="fa-solid fa-xmark text-lg"></i>
            </button>
          </div>

          <form onSubmit={handleSubmit} className="flex-1 space-y-4 overflow-y-auto p-8">
            {editingOrder && editingOrder.status !== 'draft' && (
              <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-amber-200 bg-amber-50">
                <span className="text-amber-700 text-xs font-bold">
                  {t('accounting:clientsOrders.readOnlyStatus', {
                    status: getOrderStatusLabel(editingOrder.status, t),
                  })}
                </span>
              </div>
            )}
            {/* Linked Offer Info */}
            {formData.linkedOfferId && (
              <div className="bg-slate-50 border border-slate-100 rounded-xl p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center text-praetor">
                    <i className="fa-solid fa-link"></i>
                  </div>
                  <div>
                    <div className="text-sm font-bold text-slate-900">
                      {t('accounting:clientsOrders.linkedOffer', { defaultValue: 'Linked Offer' })}
                    </div>
                    <div className="text-xs text-praetor">
                      {t('accounting:clientsOrders.linkedOfferInfo', {
                        number: formData.linkedOfferId,
                        defaultValue: 'Offer #{{number}}',
                      })}
                    </div>
                    <div className="text-[10px] text-slate-400 mt-0.5">
                      {t('accounting:clientsOrders.offerDetailsReadOnly', {
                        defaultValue: '(Order details are read-only)',
                      })}
                    </div>
                  </div>
                </div>
                {onViewOffer && formData.linkedOfferId && (
                  <button
                    type="button"
                    onClick={() => onViewOffer(formData.linkedOfferId as string)}
                    className="text-xs font-bold text-praetor hover:text-slate-800 hover:underline"
                  >
                    {t('sales:clientOffers.viewOffer', { defaultValue: 'View offer' })}
                  </button>
                )}
              </div>
            )}

            {/* Order Details */}
            <div className="space-y-2">
              <h4 className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-praetor">
                <span className="h-1.5 w-1.5 rounded-full bg-praetor"></span>
                {t('accounting:clientsOrders.orderDetails')}
              </h4>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="space-y-1.5">
                  <label className="ml-1 text-xs font-bold text-slate-500">
                    {t('accounting:clientsOrders.client')}
                  </label>
                  <CustomSelect
                    options={activeClients.map((c) => ({ id: c.id, name: c.name }))}
                    value={formData.clientId || ''}
                    onChange={(val) => handleClientChange(val as string)}
                    placeholder={t('sales:clientQuotes.selectAClient')}
                    searchable={true}
                    disabled={isReadOnly}
                    className={errors.clientId ? 'border-red-300' : ''}
                  />
                  {errors.clientId && (
                    <p className="text-red-500 text-[10px] font-bold ml-1">{errors.clientId}</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <label className="ml-1 text-xs font-bold text-slate-500">
                    {t('accounting:clientsOrders.orderNumber', { defaultValue: 'Order Number' })}
                  </label>
                  <div className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-700 font-bold">
                    {editingOrder?.id || '—'}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="ml-1 text-xs font-bold text-slate-500">
                    {t('accounting:clientsOrders.paymentTerms')}
                  </label>
                  <CustomSelect
                    options={paymentTermsOptions}
                    value={formData.paymentTerms || 'immediate'}
                    onChange={(val) =>
                      setFormData({
                        ...formData,
                        paymentTerms: val as ClientsOrder['paymentTerms'],
                      })
                    }
                    searchable={false}
                    disabled={isReadOnly}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="ml-1 text-xs font-bold text-slate-500">
                    {t('accounting:clientsOrders.paymentDueDate', {
                      defaultValue: 'Payment due date',
                    })}
                  </label>
                  <div className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-700 font-bold">
                    {computeDueDate(editingOrder?.createdAt, formData.paymentTerms, t)}
                  </div>
                </div>
              </div>
            </div>

            {/* Products */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-praetor">
                  <span className="h-1.5 w-1.5 rounded-full bg-praetor"></span>
                  {t('sales:clientQuotes.productsServices')}
                </h4>
                <button
                  type="button"
                  onClick={addProductRow}
                  disabled={isReadOnly}
                  className="flex items-center gap-1 text-xs font-bold text-praetor hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <i className="fa-solid fa-plus"></i> {t('sales:clientQuotes.addProduct')}
                </button>
              </div>
              {errors.items && (
                <p className="ml-1 -mt-2 text-[10px] font-bold text-red-500">{errors.items}</p>
              )}

              {formData.items && formData.items.length > 0 && (
                <div className="hidden lg:flex gap-2 px-3 mb-1 items-center">
                  <div className="grid flex-1 grid-cols-12 gap-2 text-[10px] font-black uppercase tracking-wider text-slate-400">
                    <div className="col-span-2">
                      {t('accounting:clientsOrders.supplierOrderColumn', {
                        defaultValue: 'Supplier Order',
                      })}
                    </div>
                    <div className="col-span-2">{t('sales:clientQuotes.productsServices')}</div>
                    <div className="col-span-2 text-center">{t('sales:clientQuotes.qty')}</div>
                    <div className="col-span-1 text-center">{t('crm:internalListing.cost')}</div>
                    <div className="col-span-1 text-center">
                      {t('sales:clientQuotes.molLabel', { defaultValue: 'MOL' })}
                    </div>
                    <div className="col-span-1 text-center whitespace-nowrap">
                      {t('sales:clientQuotes.totalCost', { defaultValue: 'Total cost' })}
                    </div>
                    <div className="col-span-1 text-center">
                      {t('sales:clientQuotes.marginLabel')}
                    </div>
                    <div className="col-span-2 pr-2 text-right">
                      {t('crm:internalListing.salePrice')}
                    </div>
                  </div>
                  <div className="w-8 shrink-0"></div>
                </div>
              )}

              {formData.items && formData.items.length > 0 ? (
                <div className="space-y-3">
                  {formData.items.map((item, index) => {
                    const product = products.find((p) => p.id === item.productId);
                    const { unitCost, molPercentage, lineCost, quantity } = getItemPricingContext(
                      item,
                      DEFAULT_UNIT_TYPE,
                    );
                    const salePrice = Number(item.unitPrice || 0);
                    const lineSalePrice = salePrice * quantity;
                    const margin = lineSalePrice - lineCost;
                    const isSupply = product?.type === 'supply';

                    const handleCostChange = (value: string) => {
                      if (isReadOnly) return;
                      setFormData(
                        makeCostUpdater<Partial<ClientsOrder>>(index, value, DEFAULT_UNIT_TYPE),
                      );
                    };

                    const handleMolChange = (value: string) => {
                      if (isReadOnly) return;
                      setFormData(
                        makeMolUpdater<Partial<ClientsOrder>>(index, value, DEFAULT_UNIT_TYPE),
                      );
                    };

                    return (
                      <div
                        key={item.id}
                        className="space-y-3 rounded-xl border border-slate-100 bg-slate-50 p-3"
                      >
                        <div className="flex items-start gap-2">
                          <div className="grid flex-1 grid-cols-1 gap-2 lg:grid-cols-12">
                            <div className="space-y-1 lg:col-span-2 min-w-0">
                              <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 lg:hidden">
                                {t('accounting:clientsOrders.supplierOrderColumn', {
                                  defaultValue: 'Supplier Order',
                                })}
                              </label>
                              <div className="flex items-center min-h-[42px] px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg">
                                {item.supplierSaleId ? (
                                  <span className="text-xs font-semibold text-slate-700 truncate">
                                    {item.supplierSaleSupplierName ?? '—'} · {item.supplierSaleId}
                                  </span>
                                ) : (
                                  <span className="text-xs text-slate-400">
                                    {t('accounting:clientsOrders.noSupplierOrder', {
                                      defaultValue: 'No supplier order',
                                    })}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="space-y-1 lg:col-span-2 min-w-0">
                              <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 lg:hidden">
                                {t('sales:clientQuotes.productsServices')}
                              </label>
                              <CustomSelect
                                options={activeProducts.map((p) => ({ id: p.id, name: p.name }))}
                                value={item.productId}
                                onChange={(val) =>
                                  updateProductRow(index, 'productId', val as string)
                                }
                                placeholder={t('sales:clientQuotes.selectProduct')}
                                searchable={true}
                                disabled={isReadOnly}
                                buttonClassName="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                              />
                            </div>
                            <div className="space-y-1 lg:col-span-2">
                              <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 lg:hidden">
                                {t('sales:clientQuotes.qty')}
                              </label>
                              <div className="flex items-center gap-1">
                                <ValidatedNumberInput
                                  step="0.01"
                                  min="0"
                                  required
                                  placeholder="Qty"
                                  value={item.quantity}
                                  onValueChange={(value) => {
                                    const parsed = parseFloat(value);
                                    updateProductRow(
                                      index,
                                      'quantity',
                                      value === '' || Number.isNaN(parsed) ? 0 : parsed,
                                    );
                                  }}
                                  disabled={isReadOnly || Boolean(item.supplierQuoteItemId)}
                                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-center text-sm outline-none focus:ring-2 focus:ring-praetor disabled:bg-slate-50 disabled:text-slate-400 flex-1"
                                />
                                <span className="text-xs font-semibold text-slate-400 shrink-0">
                                  /
                                </span>
                                <UnitTypeSelector
                                  value={(item.unitType || DEFAULT_UNIT_TYPE) as SupplierUnitType}
                                  onChange={(val) => handleUnitTypeChange(index, val)}
                                  isSupply={isSupply}
                                  quantity={Number(item.quantity) || 0}
                                  disabled={isReadOnly || Boolean(item.supplierQuoteItemId)}
                                  i18nPrefix="sales:clientQuotes"
                                />
                              </div>
                            </div>
                            <div className="space-y-1 lg:col-span-1">
                              <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 lg:hidden">
                                {t('crm:internalListing.cost')}
                              </label>
                              <div className="flex flex-col items-center justify-center min-h-[42px] gap-1">
                                {item.supplierQuoteItemId && (
                                  <span className={`${pillBadgeClass} bg-emerald-600`}>
                                    {t('sales:clientQuotes.supplierQuoteBadge')}
                                  </span>
                                )}
                                {item.supplierSaleId && (
                                  <span className={`${pillBadgeClass} bg-blue-600`}>
                                    {t('accounting:clientsOrders.supplierOrderBadge', {
                                      defaultValue: 'Supplier order',
                                    })}
                                  </span>
                                )}
                                <div className="flex items-center gap-1">
                                  <ValidatedNumberInput
                                    value={unitCost}
                                    formatDecimals={2}
                                    onValueChange={handleCostChange}
                                    disabled={isReadOnly}
                                    className={compactInputClass}
                                  />
                                  <span className="text-[9px] font-semibold text-slate-400 shrink-0">
                                    {currency}
                                  </span>
                                </div>
                              </div>
                            </div>
                            <div className="space-y-1 lg:col-span-1">
                              <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 lg:hidden">
                                {t('sales:clientQuotes.molLabel', { defaultValue: 'MOL' })}
                              </label>
                              <div className="flex items-center justify-center min-h-[42px] gap-1">
                                <ValidatedNumberInput
                                  value={molPercentage}
                                  formatDecimals={1}
                                  onValueChange={handleMolChange}
                                  disabled={isReadOnly}
                                  className={compactInputClass}
                                />
                                <span className="text-[9px] font-semibold text-slate-400 shrink-0">
                                  %
                                </span>
                              </div>
                            </div>
                            <div className="space-y-1 lg:col-span-1">
                              <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 lg:hidden">
                                {t('sales:clientQuotes.totalCost', { defaultValue: 'Total cost' })}
                              </label>
                              <div className="flex items-center justify-center min-h-[42px]">
                                <span className="text-xs font-bold text-slate-700 whitespace-nowrap">
                                  {lineCost.toFixed(2)} {currency}
                                </span>
                              </div>
                            </div>
                            <div className="space-y-1 lg:col-span-1">
                              <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 lg:hidden">
                                {t('sales:clientQuotes.marginLabel')}
                              </label>
                              <div className="flex items-center justify-center min-h-[42px]">
                                <span className="text-xs font-bold text-emerald-600">
                                  {margin.toFixed(2)} {currency}
                                </span>
                              </div>
                            </div>
                            <div className="space-y-1 lg:col-span-2">
                              <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 lg:hidden">
                                {t('crm:internalListing.salePrice')}
                              </label>
                              <div className="flex min-h-[42px] items-center justify-end whitespace-nowrap px-3 py-2 text-sm font-bold text-slate-700">
                                <span className="text-sm font-semibold text-slate-800">
                                  {lineSalePrice.toFixed(2)} {currency}
                                </span>
                              </div>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => removeProductRow(index)}
                            disabled={isReadOnly}
                            className="rounded-lg p-2 text-slate-400 transition-colors hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50"
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
                  {t('sales:clientQuotes.noProductsAdded')}
                </div>
              )}
            </div>

            {/* Notes & Cost Summary */}
            <div className="flex flex-col gap-4 border-t border-slate-100 pt-4 md:flex-row">
              <div className="md:w-2/3 space-y-1.5">
                <label className="ml-1 text-xs font-bold text-slate-500">
                  {t('accounting:clientsOrders.notes')}
                </label>
                <textarea
                  rows={4}
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  placeholder={t('sales:clientQuotes.additionalNotesPlaceholder')}
                  disabled={isReadOnly}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none resize-none focus:ring-2 focus:ring-praetor transition-all disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed"
                />
              </div>

              <div className="md:w-1/3">
                {(() => {
                  const { subtotal, discountAmount, total, margin, marginPercentage } =
                    calculatePricingTotals(
                      formData.items || [],
                      formData.discount || 0,
                      DEFAULT_UNIT_TYPE,
                      formData.discountType || 'percentage',
                    );
                  return (
                    <CostSummaryPanel
                      currency={currency}
                      subtotal={subtotal}
                      total={total}
                      subtotalLabel={t('sales:clientQuotes.subtotal', { defaultValue: 'Subtotal' })}
                      totalLabel={t('sales:clientQuotes.totalLabel')}
                      globalDiscount={{
                        label: t('sales:clientQuotes.globalDiscount', {
                          defaultValue: 'Global Discount',
                        }),
                        value: formData.discount || 0,
                        type: formData.discountType || 'percentage',
                        onChange: (value) => {
                          const parsed = parseNumberInputValue(value);
                          setFormData({ ...formData, discount: parsed });
                        },
                        onTypeChange: (type) => setFormData({ ...formData, discountType: type }),
                        disabled: isReadOnly,
                      }}
                      discountRow={
                        discountAmount > 0
                          ? {
                              label: t('sales:clientOffers.discountAmount', {
                                value: formatDiscountValue(
                                  formData.discount ?? 0,
                                  formData.discountType ?? 'percentage',
                                  currency,
                                ),
                              }),
                              amount: discountAmount,
                            }
                          : undefined
                      }
                      margin={{
                        label: `${t('sales:clientQuotes.marginLabel')} (${marginPercentage.toFixed(1)}%)`,
                        amount: margin,
                      }}
                    />
                  );
                })()}
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
                className="rounded-xl bg-praetor px-8 py-3 font-bold text-white shadow-lg shadow-slate-200 hover:bg-slate-700"
              >
                {t('accounting:clientsOrders.updateOrder')}
              </button>
            </div>
          </form>
        </div>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal isOpen={isDeleteConfirmOpen} onClose={() => setIsDeleteConfirmOpen(false)}>
        <div className="w-full max-w-sm space-y-4 overflow-hidden rounded-2xl bg-white p-6 text-center shadow-2xl">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600">
            <i className="fa-solid fa-triangle-exclamation text-xl"></i>
          </div>
          <h3 className="text-lg font-black text-slate-800">
            {t('accounting:clientsOrders.deleteOrderTitle')}
          </h3>
          <p className="text-sm text-slate-500">
            {t('accounting:clientsOrders.deleteOrderConfirm', {
              clientName: orderToDelete?.clientName,
            })}
          </p>
          <div className="flex gap-3 pt-2">
            <button
              onClick={() => setIsDeleteConfirmOpen(false)}
              className="flex-1 rounded-xl py-3 font-bold text-slate-500 hover:bg-slate-50"
            >
              {t('common:buttons.cancel')}
            </button>
            <button
              onClick={handleDelete}
              className="flex-1 rounded-xl bg-red-600 py-3 font-bold text-white hover:bg-red-700"
            >
              {t('common:buttons.delete')}
            </button>
          </div>
        </div>
      </Modal>

      <div className="space-y-4">
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-2xl font-black text-slate-800">
              {t('accounting:clientsOrders.title')}
            </h2>
            <p className="text-sm text-slate-500">{t('accounting:clientsOrders.subtitle')}</p>
          </div>
        </div>
      </div>

      {/* Main Table with all orders and TableFilter */}
      <StandardTable<ClientsOrder>
        title={t('accounting:clientsOrders.title')}
        data={filteredOrders}
        columns={columns}
        defaultRowsPerPage={10}
        containerClassName="overflow-visible"
        rowClassName={(row: ClientsOrder) =>
          isHistoryRow(row.status) ? 'bg-slate-50 text-slate-400' : 'hover:bg-slate-50/50'
        }
        onRowClick={(row: ClientsOrder) => openEditModal(row)}
      />
    </div>
  );
};

export default ClientsOrdersView;
