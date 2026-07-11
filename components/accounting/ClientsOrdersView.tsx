import type { TFunction } from 'i18next';
import type React from 'react';
import { useCallback, useMemo, useReducer } from 'react';
import { useTranslation } from 'react-i18next';
import { LinkedRecordBanner } from '@/components/shared/LinkedRecordBanner';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type {
  Client,
  ClientsOrder,
  ClientsOrderItem,
  DurationUnit,
  OrderVersion,
  Product,
  SupplierSaleOrder,
  SupplierUnitType,
} from '../../types';
import {
  addDaysToDateOnly,
  formatDateOnlyForLocale,
  formatInsertDate,
  formatInsertDateTime,
  getLocalDateString,
} from '../../utils/date';
import { createLineItemIndexResolver } from '../../utils/lineItemIndex';
import {
  calcProductSalePrice,
  calculatePricingTotals,
  convertUnitPrice,
  durationValueToMonths,
  formatDecimal,
  formatDiscountValue,
  formatMolPercentage,
  getDurationDisplayValue,
  getItemPricingContext,
  MOL_PERCENTAGE_DECIMALS,
  normalizeDurationUnit,
  type PricingTotals,
  parseDurationValueToMonths,
  parseNumberInputValue,
} from '../../utils/numbers';
import { getPaymentTermsOptions } from '../../utils/options';
import { makeCostUpdater, makeMolUpdater } from '../../utils/pricingHandlers';
import {
  buildProductQuickViewHref,
  buildSupplierOrderQuickViewHref,
} from '../../utils/quickViewLinks';
import { toastError } from '../../utils/toast';
import ProductSelectOrFallback from '../sales/ProductSelectOrFallback';
import CostSummaryPanel from '../shared/CostSummaryPanel';
import DeleteConfirmModal from '../shared/DeleteConfirmModal';
import DurationUnitSelector from '../shared/DurationUnitSelector';
import Modal from '../shared/Modal';
import {
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '../shared/ModalLayout';
import QuickViewLinkButton from '../shared/QuickViewLinkButton';
import SelectControl from '../shared/SelectControl';
import StandardTable, { type Column } from '../shared/StandardTable';
import StatusBadge, { type StatusType } from '../shared/StatusBadge';
import SupplierQuoteCostHint from '../shared/SupplierQuoteCostHint';
import { TABLE_ROW_ACTION_BUTTON_CLASSNAME } from '../shared/tableControlStyles';
import UnitTypeSelector from '../shared/UnitTypeSelector';
import ValidatedNumberInput from '../shared/ValidatedNumberInput';
import OrderVersionsPanel from './OrderVersionsPanel';

export interface ClientsOrdersViewProps {
  orders: ClientsOrder[];
  clients: Client[];
  products: Product[];
  // Supplier orders behind supplier-quoted lines (only ids are read; see buildSupplierOrderQuickViewHref).
  supplierOrders?: SupplierSaleOrder[];
  onUpdateClientsOrder: (id: string, updates: Partial<ClientsOrder>) => Promise<void>;
  onDeleteClientsOrder: (id: string) => Promise<void>;
  onOrderRestored?: (order: ClientsOrder) => void;
  onViewOffer?: (offerId: string) => void;
  currency: string;
  canViewInternalListing?: boolean;
  canViewSupplierOrders?: boolean;
  offerFilterId?: string | null;
  orderFilterId?: string | null;
}

const DEFAULT_UNIT_TYPE: SupplierUnitType = 'hours';

const compactInputClass = 'h-9 max-w-[5rem] flex-none text-right font-medium';
const EMPTY_SUPPLIER_ORDERS: SupplierSaleOrder[] = [];

const convertHourlyToUnit = (hourlyPrice: number, unitType: SupplierUnitType | undefined) =>
  convertUnitPrice(hourlyPrice, 'hours', unitType || DEFAULT_UNIT_TYPE);

const getOrderStatusLabel = (status: ClientsOrder['status'], t: (key: string) => string) => {
  if (status === 'confirmed') return t('accounting:clientsOrders.statusConfirmed');
  if (status === 'denied') return t('accounting:clientsOrders.statusDenied');
  return t('accounting:clientsOrders.statusDraft');
};

const isDeniedRow = (status: ClientsOrder['status']) => status === 'denied';

type ClientsOrdersViewState = {
  isModalOpen: boolean;
  editingOrder: ClientsOrder | null;
  isDeleteConfirmOpen: boolean;
  orderToDelete: ClientsOrder | null;
  productRowToDelete: number | null;
  errors: Record<string, string>;
  previewVersion: OrderVersion | null;
  formData: Partial<ClientsOrder>;
};

type ClientsOrdersViewAction =
  | { type: 'setIsModalOpen'; value: React.SetStateAction<boolean> }
  | { type: 'setEditingOrder'; value: React.SetStateAction<ClientsOrder | null> }
  | { type: 'setIsDeleteConfirmOpen'; value: React.SetStateAction<boolean> }
  | { type: 'setOrderToDelete'; value: React.SetStateAction<ClientsOrder | null> }
  | { type: 'setProductRowToDelete'; value: React.SetStateAction<number | null> }
  | { type: 'setErrors'; value: React.SetStateAction<Record<string, string>> }
  | { type: 'setPreviewVersion'; value: React.SetStateAction<OrderVersion | null> }
  | { type: 'setFormData'; value: React.SetStateAction<Partial<ClientsOrder>> };

const resolveStateAction = <T,>(value: React.SetStateAction<T>, previous: T): T =>
  typeof value === 'function' ? (value as (previous: T) => T)(previous) : value;

const createClientsOrdersInitialState = (): ClientsOrdersViewState => ({
  isModalOpen: false,
  editingOrder: null,
  isDeleteConfirmOpen: false,
  orderToDelete: null,
  productRowToDelete: null,
  errors: {},
  previewVersion: null,
  formData: {
    clientId: '',
    clientName: '',
    items: [],
    paymentTerms: 'immediate',
    discount: 0,
    discountType: 'percentage',
    status: 'draft',
    notes: '',
  },
});

const clientsOrdersViewReducer = (
  state: ClientsOrdersViewState,
  action: ClientsOrdersViewAction,
): ClientsOrdersViewState => {
  switch (action.type) {
    case 'setIsModalOpen':
      return { ...state, isModalOpen: resolveStateAction(action.value, state.isModalOpen) };
    case 'setEditingOrder':
      return { ...state, editingOrder: resolveStateAction(action.value, state.editingOrder) };
    case 'setIsDeleteConfirmOpen':
      return {
        ...state,
        isDeleteConfirmOpen: resolveStateAction(action.value, state.isDeleteConfirmOpen),
      };
    case 'setOrderToDelete':
      return { ...state, orderToDelete: resolveStateAction(action.value, state.orderToDelete) };
    case 'setProductRowToDelete':
      return {
        ...state,
        productRowToDelete: resolveStateAction(action.value, state.productRowToDelete),
      };
    case 'setErrors':
      return { ...state, errors: resolveStateAction(action.value, state.errors) };
    case 'setPreviewVersion':
      return { ...state, previewVersion: resolveStateAction(action.value, state.previewVersion) };
    case 'setFormData':
      return { ...state, formData: resolveStateAction(action.value, state.formData) };
  }
};

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
    return <span className="text-sm font-semibold text-muted-foreground">-</span>;
  }
  return (
    <span
      className={`text-sm ${bold ? 'font-bold' : 'font-semibold'} whitespace-nowrap ${isHistory ? 'text-muted-foreground' : colorClass}`}
    >
      {prefix}
      {formatDecimal(value)} {currency}
    </span>
  );
};

const computeDueDate = (
  createdAt: number | undefined,
  paymentTerms: string | undefined | null,
  t: TFunction,
): string => {
  if (!createdAt) return '-';
  if (paymentTerms === 'immediate') return t('crm:paymentTerms.immediate');
  const baseDate = getLocalDateString(new Date(createdAt));
  const days = Number.parseInt(paymentTerms ?? '', 10);
  if (!Number.isFinite(days) || days <= 0) return formatDateOnlyForLocale(baseDate);
  return formatDateOnlyForLocale(addDaysToDateOnly(baseDate, days));
};

const useClientsOrdersController = ({
  orders,
  clients,
  products,
  supplierOrders = EMPTY_SUPPLIER_ORDERS,
  onUpdateClientsOrder,
  onDeleteClientsOrder,
  onOrderRestored,
  onViewOffer,
  currency,
  canViewInternalListing = true,
  canViewSupplierOrders = true,
  offerFilterId,
  orderFilterId,
}: ClientsOrdersViewProps) => {
  const { t, i18n } = useTranslation(['accounting', 'crm', 'common', 'sales']);
  const [viewState, dispatchViewState] = useReducer(
    clientsOrdersViewReducer,
    undefined,
    createClientsOrdersInitialState,
  );
  const {
    isModalOpen,
    editingOrder,
    isDeleteConfirmOpen,
    orderToDelete,
    productRowToDelete,
    errors,
    previewVersion,
    formData,
  } = viewState;

  const setIsModalOpen = useCallback((value: React.SetStateAction<boolean>) => {
    dispatchViewState({ type: 'setIsModalOpen', value });
  }, []);
  const setEditingOrder = useCallback((value: React.SetStateAction<ClientsOrder | null>) => {
    dispatchViewState({ type: 'setEditingOrder', value });
  }, []);
  const setIsDeleteConfirmOpen = useCallback((value: React.SetStateAction<boolean>) => {
    dispatchViewState({ type: 'setIsDeleteConfirmOpen', value });
  }, []);
  const setOrderToDelete = useCallback((value: React.SetStateAction<ClientsOrder | null>) => {
    dispatchViewState({ type: 'setOrderToDelete', value });
  }, []);
  const setProductRowToDelete = useCallback((value: React.SetStateAction<number | null>) => {
    dispatchViewState({ type: 'setProductRowToDelete', value });
  }, []);
  const setErrors = useCallback((value: React.SetStateAction<Record<string, string>>) => {
    dispatchViewState({ type: 'setErrors', value });
  }, []);
  const setPreviewVersion = useCallback((value: React.SetStateAction<OrderVersion | null>) => {
    dispatchViewState({ type: 'setPreviewVersion', value });
  }, []);
  const setFormData = useCallback((value: React.SetStateAction<Partial<ClientsOrder>>) => {
    dispatchViewState({ type: 'setFormData', value });
  }, []);

  const orderToFormData = useCallback(
    (order: ClientsOrder): Partial<ClientsOrder> => ({
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
    }),
    [],
  );

  const openEditModal = useCallback(
    (order: ClientsOrder) => {
      setEditingOrder(order);
      setFormData(orderToFormData(order));
      setErrors({});
      setPreviewVersion(null);
      setIsModalOpen(true);
    },
    [orderToFormData, setEditingOrder, setErrors, setFormData, setIsModalOpen, setPreviewVersion],
  );

  const closeEditModal = useCallback(() => {
    setIsModalOpen(false);
    setPreviewVersion(null);
    setProductRowToDelete(null);
  }, [setIsModalOpen, setPreviewVersion, setProductRowToDelete]);

  const handleVersionPreview = useCallback(
    (version: OrderVersion) => {
      setPreviewVersion(version);
      setFormData({
        linkedQuoteId: editingOrder?.linkedQuoteId,
        linkedOfferId: editingOrder?.linkedOfferId,
        clientId: version.snapshot.order.clientId,
        clientName: version.snapshot.order.clientName,
        items: version.snapshot.items,
        paymentTerms: version.snapshot.order.paymentTerms,
        discount: version.snapshot.order.discount,
        discountType: version.snapshot.order.discountType || 'percentage',
        status: version.snapshot.order.status,
        notes: version.snapshot.order.notes ?? '',
      });
      setErrors({});
    },
    [editingOrder, setErrors, setFormData, setPreviewVersion],
  );

  const handleClearPreview = useCallback(() => {
    if (editingOrder) setFormData(orderToFormData(editingOrder));
    setPreviewVersion(null);
  }, [editingOrder, orderToFormData, setFormData, setPreviewVersion]);

  const handleVersionRestored = useCallback(
    (updated: ClientsOrder) => {
      setEditingOrder(updated);
      setFormData(orderToFormData(updated));
      setPreviewVersion(null);
      onOrderRestored?.(updated);
    },
    [onOrderRestored, orderToFormData, setEditingOrder, setFormData, setPreviewVersion],
  );

  const handleSubmit = async (e: React.FormEvent) => {
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
        durationMonths: Number(item.durationMonths ?? 1) || 1,
        durationUnit: normalizeDurationUnit(item.durationUnit),
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

    try {
      await onUpdateClientsOrder(editingOrder.id, payload);
      closeEditModal();
    } catch (err) {
      toastError((err as Error).message || t('accounting:clientsOrders.failedToSave'));
    }
  };

  const confirmDelete = useCallback(
    (order: ClientsOrder) => {
      setOrderToDelete(order);
      setIsDeleteConfirmOpen(true);
    },
    [setIsDeleteConfirmOpen, setOrderToDelete],
  );

  const handleDelete = async () => {
    if (!orderToDelete) return;
    try {
      await onDeleteClientsOrder(orderToDelete.id);
      setIsDeleteConfirmOpen(false);
      setOrderToDelete(null);
    } catch (err) {
      toastError((err as Error).message || t('accounting:clientsOrders.failedToDelete'));
    }
  };

  const handleStatusUpdate = useCallback(
    async (id: string, updates: Partial<ClientsOrder>) => {
      try {
        await onUpdateClientsOrder(id, updates);
      } catch (err) {
        toastError((err as Error).message || t('accounting:clientsOrders.failedToUpdateStatus'));
      }
    },
    [onUpdateClientsOrder, t],
  );

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
      durationMonths: 1,
      durationUnit: 'months',
      unitType: DEFAULT_UNIT_TYPE,
      unitPrice: 0,
      productCost: 0,
      productMolPercentage: null,
      discount: 0,
    };
    setFormData((prev) => ({
      ...prev,
      items: [...(formData.items || []), newItem as ClientsOrderItem],
    }));
    if (errors.items) {
      setErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors.items;
        return newErrors;
      });
    }
  };

  const removeProductRow = (index: number) => {
    const currentItems = formData.items || [];
    // Lines backed by an auto-created supplier order must not be removed here: replacing the
    // item list would orphan the linked procurement order, so the backend rejects it (409).
    if (currentItems[index]?.supplierSaleId) return;
    const newItems = [...currentItems];
    newItems.splice(index, 1);
    setFormData((prev) => ({ ...prev, items: newItems }));
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

    setFormData((prev) => ({ ...prev, items: newItems }));
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
    setFormData((prev) => ({ ...prev, items: newItems }));
  };

  // Duration value entered in the item's chosen unit (issue #757). Stored canonically as whole
  // months; 'years' multiplies by 12. Empty/invalid input falls back to 1 of the chosen unit.
  const handleDurationValueChange = (index: number, value: string) => {
    if (isReadOnly) return;
    const unit = normalizeDurationUnit(formData.items?.[index]?.durationUnit);
    updateProductRow(index, 'durationMonths', parseDurationValueToMonths(value, unit));
  };

  // Switching months↔years keeps the displayed number and reinterprets it under the new unit
  // (e.g. "2" months → "2" years = 24 months), mirroring how the quantity unit selector behaves.
  const handleDurationUnitChange = (index: number, newUnit: DurationUnit) => {
    if (isReadOnly) return;
    const item = formData.items?.[index];
    if (!item || normalizeDurationUnit(item.durationUnit) === newUnit) return;
    // 'N/A' marks the line as duration-less: reset to the neutral 1 month so it never multiplies
    // (issue #775). Months/years instead keeps the displayed number under the new unit.
    const durationMonths =
      newUnit === 'na' ? 1 : durationValueToMonths(getDurationDisplayValue(item), newUnit);
    const newItems = [...(formData.items || [])];
    newItems[index] = {
      ...newItems[index],
      durationUnit: newUnit,
      durationMonths,
    };
    setFormData((prev) => ({ ...prev, items: newItems }));
  };

  const activeClients = useMemo(() => clients.filter((c) => !c.isDisabled), [clients]);
  const activeProducts = useMemo(() => products.filter((p) => !p.isDisabled), [products]);
  // All product ids (incl. archived) so the quick-view shortcut on a line that
  // references a now-disabled product still deep-links to that record.
  const allProductIds = useMemo(() => new Set(products.map((p) => p.id)), [products]);
  const allSupplierOrderIds = useMemo(
    () => new Set(supplierOrders.map((o) => o.id)),
    [supplierOrders],
  );
  const activeProductIds = useMemo(
    () => new Set(activeProducts.map((p) => p.id)),
    [activeProducts],
  );
  // Built once per render and shared by every line row, instead of re-mapping per item.
  const productOptions = useMemo(
    () => activeProducts.map((p) => ({ id: p.id, name: p.name })),
    [activeProducts],
  );
  // A supplier-quote-sourced line can carry no catalog product (issue #783) or one that's been
  // archived; show its name read-only instead of an empty product dropdown (mirrors the
  // quote/offer/invoice editors).
  const isLinkedProductMissing = (item: ClientsOrderItem) =>
    Boolean(item.supplierQuoteItemId && (!item.productId || !activeProductIds.has(item.productId)));

  // A confirmed order keeps its identity fixed but remains commercially editable. Denied orders
  // and historical previews are fully read-only.
  const isHistoricalPreviewReadOnly = previewVersion !== null;
  const isDeniedReadOnly = editingOrder?.status === 'denied';
  const isConfirmedIdentityLocked = editingOrder?.status === 'confirmed';
  const isReadOnly = isHistoricalPreviewReadOnly || isDeniedReadOnly;
  const isVersionRestoreLocked = Boolean(editingOrder && editingOrder.status !== 'draft');

  const tableInitialFilterState = useMemo(() => {
    if (orderFilterId) {
      return { id: [orderFilterId] };
    }
    return undefined;
  }, [orderFilterId]);

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
          <span className="font-bold text-foreground">{row.id}</span>
        ),
      },
      {
        header: t('crm:clients.tableHeaders.insertDate'),
        id: 'createdAt',
        accessorFn: (row: ClientsOrder) => row.createdAt ?? 0,
        className: 'whitespace-nowrap',
        cell: ({ row }: { row: ClientsOrder }) => {
          if (!row.createdAt) return <span className="text-xs text-muted-foreground">-</span>;
          return (
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              {formatInsertDate(row.createdAt, i18n.language)}
            </span>
          );
        },
        filterFormat: (value: unknown) => {
          const timestamp = typeof value === 'number' ? value : Number(value);
          if (!Number.isFinite(timestamp) || timestamp <= 0) return '-';
          return formatInsertDate(timestamp, i18n.language);
        },
      },
      {
        header: t('accounting:clientsOrders.clientColumn'),
        accessorFn: (row: ClientsOrder) => row.clientName,
        cell: ({ row }: { row: ClientsOrder }) => (
          <div>
            <div
              className={`font-bold ${isDeniedRow(row.status) ? 'text-muted-foreground' : 'text-foreground'}`}
            >
              {row.clientName}
            </div>
          </div>
        ),
      },
      {
        header: t('sales:clientQuotes.globalDiscount'),
        id: 'globalDiscount',
        accessorFn: (row: ClientsOrder) =>
          formatDiscountValue(row.discount, row.discountType, currency),
        className: 'whitespace-nowrap',
        headerClassName: 'min-w-[9rem]',
        disableSorting: true,
        cell: ({ row }: { row: ClientsOrder }) => {
          const history = isDeniedRow(row.status);
          return (
            <span
              className={`text-sm font-semibold whitespace-nowrap ${history ? 'text-muted-foreground' : 'text-foreground'}`}
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
            isHistory={isDeniedRow(row.status)}
            colorClass="text-foreground"
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
            isHistory={isDeniedRow(row.status)}
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
            isHistory={isDeniedRow(row.status)}
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
            isHistory={isDeniedRow(row.status)}
            colorClass="text-foreground"
            currency={currency}
          />
        ),
      },
      {
        header: t('accounting:clientsOrders.totalColumn'),
        accessorFn: (row: ClientsOrder) => orderPricingMap.get(row.id)?.total ?? 0,
        className: 'whitespace-nowrap',
        headerClassName: 'min-w-[8rem]',
        disableFiltering: true,
        cell: ({ row, value }: { row: ClientsOrder; value: unknown }) => (
          <PricingCell
            value={Number(value)}
            isHistory={isDeniedRow(row.status)}
            colorClass="text-foreground"
            bold
            currency={currency}
          />
        ),
        filterFormat: (val: unknown) => formatDecimal(val as number),
      },
      {
        header: t('accounting:clientsOrders.paymentTermsColumn'),
        accessorFn: (row: ClientsOrder) =>
          row.paymentTerms === 'immediate' ? t('crm:paymentTerms.immediate') : row.paymentTerms,
        className: 'whitespace-nowrap',
        headerClassName: 'min-w-[10rem]',
        cell: ({ row }: { row: ClientsOrder }) => (
          <span
            className={`text-sm font-semibold ${isDeniedRow(row.status) ? 'text-muted-foreground' : 'text-foreground'}`}
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
          <div className={isDeniedRow(row.status) ? 'opacity-60' : ''}>
            <StatusBadge
              type={row.status as StatusType}
              label={getOrderStatusLabel(row.status, t)}
            />
          </div>
        ),
      },
      {
        header: t('accounting:clientsOrders.actionsColumn'),
        id: 'actions',
        className: 'whitespace-nowrap',
        headerClassName: 'min-w-[9rem]',
        disableSorting: true,
        disableFiltering: true,
        align: 'right' as const,
        cell: ({ row }: { row: ClientsOrder }) => (
          <div className="flex justify-end gap-2">
            {onViewOffer && row.linkedOfferId && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onViewOffer(row.linkedOfferId as string);
                      }}
                      aria-label={t('sales:clientOffers.viewOffer', { defaultValue: 'View offer' })}
                      className={TABLE_ROW_ACTION_BUTTON_CLASSNAME}
                    >
                      <i className="fa-solid fa-link"></i>
                    </button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {t('sales:clientOffers.viewOffer', { defaultValue: 'View offer' })}
                </TooltipContent>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      openEditModal(row);
                    }}
                    aria-label={
                      row.status === 'denied'
                        ? t('accounting:clientsOrders.viewOrder')
                        : t('accounting:clientsOrders.editOrder')
                    }
                    className={TABLE_ROW_ACTION_BUTTON_CLASSNAME}
                  >
                    <i
                      className={`fa-solid ${row.status === 'denied' ? 'fa-eye' : 'fa-pen-to-square'}`}
                    ></i>
                  </button>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {row.status === 'denied'
                  ? t('accounting:clientsOrders.viewOrder')
                  : t('accounting:clientsOrders.editOrder')}
              </TooltipContent>
            </Tooltip>
            {row.status === 'draft' && (
              <>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleStatusUpdate(row.id, { status: 'confirmed' });
                        }}
                        aria-label={t('accounting:clientsOrders.markAsConfirmed')}
                        className="p-2 text-emerald-700 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-all"
                      >
                        <i className="fa-solid fa-check"></i>
                      </button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{t('accounting:clientsOrders.markAsConfirmed')}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleStatusUpdate(row.id, { status: 'denied' });
                        }}
                        aria-label={t('accounting:clientsOrders.markAsDenied')}
                        className="p-2 text-red-600 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                      >
                        <i className="fa-solid fa-xmark"></i>
                      </button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{t('accounting:clientsOrders.markAsDenied')}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          confirmDelete(row);
                        }}
                        aria-label={t('accounting:clientsOrders.deleteOrder')}
                        className="p-2 text-red-600 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                      >
                        <i className="fa-solid fa-trash-can"></i>
                      </button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{t('accounting:clientsOrders.deleteOrder')}</TooltipContent>
                </Tooltip>
              </>
            )}
          </div>
        ),
      },
    ],
    [
      currency,
      handleStatusUpdate,
      onViewOffer,
      t,
      confirmDelete,
      openEditModal,
      orderPricingMap,
      i18n.language,
    ],
  );

  return {
    activeClients,
    addProductRow,
    allProductIds,
    allSupplierOrderIds,
    canViewInternalListing,
    canViewSupplierOrders,
    closeEditModal,
    columns,
    currency,
    editingOrder,
    errors,
    filteredOrders,
    formData,
    handleClearPreview,
    handleClientChange,
    handleDelete,
    handleDurationUnitChange,
    handleDurationValueChange,
    handleSubmit,
    handleUnitTypeChange,
    handleVersionPreview,
    handleVersionRestored,
    i18n,
    isDeleteConfirmOpen,
    isConfirmedIdentityLocked,
    isLinkedProductMissing,
    isModalOpen,
    isReadOnly,
    isVersionRestoreLocked,
    onViewOffer,
    openEditModal,
    orderToDelete,
    paymentTermsOptions,
    previewVersion,
    productOptions,
    productRowToDelete,
    products,
    removeProductRow,
    setFormData,
    setIsDeleteConfirmOpen,
    setProductRowToDelete,
    t,
    tableInitialFilterState,
    updateProductRow,
  };
};

type ClientsOrdersController = ReturnType<typeof useClientsOrdersController>;

const ClientsOrdersView: React.FC<ClientsOrdersViewProps> = (props) => {
  const controller = useClientsOrdersController(props);
  return <ClientsOrdersLayout controller={controller} />;
};

const ClientsOrdersLayout: React.FC<{ controller: ClientsOrdersController }> = ({ controller }) => (
  <div className="space-y-8">
    <ClientsOrderModal controller={controller} />
    <ClientsOrdersDeleteDialogs controller={controller} />
    <ClientsOrdersHeader controller={controller} />
    <StandardTable<ClientsOrder>
      title={controller.t('accounting:clientsOrders.title')}
      data={controller.filteredOrders}
      columns={controller.columns}
      defaultRowsPerPage={10}
      initialFilterState={controller.tableInitialFilterState}
      containerClassName="overflow-visible"
      rowClassName={(row: ClientsOrder) =>
        isDeniedRow(row.status) ? 'bg-muted text-muted-foreground' : 'hover:bg-muted/50'
      }
      onRowClick={(row: ClientsOrder) => controller.openEditModal(row)}
    />
  </div>
);

const ClientsOrdersHeader: React.FC<{ controller: ClientsOrdersController }> = ({ controller }) => (
  <div className="space-y-4">
    <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
      <div>
        <h2 className="text-2xl font-semibold text-foreground">
          {controller.t('accounting:clientsOrders.title')}
        </h2>
        <p className="text-sm text-muted-foreground">
          {controller.t('accounting:clientsOrders.subtitle')}
        </p>
      </div>
    </div>
  </div>
);

const ClientsOrderModal: React.FC<{ controller: ClientsOrdersController }> = ({ controller }) => (
  <Modal isOpen={controller.isModalOpen} onClose={controller.closeEditModal}>
    <div className="flex max-w-[calc(100vw-2rem)] items-start gap-4">
      <ModalContent size="full" className="max-h-[90vh]">
        <form onSubmit={controller.handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <ModalHeader>
            <ModalTitle className="gap-3">
              <span className="flex size-10 items-center justify-center rounded-md bg-muted text-primary">
                <i
                  className={`fa-solid ${controller.isReadOnly ? 'fa-eye' : 'fa-pen-to-square'}`}
                  aria-hidden="true"
                ></i>
              </span>
              {controller.isReadOnly
                ? controller.t('common:buttons.view')
                : controller.t('accounting:clientsOrders.editOrder')}
            </ModalTitle>
            <ModalCloseButton onClick={controller.closeEditModal} />
          </ModalHeader>
          <ModalBody className="flex-1 space-y-5">
            <ClientsOrderModalAlerts controller={controller} />
            <OrderDetailsSection controller={controller} />
            <OrderItemsSection controller={controller} />
            <OrderNotesSummarySection controller={controller} />
          </ModalBody>
          <ModalFooter>
            <Button type="button" variant="outline" onClick={controller.closeEditModal}>
              {controller.t('common:buttons.cancel')}
            </Button>
            {!controller.previewVersion && (
              <Button type="submit" disabled={controller.isReadOnly}>
                {controller.t('accounting:clientsOrders.updateOrder')}
              </Button>
            )}
          </ModalFooter>
        </form>
      </ModalContent>
      {controller.editingOrder?.id && (
        <OrderVersionsPanel
          orderId={controller.editingOrder.id}
          selectedVersionId={controller.previewVersion?.id ?? null}
          onPreview={controller.handleVersionPreview}
          onClearPreview={controller.handleClearPreview}
          onRestored={controller.handleVersionRestored}
          disabled={controller.isVersionRestoreLocked}
        />
      )}
    </div>
  </Modal>
);

const ClientsOrderModalAlerts: React.FC<{ controller: ClientsOrdersController }> = ({
  controller,
}) => (
  <>
    {controller.previewVersion && (
      <div className="flex items-center justify-between gap-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-3">
        <span className="flex items-center gap-2 text-xs font-medium text-amber-700 dark:text-amber-300">
          <i className="fa-solid fa-clock-rotate-left" aria-hidden="true"></i>
          {controller.t('accounting:clientsOrders.versionHistory.previewBanner', {
            date: formatInsertDateTime(
              controller.previewVersion.createdAt,
              controller.i18n.language,
            ),
            defaultValue: 'Previewing version from {{date}}',
          })}
        </span>
        <Button
          type="button"
          variant="link"
          size="sm"
          onClick={controller.handleClearPreview}
          className="h-auto px-0 text-amber-700 dark:text-amber-300"
        >
          {controller.t('accounting:clientsOrders.versionHistory.backToCurrent', {
            defaultValue: 'Back to current',
          })}
        </Button>
      </div>
    )}
    {controller.editingOrder?.status === 'confirmed' && (
      <div className="flex items-center gap-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-3">
        <span className="text-xs font-medium text-amber-700 dark:text-amber-300">
          {controller.t('accounting:clientsOrders.confirmedIdentityLockedStatus')}
        </span>
      </div>
    )}
    {controller.editingOrder?.status === 'denied' && (
      <div className="flex items-center gap-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-3">
        <span className="text-xs font-medium text-amber-700 dark:text-amber-300">
          {controller.t('accounting:clientsOrders.readOnlyStatus', {
            status: getOrderStatusLabel(controller.editingOrder.status, controller.t),
          })}
        </span>
      </div>
    )}
    {controller.formData.linkedOfferId && (
      <LinkedRecordBanner
        label={controller.t('accounting:clientsOrders.linkedOffer', {
          defaultValue: 'Linked Offer',
        })}
        value={controller.t('accounting:clientsOrders.linkedOfferInfo', {
          number: controller.formData.linkedOfferId,
          defaultValue: 'Offer #{{number}}',
        })}
        note={
          controller.isReadOnly
            ? controller.t('accounting:clientsOrders.offerDetailsReadOnly', {
                defaultValue: '(Order details are read-only)',
              })
            : controller.t('accounting:clientsOrders.offerDetailsEditable', {
                defaultValue: '(Order details are editable)',
              })
        }
        action={
          controller.onViewOffer && controller.formData.linkedOfferId
            ? {
                label: controller.t('sales:clientOffers.viewOffer', {
                  defaultValue: 'View offer',
                }),
                onClick: () =>
                  controller.onViewOffer?.(controller.formData.linkedOfferId as string),
              }
            : undefined
        }
      />
    )}
  </>
);

const OrderSectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-primary">
    <span className="size-1.5 rounded-full bg-primary"></span>
    {children}
  </h4>
);

const OrderDetailsSection: React.FC<{ controller: ClientsOrdersController }> = ({ controller }) => (
  <div className="space-y-2">
    <OrderSectionTitle>{controller.t('accounting:clientsOrders.orderDetails')}</OrderSectionTitle>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Field data-invalid={Boolean(controller.errors.clientId)}>
        <SelectControl
          id="client-order-client"
          options={controller.activeClients.map((client) => ({ id: client.id, name: client.name }))}
          value={controller.formData.clientId || ''}
          onChange={(value) => controller.handleClientChange(value as string)}
          label={controller.t('accounting:clientsOrders.client')}
          required
          placeholder={controller.t('sales:clientQuotes.selectAClient')}
          searchable={true}
          disabled={controller.isReadOnly || controller.isConfirmedIdentityLocked}
          buttonClassName={controller.errors.clientId ? 'h-9 border-destructive' : 'h-9'}
        />
        <FieldError className="text-xs">{controller.errors.clientId}</FieldError>
      </Field>
      <Field>
        <FieldLabel>
          {controller.t('accounting:clientsOrders.orderNumber', {
            defaultValue: 'Order Number',
          })}
        </FieldLabel>
        <div
          className={`flex h-9 items-center rounded-md border border-border px-3 text-sm font-medium ${
            controller.isReadOnly || controller.isConfirmedIdentityLocked
              ? 'bg-muted text-muted-foreground'
              : 'bg-muted/30 text-foreground'
          }`}
        >
          {controller.editingOrder?.id || '-'}
        </div>
      </Field>
      <Field>
        <SelectControl
          id="client-order-payment-terms"
          options={controller.paymentTermsOptions}
          value={controller.formData.paymentTerms || 'immediate'}
          onChange={(value) =>
            controller.setFormData((prev) => ({
              ...prev,
              paymentTerms: value as ClientsOrder['paymentTerms'],
            }))
          }
          label={controller.t('accounting:clientsOrders.paymentTerms')}
          searchable={false}
          disabled={controller.isReadOnly}
          buttonClassName="h-9"
        />
      </Field>
      <Field>
        <FieldLabel>
          {controller.t('accounting:clientsOrders.paymentDueDate', {
            defaultValue: 'Payment due date',
          })}
        </FieldLabel>
        <div className="flex h-9 items-center rounded-md border border-border bg-muted/30 px-3 text-sm font-medium text-foreground">
          {computeDueDate(
            controller.editingOrder?.createdAt,
            controller.formData.paymentTerms,
            controller.t,
          )}
        </div>
      </Field>
    </div>
  </div>
);

const getClientsOrderItemPricing = (item: ClientsOrderItem) =>
  getItemPricingContext(item, DEFAULT_UNIT_TYPE);

const getClientsOrderItemRevenue = (item: ClientsOrderItem) =>
  getClientsOrderItemPricing(item).netRevenue;

const getClientsOrderItemMargin = (item: ClientsOrderItem) =>
  getClientsOrderItemPricing(item).lineMargin;
const OrderItemsSection: React.FC<{ controller: ClientsOrdersController }> = ({ controller }) => {
  const items = controller.formData.items;
  const getIndex = useMemo(() => createLineItemIndexResolver(items), [items]);

  const columns: Column<ClientsOrderItem>[] = [
    {
      id: 'supplierOrder',
      header: controller.t('accounting:clientsOrders.supplierOrderColumn', {
        defaultValue: 'Supplier Order',
      }),
      accessorFn: (item) =>
        item.supplierSaleId
          ? `${item.supplierSaleSupplierName ?? ''} ${item.supplierSaleId}`.trim()
          : '',
      cell: ({ row }) => (
        <div className="min-w-[220px]">
          <OrderItemSupplierField controller={controller} item={row} />
        </div>
      ),
    },
    {
      id: 'product',
      header: controller.t('sales:clientQuotes.productsServices'),
      accessorFn: (item) =>
        controller.products.find((product) => product.id === item.productId)?.name ||
        item.productName ||
        '',
      cell: ({ row }) => (
        <div className="min-w-[220px]">
          <OrderItemProductField controller={controller} item={row} index={getIndex(row)} />
        </div>
      ),
    },
    {
      id: 'quantity',
      header: controller.t('sales:clientQuotes.qty'),
      accessorKey: 'quantity',
      align: 'right',
      cell: ({ row }) => (
        <div className="min-w-[150px]">
          <OrderItemQuantityField
            controller={controller}
            item={row}
            index={getIndex(row)}
            isSupply={
              controller.products.find((product) => product.id === row.productId)?.type === 'supply'
            }
          />
        </div>
      ),
    },
    {
      id: 'duration',
      header: controller.t('sales:clientQuotes.durationColumn', { defaultValue: 'Duration' }),
      accessorFn: (item) => getClientsOrderItemPricing(item).durationMonths,
      align: 'right',
      cell: ({ row }) => (
        <div className="min-w-[150px]">
          <OrderItemDurationField
            controller={controller}
            index={getIndex(row)}
            durationUnit={normalizeDurationUnit(row.durationUnit)}
            durationValue={getDurationDisplayValue(row)}
          />
        </div>
      ),
    },
    {
      id: 'cost',
      header: controller.t('crm:internalListing.cost'),
      accessorFn: (item) => getClientsOrderItemPricing(item).unitCost,
      align: 'right',
      cell: ({ row }) => (
        <div className="min-w-[130px]">
          <OrderItemCostField
            controller={controller}
            item={row}
            index={getIndex(row)}
            unitCost={getClientsOrderItemPricing(row).unitCost}
          />
        </div>
      ),
    },
    {
      id: 'mol',
      header: controller.t('sales:clientQuotes.molLabel', { defaultValue: 'MOL' }),
      accessorFn: (item) => getClientsOrderItemPricing(item).molPercentage,
      align: 'right',
      cell: ({ row }) => (
        <div className="min-w-[100px]">
          <OrderItemMolField
            controller={controller}
            index={getIndex(row)}
            molPercentage={getClientsOrderItemPricing(row).molPercentage}
          />
        </div>
      ),
    },
    {
      id: 'totalCost',
      header: controller.t('sales:clientQuotes.totalCost', { defaultValue: 'Total cost' }),
      accessorFn: (item) => getClientsOrderItemPricing(item).lineCost,
      align: 'right',
      cell: ({ row }) => (
        <OrderItemAmountField
          label={controller.t('sales:clientQuotes.totalCost', { defaultValue: 'Total cost' })}
          value={getClientsOrderItemPricing(row).lineCost}
          currency={controller.currency}
          className="min-w-[110px]"
        />
      ),
    },
    {
      id: 'discount',
      header: controller.t('common:labels.discount'),
      accessorFn: (item) => item.discount ?? 0,
      align: 'right',
      cell: ({ row }) => (
        <div className="min-w-[110px]">
          <OrderItemDiscountField controller={controller} item={row} index={getIndex(row)} />
        </div>
      ),
    },
    {
      id: 'margin',
      header: controller.t('sales:clientQuotes.marginLabel'),
      accessorFn: getClientsOrderItemMargin,
      align: 'right',
      cell: ({ row }) => (
        <OrderItemAmountField
          label={controller.t('sales:clientQuotes.marginLabel')}
          value={getClientsOrderItemMargin(row)}
          currency={controller.currency}
          className="min-w-[110px]"
          valueClassName="text-emerald-600"
        />
      ),
    },
    {
      id: 'salePrice',
      header: controller.t('crm:internalListing.salePrice'),
      accessorFn: getClientsOrderItemRevenue,
      align: 'right',
      cell: ({ row }) => (
        <OrderItemAmountField
          label={controller.t('crm:internalListing.salePrice')}
          value={getClientsOrderItemRevenue(row)}
          currency={controller.currency}
          className="min-w-[120px]"
        />
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
          onClick={() => controller.setProductRowToDelete(getIndex(row))}
          disabled={controller.isReadOnly || Boolean(row.supplierSaleId)}
          title={
            row.supplierSaleId
              ? controller.t('accounting:clientsOrders.supplierOrderLineLocked', {
                  defaultValue:
                    'This line is linked to a supplier order and cannot be removed here.',
                })
              : undefined
          }
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <OrderSectionTitle>{controller.t('sales:clientQuotes.productsServices')}</OrderSectionTitle>
        <Button
          type="button"
          size="sm"
          onClick={controller.addProductRow}
          disabled={controller.isReadOnly}
        >
          <i className="fa-solid fa-plus text-[10px]" aria-hidden="true"></i>
          {controller.t('sales:clientQuotes.addProduct')}
        </Button>
      </div>
      <FieldError className="text-xs">{controller.errors.items}</FieldError>
      <StandardTable<ClientsOrderItem>
        title={controller.t('sales:clientQuotes.productsServices')}
        persistenceKey="accounting.clientOrders.items"
        allowColumnHiding={false}
        data={items ?? []}
        columns={columns}
        defaultRowsPerPage={5}
        minBodyRows={0}
        tableContainerClassName="overflow-x-auto"
        emptyState={
          <div className="py-8 text-sm text-muted-foreground">
            {controller.t('sales:clientQuotes.noProductsAdded')}
          </div>
        }
      />
    </div>
  );
};
const OrderItemSupplierField: React.FC<{
  controller: ClientsOrdersController;
  item: ClientsOrderItem;
}> = ({ controller, item }) => {
  const supplierOrderHref = buildSupplierOrderQuickViewHref(
    item.supplierSaleId,
    controller.allSupplierOrderIds,
  );

  return (
    <div className="relative min-w-0 space-y-1 lg:col-span-2 lg:space-y-0">
      <FieldLabel className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground lg:hidden">
        {controller.t('accounting:clientsOrders.supplierOrderColumn', {
          defaultValue: 'Supplier Order',
        })}
      </FieldLabel>
      <div className="flex h-9 items-center rounded-md border border-border bg-background px-3">
        {item.supplierSaleId ? (
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
            {item.supplierSaleSupplierName ?? '-'} · {item.supplierSaleId}
          </span>
        ) : (
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {controller.t('accounting:clientsOrders.noSupplierOrder', {
              defaultValue: 'No supplier order',
            })}
          </span>
        )}
        {controller.canViewSupplierOrders && (
          <QuickViewLinkButton
            href={supplierOrderHref}
            label={controller.t('accounting:clientsOrders.openSupplierOrderInNewTab', {
              defaultValue: 'Open supplier order in a new tab',
            })}
            disabledLabel={controller.t(
              'accounting:clientsOrders.supplierOrderShortcutUnavailable',
              { defaultValue: 'No linked supplier order to open' },
            )}
            floating
          />
        )}
      </div>
    </div>
  );
};

const OrderItemProductField: React.FC<{
  controller: ClientsOrdersController;
  item: ClientsOrderItem;
  index: number;
}> = ({ controller, item, index }) => {
  const productHref = buildProductQuickViewHref(item.productId, controller.allProductIds);

  return (
    <div className="min-w-0 space-y-1 lg:col-span-2 lg:space-y-0">
      <FieldLabel className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground lg:hidden">
        {controller.t('sales:clientQuotes.productsServices')}
      </FieldLabel>
      <div className="relative flex items-center gap-1">
        <ProductSelectOrFallback
          item={item}
          index={index}
          options={controller.productOptions}
          isProductMissing={controller.isLinkedProductMissing(item)}
          isReadOnly={controller.isReadOnly}
          ariaLabel={controller.t('sales:clientQuotes.selectProduct')}
          placeholder={controller.t('sales:clientQuotes.selectProduct')}
          onProductChange={(idx, productId) =>
            controller.updateProductRow(idx, 'productId', productId)
          }
          className="min-w-0 flex-1"
          buttonClassName="h-9"
        />
        {controller.canViewInternalListing && (
          <QuickViewLinkButton
            href={productHref}
            label={controller.t('sales:clientQuotes.openProductInNewTab')}
            disabledLabel={controller.t('sales:clientQuotes.productShortcutUnavailable')}
            floating
          />
        )}
      </div>
    </div>
  );
};

const OrderItemQuantityField: React.FC<{
  controller: ClientsOrdersController;
  item: ClientsOrderItem;
  index: number;
  isSupply: boolean;
}> = ({ controller, item, index, isSupply }) => (
  <div className="space-y-1 lg:col-span-2 lg:space-y-0">
    <FieldLabel className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground lg:hidden">
      {controller.t('sales:clientQuotes.qty')}
    </FieldLabel>
    <div className="flex h-9 items-center justify-end gap-1">
      <ValidatedNumberInput
        step="0.01"
        min="0"
        required
        placeholder="Qty"
        value={item.quantity}
        onValueChange={(value) => {
          const parsed = parseFloat(value);
          controller.updateProductRow(
            index,
            'quantity',
            value === '' || Number.isNaN(parsed) ? 0 : parsed,
          );
        }}
        disabled={controller.isReadOnly || Boolean(item.supplierQuoteItemId)}
        className="max-w-[5rem] flex-1 text-right"
      />
      <span className="shrink-0 text-xs font-medium text-muted-foreground">/</span>
      <UnitTypeSelector
        value={(item.unitType || DEFAULT_UNIT_TYPE) as SupplierUnitType}
        onChange={(value) => controller.handleUnitTypeChange(index, value)}
        isSupply={isSupply}
        quantity={Number(item.quantity) || 0}
        disabled={controller.isReadOnly || Boolean(item.supplierQuoteItemId)}
        i18nPrefix="sales:clientQuotes"
      />
    </div>
  </div>
);

const OrderItemDurationField: React.FC<{
  controller: ClientsOrdersController;
  index: number;
  durationUnit: DurationUnit;
  durationValue: number;
}> = ({ controller, index, durationUnit, durationValue }) => (
  <div className="space-y-1 lg:col-span-2 lg:space-y-0">
    <FieldLabel className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground lg:hidden">
      {controller.t('sales:clientQuotes.durationColumn', { defaultValue: 'Duration' })}
    </FieldLabel>
    <div className="flex h-9 items-center justify-end gap-1">
      <ValidatedNumberInput
        step="1"
        min="1"
        placeholder={controller.t('sales:clientQuotes.durationColumn', {
          defaultValue: 'Duration',
        })}
        value={durationValue}
        onValueChange={(value) => controller.handleDurationValueChange(index, value)}
        disabled={controller.isReadOnly || durationUnit === 'na'}
        className={`${compactInputClass} max-w-[5rem]`}
      />
      <span className="shrink-0 text-[9px] font-medium text-muted-foreground">/</span>
      <DurationUnitSelector
        value={durationUnit}
        onChange={(value) => controller.handleDurationUnitChange(index, value)}
        count={durationValue}
        disabled={controller.isReadOnly}
      />
    </div>
  </div>
);

const OrderItemCostField: React.FC<{
  controller: ClientsOrdersController;
  item: ClientsOrderItem;
  index: number;
  unitCost: number;
}> = ({ controller, item, index, unitCost }) => (
  <div className="space-y-1 lg:col-span-1 lg:space-y-0">
    <FieldLabel className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground lg:hidden">
      {controller.t('crm:internalListing.cost')}
    </FieldLabel>
    <div className="flex h-9 items-center justify-end gap-1">
      <ValidatedNumberInput
        value={unitCost}
        formatDecimals={2}
        onValueChange={(value) => {
          if (!controller.isReadOnly) {
            controller.setFormData(
              makeCostUpdater<Partial<ClientsOrder>>(index, value, DEFAULT_UNIT_TYPE),
            );
          }
        }}
        disabled={controller.isReadOnly}
        className={compactInputClass}
      />
      <span className="shrink-0 text-[9px] font-medium text-muted-foreground">
        {controller.currency}
      </span>
      {item.supplierQuoteItemId && (
        <SupplierQuoteCostHint descriptionKey="clientsOrders.supplierQuoteCostTooltip" />
      )}
    </div>
  </div>
);

const OrderItemMolField: React.FC<{
  controller: ClientsOrdersController;
  index: number;
  molPercentage: number;
}> = ({ controller, index, molPercentage }) => (
  <div className="space-y-1 lg:col-span-1 lg:space-y-0">
    <FieldLabel className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground lg:hidden">
      {controller.t('sales:clientQuotes.molLabel', { defaultValue: 'MOL' })}
    </FieldLabel>
    <div className="flex h-9 items-center justify-end gap-1">
      <ValidatedNumberInput
        value={molPercentage}
        formatDecimals={MOL_PERCENTAGE_DECIMALS}
        onValueChange={(value) => {
          if (!controller.isReadOnly) {
            controller.setFormData(
              makeMolUpdater<Partial<ClientsOrder>>(index, value, DEFAULT_UNIT_TYPE),
            );
          }
        }}
        disabled={controller.isReadOnly}
        className={compactInputClass}
      />
      <span className="shrink-0 text-[9px] font-medium text-muted-foreground">%</span>
    </div>
  </div>
);

const OrderItemDiscountField: React.FC<{
  controller: ClientsOrdersController;
  item: ClientsOrderItem;
  index: number;
}> = ({ controller, item, index }) => (
  <div className="space-y-1 lg:col-span-1 lg:space-y-0">
    <FieldLabel className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground lg:hidden">
      {controller.t('common:labels.discount')}
    </FieldLabel>
    <div className="flex h-9 items-center justify-end gap-1">
      <ValidatedNumberInput
        value={item.discount ?? 0}
        min={0}
        max={100}
        step="0.01"
        formatDecimals={2}
        aria-label={controller.t('common:labels.discount')}
        onValueChange={(value) =>
          controller.updateProductRow(index, 'discount', parseNumberInputValue(value) ?? 0)
        }
        disabled={controller.isReadOnly}
        className={compactInputClass}
      />
      <span className="shrink-0 text-[9px] font-medium text-muted-foreground">%</span>
    </div>
  </div>
);

const OrderItemAmountField: React.FC<{
  label: string;
  value: number;
  currency: string;
  className: string;
  valueClassName?: string;
}> = ({ label, value, currency, className, valueClassName = 'text-foreground' }) => {
  const valueLabel = (
    <span className={`text-xs font-bold ${valueClassName}`}>
      {formatDecimal(value)} {currency}
    </span>
  );

  return (
    <div className={`space-y-1 ${className} lg:space-y-0`}>
      <FieldLabel className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground lg:hidden">
        {label}
      </FieldLabel>
      <div className="flex h-9 items-center justify-end whitespace-nowrap px-3 text-sm font-bold text-foreground">
        {valueLabel}
      </div>
    </div>
  );
};

const OrderNotesSummarySection: React.FC<{ controller: ClientsOrdersController }> = ({
  controller,
}) => {
  const { subtotal, discountAmount, total, margin, marginPercentage } = calculatePricingTotals(
    controller.formData.items || [],
    controller.formData.discount || 0,
    DEFAULT_UNIT_TYPE,
    controller.formData.discountType || 'percentage',
  );

  return (
    <div className="flex flex-col gap-4 border-t border-border pt-4 md:flex-row">
      <Field className="md:w-2/3">
        <OrderSectionTitle>{controller.t('accounting:clientsOrders.notes')}</OrderSectionTitle>
        <FieldLabel htmlFor="client-order-notes" className="sr-only">
          {controller.t('accounting:clientsOrders.notes')}
        </FieldLabel>
        <Textarea
          id="client-order-notes"
          rows={4}
          value={controller.formData.notes}
          onChange={(event) =>
            controller.setFormData((prev) => ({ ...prev, notes: event.target.value }))
          }
          placeholder={controller.t('sales:clientQuotes.additionalNotesPlaceholder')}
          disabled={controller.isReadOnly}
          className="min-h-28 resize-none"
        />
      </Field>
      <div className="space-y-2 md:w-1/3">
        <OrderSectionTitle>
          {controller.t('accounting:clientsOrders.summary', { defaultValue: 'Summary' })}
        </OrderSectionTitle>
        <CostSummaryPanel
          currency={controller.currency}
          subtotal={subtotal}
          total={total}
          subtotalLabel={controller.t('sales:clientQuotes.subtotal', {
            defaultValue: 'Subtotal',
          })}
          totalLabel={controller.t('sales:clientQuotes.totalLabel')}
          globalDiscount={{
            label: controller.t('sales:clientQuotes.globalDiscount', {
              defaultValue: 'Global Discount',
            }),
            value: controller.formData.discount || 0,
            type: controller.formData.discountType || 'percentage',
            onChange: (value) => {
              controller.setFormData((prev) => ({
                ...prev,
                discount: parseNumberInputValue(value),
              }));
            },
            onTypeChange: (type) =>
              controller.setFormData((prev) => ({ ...prev, discountType: type })),
            disabled: controller.isReadOnly,
          }}
          discountRow={
            discountAmount > 0
              ? {
                  label: controller.t('sales:clientOffers.discountAmount', {
                    value: formatDiscountValue(
                      controller.formData.discount ?? 0,
                      controller.formData.discountType ?? 'percentage',
                      controller.currency,
                    ),
                  }),
                  amount: discountAmount,
                }
              : undefined
          }
          margin={{
            label: `${controller.t('sales:clientQuotes.marginLabel')} (${formatMolPercentage(marginPercentage)})`,
            amount: margin,
          }}
        />
      </div>
    </div>
  );
};

const ClientsOrdersDeleteDialogs: React.FC<{ controller: ClientsOrdersController }> = ({
  controller,
}) => (
  <>
    <DeleteConfirmModal
      isOpen={controller.isDeleteConfirmOpen}
      onClose={() => controller.setIsDeleteConfirmOpen(false)}
      onConfirm={controller.handleDelete}
      title={controller.t('accounting:clientsOrders.deleteOrderTitle')}
      description={controller.t('accounting:clientsOrders.deleteOrderConfirm', {
        clientName: controller.orderToDelete?.clientName,
      })}
    />
    <DeleteConfirmModal
      isOpen={controller.productRowToDelete !== null}
      onClose={() => controller.setProductRowToDelete(null)}
      onConfirm={() => {
        if (controller.productRowToDelete !== null) {
          controller.removeProductRow(controller.productRowToDelete);
        }
        controller.setProductRowToDelete(null);
      }}
      title={controller.t('accounting:clientsOrders.removeProductTitle')}
      description={controller.t('accounting:clientsOrders.removeProductConfirm')}
      zIndex={70}
    />
  </>
);

export default ClientsOrdersView;
