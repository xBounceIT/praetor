import type React from 'react';
import { useCallback, useMemo, useReducer } from 'react';
import { useTranslation } from 'react-i18next';
import { LinkedRecordBanner } from '@/components/shared/LinkedRecordBanner';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type {
  DurationUnit,
  Product,
  Supplier,
  SupplierOrderVersion,
  SupplierQuote,
  SupplierSaleOrder,
  SupplierSaleOrderItem,
  SupplierUnitType,
} from '../../types';
import { formatInsertDateTime } from '../../utils/date';
import { formatDocumentCode } from '../../utils/document-code';
import { createLineItemIndexResolver } from '../../utils/lineItemIndex';
import {
  durationValueToMonths,
  formatDecimal,
  getDiscountedLineTotal,
  getDiscountedUnitPrice,
  getDocumentDiscountAmount,
  getDurationInputValue,
  getEffectiveDurationMultiplier,
  isFiniteNumber,
  isPositiveFiniteNumber,
  normalizeDurationForSubmit,
  normalizeDurationUnit,
  parseDurationValueToMonths,
  roundCurrency,
} from '../../utils/numbers';
import { getPaymentTermsOptions } from '../../utils/options';
import { toastError } from '../../utils/toast';
import CostSummaryPanel from '../shared/CostSummaryPanel';
import DeleteConfirmModal from '../shared/DeleteConfirmModal';
import DurationUnitSelector from '../shared/DurationUnitSelector';
import {
  LINE_ITEM_NOTE_CELL_CLASSNAME,
  LINE_ITEM_NOTE_COLUMN_MIN_WIDTH,
} from '../shared/lineItemNoteStyles';
import Modal from '../shared/Modal';
import {
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '../shared/ModalLayout';
import { ModalReadOnlyStatusBanner } from '../shared/ModalReadOnlyStatusBanner';
import SelectControl from '../shared/SelectControl';
import StandardTable, { type Column } from '../shared/StandardTable';
import StatusBadge, { type StatusType } from '../shared/StatusBadge';
import { TABLE_ROW_ACTION_BUTTON_CLASSNAME } from '../shared/tableControlStyles';
import UnitTypeSelector from '../shared/UnitTypeSelector';
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
  let grossSubtotal = 0;
  let subtotal = 0;

  items.forEach((item) => {
    // Duration multiplies by the numeric value shown in its selected unit, matching the supplier
    // quote the order was created from.
    const durationMultiplier = getEffectiveDurationMultiplier(item);
    grossSubtotal +=
      (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0) * durationMultiplier;
    subtotal += getDiscountedLineTotal(item);
  });

  const discountAmount = getDocumentDiscountAmount(subtotal, globalDiscount, discountType);
  const total = subtotal - discountAmount;
  const totalDiscountPercentage =
    grossSubtotal > 0 ? ((grossSubtotal - total) / grossSubtotal) * 100 : 0;
  const roundedGrossSubtotal = roundCurrency(grossSubtotal);
  const roundedTotal = roundCurrency(total);

  return {
    grossSubtotal: roundedGrossSubtotal,
    totalDiscountAmount: roundCurrency(grossSubtotal - total),
    totalDiscountPercentage: roundCurrency(totalDiscountPercentage),
    total: roundedTotal,
  };
};

const createDefaultSupplierOrderForm = (): Partial<SupplierSaleOrder> => ({
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

const supplierOrderToFormData = (order: SupplierSaleOrder): Partial<SupplierSaleOrder> => ({
  ...order,
  items: order.items.map((item) => ({ ...item })),
});

const supplierOrderVersionToFormData = (
  version: SupplierOrderVersion,
): Partial<SupplierSaleOrder> => ({
  ...version.snapshot.order,
  items: version.snapshot.items.map((item) => ({ ...item })),
});

type SupplierOrdersState = {
  editingOrder: SupplierSaleOrder | null;
  orderToDelete: SupplierSaleOrder | null;
  isModalOpen: boolean;
  isDeleteConfirmOpen: boolean;
  previewVersion: SupplierOrderVersion | null;
  formData: Partial<SupplierSaleOrder>;
};

type SupplierOrdersAction =
  | { type: 'openEdit'; order: SupplierSaleOrder }
  | { type: 'closeModal' }
  | { type: 'previewVersion'; version: SupplierOrderVersion }
  | { type: 'clearPreview' }
  | { type: 'versionRestored'; order: SupplierSaleOrder }
  | { type: 'confirmDelete'; order: SupplierSaleOrder }
  | { type: 'deleteSuccess' }
  | { type: 'submitSuccess' }
  | { type: 'patchForm'; patch: Partial<SupplierSaleOrder> }
  | {
      type: 'updateItem';
      index: number;
      field: keyof SupplierSaleOrderItem;
      value: string | number | undefined;
      products: Product[];
    }
  | { type: 'removeItem'; index: number };

const createSupplierOrdersState = (): SupplierOrdersState => ({
  editingOrder: null,
  orderToDelete: null,
  isModalOpen: false,
  isDeleteConfirmOpen: false,
  previewVersion: null,
  formData: createDefaultSupplierOrderForm(),
});

const supplierOrdersReducer = (
  state: SupplierOrdersState,
  action: SupplierOrdersAction,
): SupplierOrdersState => {
  switch (action.type) {
    case 'openEdit':
      return {
        ...state,
        editingOrder: action.order,
        formData: supplierOrderToFormData(action.order),
        previewVersion: null,
        isModalOpen: true,
      };
    case 'closeModal':
      return { ...state, isModalOpen: false, previewVersion: null };
    case 'previewVersion':
      return {
        ...state,
        previewVersion: action.version,
        formData: supplierOrderVersionToFormData(action.version),
      };
    case 'clearPreview':
      return state.editingOrder
        ? {
            ...state,
            formData: supplierOrderToFormData(state.editingOrder),
            previewVersion: null,
          }
        : { ...state, previewVersion: null };
    case 'versionRestored':
      return {
        ...state,
        editingOrder: action.order,
        formData: supplierOrderToFormData(action.order),
        previewVersion: null,
      };
    case 'confirmDelete':
      return { ...state, orderToDelete: action.order, isDeleteConfirmOpen: true };
    case 'deleteSuccess':
      return { ...state, orderToDelete: null, isDeleteConfirmOpen: false };
    case 'submitSuccess':
      return { ...state, isModalOpen: false };
    case 'patchForm':
      return { ...state, formData: { ...state.formData, ...action.patch } };
    case 'updateItem': {
      const items = [...(state.formData.items || [])];
      const nextItem = { ...items[action.index], [action.field]: action.value };

      if (action.field === 'productId') {
        const product = action.products.find((item) => item.id === action.value);
        if (product) {
          nextItem.productName = product.name;
          if (product.type === 'supply') {
            nextItem.unitPrice = Number(product.costo);
            nextItem.unitType = 'unit';
          } else {
            nextItem.unitType = nextItem.unitType === 'days' ? 'days' : 'hours';
            nextItem.unitPrice = Number(product.costo);
          }
        }
      }

      items[action.index] = nextItem;
      return { ...state, formData: { ...state.formData, items } };
    }
    case 'removeItem':
      return {
        ...state,
        formData: {
          ...state.formData,
          items: (state.formData.items || []).filter((_, index) => index !== action.index),
        },
      };
    default:
      return state;
  }
};

export interface SupplierOrdersViewProps {
  orders: SupplierSaleOrder[];
  quotes?: SupplierQuote[];
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
  // Pre-filters the list to a single supplier order by its own id, via a clearable
  // table column filter — set by the client-order line shortcut that deep-links here
  // (#/accounting/supplier-orders?filterId=…).
  orderFilterId?: string | null;
}

const useSupplierOrdersController = ({
  orders,
  quotes = [],
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
  orderFilterId,
}: SupplierOrdersViewProps) => {
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

  const [state, dispatch] = useReducer(supplierOrdersReducer, undefined, createSupplierOrdersState);
  const {
    editingOrder,
    orderToDelete,
    isModalOpen,
    isDeleteConfirmOpen,
    previewVersion,
    formData,
  } = state;

  const baseReadOnly = Boolean(editingOrder && editingOrder.status !== 'draft');
  const isReadOnly = baseReadOnly || previewVersion !== null;

  const patchForm = useCallback((patch: Partial<SupplierSaleOrder>) => {
    dispatch({ type: 'patchForm', patch });
  }, []);

  const closeDeleteConfirm = useCallback(() => {
    dispatch({ type: 'deleteSuccess' });
  }, []);

  const openEditModal = useCallback((order: SupplierSaleOrder) => {
    dispatch({ type: 'openEdit', order });
  }, []);

  const closeEditModal = useCallback(() => {
    dispatch({ type: 'closeModal' });
  }, []);

  const handleVersionPreview = useCallback((version: SupplierOrderVersion) => {
    dispatch({ type: 'previewVersion', version });
  }, []);

  const handleClearPreview = useCallback(() => {
    dispatch({ type: 'clearPreview' });
  }, []);

  const handleVersionRestored = useCallback(
    async (updated: SupplierSaleOrder) => {
      dispatch({ type: 'versionRestored', order: updated });
      if (onOrderRestored) await onOrderRestored(updated);
    },
    [onOrderRestored],
  );

  const confirmDelete = useCallback((order: SupplierSaleOrder) => {
    dispatch({ type: 'confirmDelete', order });
  }, []);

  const handleDelete = useCallback(async () => {
    if (!orderToDelete) return;
    await onDeleteOrder(orderToDelete.id);
    dispatch({ type: 'deleteSuccess' });
  }, [onDeleteOrder, orderToDelete]);

  const updateItem = useCallback(
    (index: number, field: keyof SupplierSaleOrderItem, value: string | number | undefined) => {
      if (isReadOnly) return;
      dispatch({ type: 'updateItem', index, field, value, products });
    },
    [isReadOnly, products],
  );

  const removeItem = useCallback(
    (index: number) => {
      if (isReadOnly) return;
      dispatch({ type: 'removeItem', index });
    },
    [isReadOnly],
  );

  const handleUnitTypeChange = useCallback(
    (index: number, newType: SupplierUnitType) => {
      if (isReadOnly) return;
      const item = formData.items?.[index];
      if (!item) return;
      const oldType = item.unitType || 'hours';
      if (oldType === newType) return;
      updateItem(index, 'unitType', newType);
    },
    [formData.items, isReadOnly, updateItem],
  );

  // Duration is carried over from the supplier quote (issue #776) and stays editable on the order.
  // It is a plain multiplier for every quantity unit, with a Mese/Anno/N.D. selector.
  const handleDurationValueChange = useCallback(
    (index: number, value: string) => {
      if (isReadOnly) return;
      const unit = normalizeDurationUnit(formData.items?.[index]?.durationUnit);
      updateItem(
        index,
        'durationMonths',
        value === '' ? undefined : parseDurationValueToMonths(value, unit),
      );
    },
    [formData.items, isReadOnly, updateItem],
  );

  const handleDurationUnitChange = useCallback(
    (index: number, newUnit: DurationUnit) => {
      if (isReadOnly) return;
      const items = formData.items || [];
      const item = items[index];
      if (!item || normalizeDurationUnit(item.durationUnit) === newUnit) return;
      // Switch unit and recompute canonical months in a single update so the line never lands in a
      // transient state (durationMonths under the old unit). 'na' (N/A) applies the neutral ×1
      // multiplier — the value input is disabled and duration never scales the line (issue #775).
      const durationValue = getDurationInputValue(item);
      const durationMonths =
        newUnit === 'na' || durationValue === undefined
          ? undefined
          : durationValueToMonths(durationValue, newUnit);
      const nextItems = items.map((current, i) =>
        i === index ? { ...current, durationMonths, durationUnit: newUnit } : current,
      );
      dispatch({ type: 'patchForm', patch: { items: nextItems } });
    },
    [formData.items, isReadOnly],
  );

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (!editingOrder) return;

      const items = formData.items || [];
      if (items.some((item) => !isPositiveFiniteNumber(item.quantity))) {
        toastError(t('common:validation.positiveQuantityRequired'));
        return;
      }
      if (items.some((item) => !isFiniteNumber(item.unitPrice))) {
        toastError(t('common:validation.unitPriceRequired'));
        return;
      }

      await onUpdateOrder(editingOrder.id, {
        ...formData,
        discount: Number(formData.discount ?? 0),
        items: (formData.items || []).map((item) => ({
          ...item,
          unitPrice: Number(item.unitPrice) || 0,
          discount: item.discount === undefined ? undefined : Number(item.discount),
          legacyDiscountRounding: item.legacyDiscountRounding === true,
          unitType: item.unitType || 'hours',
          ...normalizeDurationForSubmit(item),
        })),
      });

      dispatch({ type: 'submitSuccess' });
    },
    [editingOrder, formData, onUpdateOrder, t],
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

  // A client-order line shortcut deep-links here pre-filtered to a single supplier
  // order by its own id. That filter is handed to the table as a *clearable* column
  // filter (see tableInitialFilterState below), like the product / client-order
  // quick-view shortcuts, so the user can drop back to the full list in place rather
  // than being stuck on one row. The own-id deep link wins over the linked-quote
  // (quoteFilterId) array filter, and skipping the latter leaves the column filter the
  // full list to match against.
  const filteredOrders = useMemo(() => {
    if (!orderFilterId && quoteFilterId) {
      return orders.filter((o) => o.linkedQuoteId === quoteFilterId);
    }
    return orders;
  }, [orders, orderFilterId, quoteFilterId]);

  const tableInitialFilterState = useMemo(
    () => (orderFilterId ? { id: [orderFilterId] } : undefined),
    [orderFilterId],
  );

  const columns = useMemo(
    () => [
      {
        header: t('accounting:supplierOrders.orderNumber'),
        id: 'id',
        accessorFn: (row: SupplierSaleOrder) => row.id,
        cell: ({ row }: { row: SupplierSaleOrder }) => (
          <span className="font-bold text-foreground">{row.id}</span>
        ),
      },
      {
        header: t('accounting:supplierOrders.supplier'),
        id: 'supplierName',
        accessorFn: (row: SupplierSaleOrder) => row.supplierName,
        cell: ({ row }: { row: SupplierSaleOrder }) => {
          const isMuted = row.status === 'sent';

          return (
            <span className={`font-bold ${isMuted ? 'text-muted-foreground' : 'text-foreground'}`}>
              {row.supplierName}
            </span>
          );
        },
      },
      {
        header: t('accounting:supplierOrders.linkedQuote'),
        id: 'linkedQuote',
        accessorFn: (row: SupplierSaleOrder) =>
          row.linkedQuoteId
            ? formatDocumentCode(
                row.linkedQuoteId,
                row.linkedQuoteRevisionCode ??
                  quotes.find((quote) => quote.id === row.linkedQuoteId)?.revisionCode,
              )
            : '',
        className: 'whitespace-nowrap',
        cell: ({ row }: { row: SupplierSaleOrder }) => {
          if (!row.linkedQuoteId) {
            return (
              <span className="text-sm italic text-muted-foreground">
                {t('accounting:supplierOrders.noQuoteLink')}
              </span>
            );
          }

          const isMuted = row.status === 'sent';

          return (
            <span
              className={`font-mono text-xs font-semibold uppercase tracking-wider ${
                isMuted ? 'text-muted-foreground' : 'text-foreground'
              }`}
            >
              {formatDocumentCode(
                row.linkedQuoteId,
                row.linkedQuoteRevisionCode ??
                  quotes.find((quote) => quote.id === row.linkedQuoteId)?.revisionCode,
              )}
            </span>
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
            <span
              className={`text-sm font-bold ${isMuted ? 'text-muted-foreground' : 'text-foreground'}`}
            >
              {formatDecimal(total)} {currency}
            </span>
          );
        },
        filterFormat: (value: unknown) => formatDecimal(value as number),
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
              className={`text-sm font-semibold ${isMuted ? 'text-muted-foreground' : 'text-foreground'}`}
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
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          const linkedQuoteId = row.linkedQuoteId;
                          if (!linkedQuoteId) return;
                          onViewQuote(linkedQuoteId);
                        }}
                        aria-label={t('accounting:supplierOrders.viewQuote')}
                        className={TABLE_ROW_ACTION_BUTTON_CLASSNAME}
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
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        openEditModal(row);
                      }}
                      aria-label={
                        isDraft
                          ? t('accounting:supplierOrders.editOrder')
                          : t('accounting:supplierOrders.viewOrder')
                      }
                      className={TABLE_ROW_ACTION_BUTTON_CLASSNAME}
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
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          void onUpdateOrder(row.id, { status: 'sent' });
                        }}
                        aria-label={t('accounting:supplierOrders.markSent')}
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
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          void onCreateInvoice(row);
                        }}
                        aria-label={t('accounting:supplierOrders.createInvoice')}
                        className={TABLE_ROW_ACTION_BUTTON_CLASSNAME}
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
      quotes,
      t,
    ],
  );

  return {
    baseReadOnly,
    closeDeleteConfirm,
    closeEditModal,
    columns,
    currency,
    editingOrder,
    filteredOrders,
    formData,
    handleClearPreview,
    handleDelete,
    handleDurationUnitChange,
    handleDurationValueChange,
    handleUnitTypeChange,
    handleSubmit,
    handleVersionPreview,
    handleVersionRestored,
    i18n,
    isDeleteConfirmOpen,
    isModalOpen,
    isReadOnly,
    onViewQuote,
    quotes,
    openEditModal,
    orderToDelete,
    patchForm,
    paymentTermsOptions,
    previewVersion,
    products,
    productOptions,
    removeItem,
    supplierOptions,
    suppliers,
    t,
    tableInitialFilterState,
    totals,
    updateItem,
  };
};

type SupplierOrdersController = ReturnType<typeof useSupplierOrdersController>;

const SupplierOrdersView: React.FC<SupplierOrdersViewProps> = (props) => {
  const controller = useSupplierOrdersController(props);
  return <SupplierOrdersLayout controller={controller} />;
};

const SupplierOrdersLayout: React.FC<{ controller: SupplierOrdersController }> = ({
  controller,
}) => (
  <div className="space-y-8">
    <SupplierOrderModal controller={controller} />
    <SupplierOrderDeleteDialog controller={controller} />
    <SupplierOrdersHeader controller={controller} />
    <StandardTable<SupplierSaleOrder>
      title={controller.t('accounting:supplierOrders.title')}
      data={controller.filteredOrders}
      columns={controller.columns}
      initialFilterState={controller.tableInitialFilterState}
      defaultRowsPerPage={10}
      containerClassName="overflow-visible"
      rowClassName={(row: SupplierSaleOrder) =>
        row.status === 'sent' ? 'bg-muted text-muted-foreground' : 'hover:bg-muted/50'
      }
      onRowClick={(row: SupplierSaleOrder) => controller.openEditModal(row)}
    />
  </div>
);

const SupplierOrdersHeader: React.FC<{ controller: SupplierOrdersController }> = ({
  controller,
}) => (
  <div className="space-y-4">
    <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
      <div>
        <h2 className="text-2xl font-semibold text-foreground">
          {controller.t('accounting:supplierOrders.title')}
        </h2>
        <p className="text-sm text-muted-foreground">
          {controller.t('accounting:supplierOrders.subtitle')}
        </p>
      </div>
    </div>
  </div>
);

const SupplierOrderModal: React.FC<{ controller: SupplierOrdersController }> = ({ controller }) => (
  <Modal isOpen={controller.isModalOpen} onClose={controller.closeEditModal}>
    <ModalContent size="full" className="max-h-[90vh]">
      <form onSubmit={controller.handleSubmit} className="flex min-h-0 flex-1 flex-col">
        <ModalHeader>
          <div className="flex w-full items-start justify-between gap-4">
            <ModalTitle className="min-w-0 flex-1 flex-wrap items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-md bg-muted text-primary">
                <i
                  className={`fa-solid ${controller.isReadOnly ? 'fa-eye' : 'fa-pen-to-square'}`}
                  aria-hidden="true"
                ></i>
              </span>
              {controller.t('accounting:supplierOrders.editOrder')}
              {controller.baseReadOnly ? (
                <ModalReadOnlyStatusBanner>
                  {controller.t('accounting:supplierOrders.readOnlyStatus')}
                </ModalReadOnlyStatusBanner>
              ) : null}
            </ModalTitle>
            <ModalCloseButton onClick={controller.closeEditModal} />
          </div>
        </ModalHeader>
        <ModalBody className="flex-1 space-y-5">
          {controller.editingOrder?.id ? (
            <div className="flex justify-end">
              <SupplierOrderVersionsPanel
                className="w-full max-w-2xl"
                orderId={controller.editingOrder.id}
                selectedVersionId={controller.previewVersion?.id ?? null}
                onPreview={controller.handleVersionPreview}
                onClearPreview={controller.handleClearPreview}
                onRestored={controller.handleVersionRestored}
                disabled={controller.baseReadOnly}
              />
            </div>
          ) : null}
          <SupplierOrderModalAlerts controller={controller} />
          <SupplierOrderDetailsSection controller={controller} />
          <SupplierOrderItemsSection controller={controller} />
          <SupplierOrderNotesSummarySection controller={controller} />
        </ModalBody>
        <ModalFooter>
          <Button type="button" variant="outline" onClick={controller.closeEditModal}>
            {controller.t('common:buttons.cancel')}
          </Button>
          {!controller.isReadOnly && (
            <Button type="submit">{controller.t('common:buttons.update')}</Button>
          )}
        </ModalFooter>
      </form>
    </ModalContent>
  </Modal>
);

const SupplierOrderSectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-primary">
    <span className="size-1.5 rounded-full bg-primary"></span>
    {children}
  </h4>
);

const SupplierOrderModalAlerts: React.FC<{ controller: SupplierOrdersController }> = ({
  controller,
}) => (
  <>
    {controller.formData.linkedQuoteId && (
      <LinkedRecordBanner
        label={controller.t('accounting:supplierOrders.linkedQuote')}
        value={controller.t('accounting:supplierOrders.linkedQuoteInfo', {
          number: formatDocumentCode(
            controller.formData.linkedQuoteId,
            controller.formData.linkedQuoteRevisionCode ??
              controller.quotes.find((quote) => quote.id === controller.formData.linkedQuoteId)
                ?.revisionCode,
          ),
        })}
        note={controller.t('accounting:supplierOrders.quoteDetailsReadOnly')}
        action={
          controller.onViewQuote
            ? {
                label: controller.t('accounting:supplierOrders.viewQuote'),
                onClick: () => {
                  const linkedQuoteId = controller.formData.linkedQuoteId;
                  if (!linkedQuoteId) return;
                  controller.onViewQuote?.(linkedQuoteId);
                },
              }
            : undefined
        }
      />
    )}
  </>
);

const SupplierOrderDetailsSection: React.FC<{ controller: SupplierOrdersController }> = ({
  controller,
}) => (
  <div className="space-y-2">
    <SupplierOrderSectionTitle>
      {controller.t('accounting:supplierOrders.orderDetails')}
    </SupplierOrderSectionTitle>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
      <Field>
        <SelectControl
          id="supplier-order-supplier"
          options={controller.supplierOptions}
          value={controller.formData.supplierId || ''}
          onChange={(value) => {
            const supplier = controller.suppliers.find((item) => item.id === value);
            controller.patchForm({
              supplierId: value as string,
              supplierName: supplier?.name || '',
            });
          }}
          searchable={true}
          disabled={controller.isReadOnly}
          label={controller.t('accounting:supplierOrders.supplier')}
          buttonClassName="h-9"
        />
      </Field>
      <Field>
        <FieldLabel>{controller.t('accounting:supplierOrders.orderNumber')}</FieldLabel>
        <div className="flex h-9 items-center rounded-md border border-border bg-muted/30 px-3 text-sm font-medium text-foreground">
          {controller.editingOrder?.id || '-'}
        </div>
      </Field>
      <Field>
        <SelectControl
          id="supplier-order-payment-terms"
          options={controller.paymentTermsOptions}
          value={controller.formData.paymentTerms || 'immediate'}
          onChange={(value) =>
            controller.patchForm({ paymentTerms: value as SupplierSaleOrder['paymentTerms'] })
          }
          searchable={false}
          disabled={controller.isReadOnly}
          label={controller.t('accounting:supplierOrders.paymentTerms')}
          buttonClassName="h-9"
        />
      </Field>
    </div>
  </div>
);

const getSupplierOrderItemLineTotal = (item: SupplierSaleOrderItem) => getDiscountedLineTotal(item);

const SupplierOrderItemsSection: React.FC<{ controller: SupplierOrdersController }> = ({
  controller,
}) => {
  const items = controller.formData.items;
  const getIndex = useMemo(() => createLineItemIndexResolver(items), [items]);

  const columns: Column<SupplierSaleOrderItem>[] = [
    {
      id: 'product',
      header: controller.t('crm:quotes.productsServices'),
      minWidth: 244,
      accessorFn: (item) => item.productName || '',
      cell: ({ row }) => (
        <div className="min-w-[220px]">
          <SupplierOrderItemProductField controller={controller} item={row} index={getIndex(row)} />
        </div>
      ),
    },
    {
      id: 'listPrice',
      header: controller.t('sales:supplierQuotes.listPrice', { defaultValue: 'List Price' }),
      accessorKey: 'unitPrice',
      align: 'right',
      cell: ({ row }) => (
        <div className="min-w-[140px]">
          <SupplierOrderItemPriceField controller={controller} item={row} index={getIndex(row)} />
        </div>
      ),
    },
    {
      id: 'discountToUs',
      header: controller.t('sales:supplierQuotes.discountToUs', {
        defaultValue: 'Discount to Us',
      }),
      accessorFn: (item) => item.discount || 0,
      align: 'right',
      cell: ({ row }) => (
        <div className="min-w-[120px]">
          <SupplierOrderItemDiscountField
            controller={controller}
            item={row}
            index={getIndex(row)}
          />
        </div>
      ),
    },
    {
      id: 'unitCost',
      header: controller.t('sales:supplierQuotes.unitCost', { defaultValue: 'Unit Cost' }),
      accessorFn: (item) => getDiscountedUnitPrice(item.unitPrice, item.discount),
      align: 'right',
      cell: ({ row }) => (
        <div className="min-w-[110px]">
          <SupplierOrderItemUnitCostField controller={controller} item={row} />
        </div>
      ),
    },
    {
      id: 'quantity',
      header: controller.t('sales:supplierQuotes.qty', { defaultValue: 'Qty' }),
      minWidth: 174,
      accessorKey: 'quantity',
      align: 'right',
      cell: ({ row }) => (
        <div className="min-w-[120px]">
          <SupplierOrderItemQuantityField
            controller={controller}
            item={row}
            index={getIndex(row)}
          />
        </div>
      ),
    },
    {
      id: 'duration',
      header: controller.t('accounting:supplierOrders.durationColumn', {
        defaultValue: 'Duration',
      }),
      minWidth: 174,
      accessorFn: (item) => getEffectiveDurationMultiplier(item),
      align: 'right',
      cell: ({ row }) => (
        <div className="min-w-[150px]">
          <SupplierOrderItemDurationField
            controller={controller}
            index={getIndex(row)}
            durationUnit={normalizeDurationUnit(row.durationUnit)}
            durationValue={getDurationInputValue(row)}
          />
        </div>
      ),
    },
    {
      id: 'total',
      header: controller.t('common:labels.total'),
      accessorFn: getSupplierOrderItemLineTotal,
      align: 'right',
      cell: ({ row }) => (
        <SupplierOrderItemTotalField
          controller={controller}
          lineTotal={getSupplierOrderItemLineTotal(row)}
          className="min-w-[120px]"
        />
      ),
    },
    {
      id: 'notes',
      header: controller.t('accounting:supplierOrders.notes'),
      minWidth: LINE_ITEM_NOTE_COLUMN_MIN_WIDTH,
      accessorFn: (item) => item.note || '',
      cell: ({ row }) => (
        <div className={LINE_ITEM_NOTE_CELL_CLASSNAME}>
          <SupplierOrderItemNoteField controller={controller} item={row} index={getIndex(row)} />
        </div>
      ),
    },
    {
      id: 'actions',
      header: controller.t('common:labels.actions'),
      align: 'right',
      cell: ({ row }) => (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => controller.removeItem(getIndex(row))}
          disabled={controller.isReadOnly}
          className="text-muted-foreground hover:text-destructive"
        >
          <i className="fa-solid fa-trash-can" aria-hidden="true"></i>
          <span className="sr-only">{controller.t('common:buttons.delete')}</span>
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-2">
      <SupplierOrderSectionTitle>
        {controller.t('accounting:supplierOrders.items')}
      </SupplierOrderSectionTitle>
      <StandardTable<SupplierSaleOrderItem>
        title={controller.t('accounting:supplierOrders.items')}
        persistenceKey="accounting.supplierOrders.items"
        allowColumnHiding={false}
        data={items ?? []}
        columns={columns}
        defaultRowsPerPage={5}
        shouldBypassFilters={(item) =>
          !isPositiveFiniteNumber(item.quantity) || !isFiniteNumber(item.unitPrice)
        }
        minBodyRows={0}
        tableContainerClassName="overflow-x-auto"
        emptyState={
          <div className="py-8 text-sm text-muted-foreground">
            {controller.t('accounting:supplierOrders.noItemsAdded')}
          </div>
        }
      />
    </div>
  );
};
const SupplierOrderItemProductField: React.FC<{
  controller: SupplierOrdersController;
  item: SupplierSaleOrderItem;
  index: number;
  className?: string;
}> = ({ controller, item, index, className }) => (
  <div className={className}>
    <SelectControl
      options={controller.productOptions}
      value={item.productId}
      onChange={(value) => controller.updateItem(index, 'productId', value as string)}
      searchable={true}
      disabled={controller.isReadOnly}
      buttonClassName="h-9"
    />
  </div>
);

const SupplierOrderItemQuantityField: React.FC<{
  controller: SupplierOrdersController;
  item: SupplierSaleOrderItem;
  index: number;
  className?: string;
  inputClassName?: string;
}> = ({ controller, item, index, className = 'space-y-1', inputClassName = 'text-right' }) => (
  <div className={className}>
    <FieldLabel className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground lg:hidden">
      {controller.t('sales:supplierQuotes.qty', { defaultValue: 'Qty' })}
    </FieldLabel>
    <div className="flex items-center justify-end gap-1">
      <ValidatedNumberInput
        value={item.quantity}
        required
        placeholder="0,00"
        aria-label={controller.t('sales:supplierQuotes.qty', { defaultValue: 'Qty' })}
        disabled={controller.isReadOnly}
        onValueChange={(value) =>
          controller.updateItem(index, 'quantity', value === '' ? Number.NaN : Number(value))
        }
        className={`min-w-[4rem] flex-1 ${inputClassName}`}
      />
      <span className="shrink-0 text-xs font-semibold text-muted-foreground">/</span>
      <UnitTypeSelector
        value={item.unitType || 'hours'}
        onChange={(value) => controller.handleUnitTypeChange(index, value)}
        isSupply={
          controller.products.find((product) => product.id === item.productId)?.type === 'supply'
        }
        quantity={Number(item.quantity) || 0}
        disabled={controller.isReadOnly}
        i18nPrefix="sales:supplierQuotes"
      />
    </div>
  </div>
);

const SupplierOrderItemPriceField: React.FC<{
  controller: SupplierOrdersController;
  item: SupplierSaleOrderItem;
  index: number;
  className?: string;
  inputClassName?: string;
}> = ({ controller, item, index, className = 'space-y-1', inputClassName = 'text-right' }) => (
  <div className={className}>
    <FieldLabel className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground lg:hidden">
      {controller.t('sales:supplierQuotes.listPrice', { defaultValue: 'List Price' })}
    </FieldLabel>
    <ValidatedNumberInput
      value={item.unitPrice}
      required
      placeholder="0,00"
      aria-label={controller.t('sales:supplierQuotes.listPrice', { defaultValue: 'List Price' })}
      formatDecimals={2}
      disabled={controller.isReadOnly}
      onValueChange={(value) =>
        controller.updateItem(index, 'unitPrice', value === '' ? Number.NaN : Number(value))
      }
      className={inputClassName}
    />
  </div>
);

const SupplierOrderItemDiscountField: React.FC<{
  controller: SupplierOrdersController;
  item: SupplierSaleOrderItem;
  index: number;
  className?: string;
  inputClassName?: string;
}> = ({ controller, item, index, className = 'space-y-1', inputClassName = 'text-right' }) => (
  <div className={className}>
    <FieldLabel className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground lg:hidden">
      {controller.t('sales:supplierQuotes.discountToUs', {
        defaultValue: 'Discount to Us',
      })}
    </FieldLabel>
    <div className="flex items-center justify-end gap-1">
      <ValidatedNumberInput
        value={item.discount}
        placeholder="0,00"
        aria-label={controller.t('sales:supplierQuotes.discountToUs', {
          defaultValue: 'Discount to Us',
        })}
        formatDecimals={2}
        min={0}
        max={100}
        disabled={controller.isReadOnly}
        onValueChange={(value) =>
          controller.updateItem(index, 'discount', value === '' ? undefined : Number(value))
        }
        className={`min-w-[4rem] flex-1 ${inputClassName}`}
      />
      <span className="shrink-0 text-xs font-semibold text-muted-foreground">%</span>
    </div>
  </div>
);

const SupplierOrderItemUnitCostField: React.FC<{
  controller: SupplierOrdersController;
  item: SupplierSaleOrderItem;
}> = ({ controller, item }) => (
  <div className="flex items-center justify-end gap-1.5 text-sm font-semibold text-foreground">
    <span>{formatDecimal(getDiscountedUnitPrice(item.unitPrice, item.discount))}</span>
    <span className="text-xs font-semibold text-muted-foreground">{controller.currency}</span>
  </div>
);

const SupplierOrderItemDurationField: React.FC<{
  controller: SupplierOrdersController;
  index: number;
  durationUnit: DurationUnit;
  durationValue?: number;
  className?: string;
  inputClassName?: string;
}> = ({
  controller,
  index,
  durationUnit,
  durationValue,
  className = 'space-y-1',
  inputClassName = 'text-right',
}) => (
  <div className={className}>
    <FieldLabel className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground lg:hidden">
      {controller.t('accounting:supplierOrders.durationColumn', {
        defaultValue: 'Duration',
      })}
    </FieldLabel>
    <div className="flex items-center gap-1">
      <ValidatedNumberInput
        step="1"
        min="1"
        placeholder="0"
        aria-label={controller.t('accounting:supplierOrders.durationColumn', {
          defaultValue: 'Duration',
        })}
        value={durationValue}
        disabled={controller.isReadOnly || durationUnit === 'na'}
        onValueChange={(value) => controller.handleDurationValueChange(index, value)}
        className={inputClassName}
      />
      <span className="shrink-0 text-xs font-semibold text-muted-foreground">/</span>
      <DurationUnitSelector
        value={durationUnit}
        onChange={(value) => controller.handleDurationUnitChange(index, value)}
        count={durationValue ?? 0}
        disabled={controller.isReadOnly}
        i18nPrefix="accounting:supplierOrders"
      />
    </div>
  </div>
);

const SupplierOrderItemNoteField: React.FC<{
  controller: SupplierOrdersController;
  item: SupplierSaleOrderItem;
  index: number;
  className?: string;
}> = ({ controller, item, index, className }) => (
  <div className={className}>
    <Input
      type="text"
      value={item.note || ''}
      disabled={controller.isReadOnly}
      placeholder={controller.t('accounting:supplierOrders.notes')}
      onChange={(event) => controller.updateItem(index, 'note', event.target.value)}
    />
  </div>
);

const SupplierOrderItemTotalField: React.FC<{
  controller: SupplierOrdersController;
  lineTotal: number;
  className?: string;
}> = ({ controller, lineTotal, className = 'space-y-1' }) => (
  <div className={className}>
    <FieldLabel className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground lg:hidden">
      {controller.t('common:labels.total')}
    </FieldLabel>
    <div className="flex items-center justify-end whitespace-nowrap px-3 py-2 text-sm font-semibold text-foreground">
      {formatDecimal(lineTotal)} {controller.currency}
    </div>
  </div>
);

const SupplierOrderNotesSummarySection: React.FC<{ controller: SupplierOrdersController }> = ({
  controller,
}) => (
  <div className="flex flex-col gap-4 border-t border-border pt-4 md:flex-row">
    <Field className="md:w-2/3">
      <SupplierOrderSectionTitle>
        {controller.t('accounting:supplierOrders.notes')}
      </SupplierOrderSectionTitle>
      <FieldLabel htmlFor="supplier-order-notes" className="sr-only">
        {controller.t('accounting:supplierOrders.notes')}
      </FieldLabel>
      <Textarea
        id="supplier-order-notes"
        rows={4}
        value={controller.formData.notes || ''}
        disabled={controller.isReadOnly}
        onChange={(event) => controller.patchForm({ notes: event.target.value })}
        className="min-h-28 resize-none"
      />
    </Field>
    <div className="space-y-2 md:w-1/3">
      <SupplierOrderSectionTitle>
        {controller.t('accounting:supplierOrders.summary', { defaultValue: 'Summary' })}
      </SupplierOrderSectionTitle>
      <CostSummaryPanel
        currency={controller.currency}
        subtotal={controller.totals.grossSubtotal}
        total={controller.totals.total}
        subtotalLabel={controller.t('accounting:supplierOrders.subtotal')}
        totalLabel={controller.t('accounting:supplierOrders.total')}
        globalDiscount={{
          label: controller.t('accounting:supplierOrders.discount'),
          value: controller.formData.discount || 0,
          type: controller.formData.discountType || 'percentage',
          onChange: (value) => controller.patchForm({ discount: value === '' ? 0 : Number(value) }),
          onTypeChange: (type) => controller.patchForm({ discountType: type }),
          disabled: controller.isReadOnly,
        }}
        discountRow={
          controller.totals.totalDiscountAmount > 0
            ? {
                label: controller.t('common:labels.totalDiscount'),
                amount: controller.totals.totalDiscountAmount,
                percentage: controller.totals.totalDiscountPercentage,
              }
            : undefined
        }
      />
    </div>
  </div>
);

const SupplierOrderDeleteDialog: React.FC<{ controller: SupplierOrdersController }> = ({
  controller,
}) => (
  <DeleteConfirmModal
    isOpen={controller.isDeleteConfirmOpen}
    onClose={controller.closeDeleteConfirm}
    onConfirm={() => {
      void controller.handleDelete();
    }}
    title={controller.t('accounting:supplierOrders.deleteTitle')}
    description={`${controller.orderToDelete?.supplierName ?? ''} · ${
      controller.orderToDelete?.linkedQuoteId || controller.orderToDelete?.id || ''
    }`}
  />
);

export default SupplierOrdersView;
