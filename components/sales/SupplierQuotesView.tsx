import type React from 'react';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  Product,
  Supplier,
  SupplierQuote,
  SupplierQuoteItem,
  SupplierQuoteVersion,
  SupplierUnitType,
} from '../../types';
import {
  addMonthsToDateOnly,
  formatDateOnlyForLocale,
  formatInsertDate,
  formatInsertDateTime,
  getLocalDateString,
  normalizeDateOnlyString,
} from '../../utils/date';
import { convertUnitPrice, parseNumberInputValue } from '../../utils/numbers';
import { getPaymentTermsOptions } from '../../utils/options';
import CostSummaryPanel from '../shared/CostSummaryPanel';
import CustomSelect from '../shared/CustomSelect';
import FieldTooltip from '../shared/FieldTooltip';
import Modal from '../shared/Modal';
import StandardTable, { type Column } from '../shared/StandardTable';
import StatusBadge, { type StatusType } from '../shared/StatusBadge';
import Tooltip from '../shared/Tooltip';
import UnitTypeSelector from '../shared/UnitTypeSelector';
import ValidatedNumberInput from '../shared/ValidatedNumberInput';
import SupplierQuoteVersionsPanel from './SupplierQuoteVersionsPanel';

interface TotalsBreakdown {
  subtotal: number;
  total: number;
}

const calculateTotals = (items: SupplierQuoteItem[]): TotalsBreakdown => {
  let subtotal = 0;
  items.forEach((item) => {
    subtotal += item.quantity * item.unitPrice;
  });
  return { subtotal, total: subtotal };
};

export interface SupplierQuotesViewProps {
  quotes: SupplierQuote[];
  suppliers: Supplier[];
  products: Product[];
  onAddQuote: (quoteData: Partial<SupplierQuote>) => void | Promise<void>;
  onUpdateQuote: (id: string, updates: Partial<SupplierQuote>) => void | Promise<void>;
  onDeleteQuote: (id: string) => void | Promise<void>;
  onCreateOrder?: (quote: SupplierQuote) => void | Promise<void>;
  onQuoteRestored?: (quote: SupplierQuote) => void;
  quoteFilterId?: string | null;
  onViewOrders?: (quoteId: string) => void;
  currency: string;
}

const getDefaultFormData = (): Partial<SupplierQuote> => ({
  supplierId: '',
  supplierName: '',
  id: '',
  items: [],
  paymentTerms: 'immediate',
  status: 'draft',
  expirationDate: addMonthsToDateOnly(getLocalDateString(), 1),
  notes: '',
});

const SupplierQuotesView: React.FC<SupplierQuotesViewProps> = ({
  quotes,
  suppliers,
  products,
  onAddQuote,
  onUpdateQuote,
  onDeleteQuote,
  onCreateOrder,
  onQuoteRestored,
  quoteFilterId,
  onViewOrders,
  currency,
}) => {
  const { t, i18n } = useTranslation(['sales', 'common', 'crm', 'form']);
  const paymentTermsOptions = useMemo(() => getPaymentTermsOptions(t), [t]);
  const statusOptions = useMemo(
    () => [
      { id: 'draft', name: t('sales:supplierQuotes.statusDraft', { defaultValue: 'Draft' }) },
      { id: 'sent', name: t('sales:supplierQuotes.statusSent', { defaultValue: 'Sent' }) },
      {
        id: 'accepted',
        name: t('sales:supplierQuotes.statusAccepted', { defaultValue: 'Accepted' }),
      },
      { id: 'denied', name: t('sales:supplierQuotes.statusDenied', { defaultValue: 'Denied' }) },
    ],
    [t],
  );

  const activeSuppliers = useMemo(
    () => suppliers.filter((supplier) => !supplier.isDisabled),
    [suppliers],
  );

  const tableInitialFilterState = useMemo(() => {
    if (quoteFilterId) {
      return { id: [quoteFilterId] };
    }
    return undefined;
  }, [quoteFilterId]);

  const [editingQuote, setEditingQuote] = useState<SupplierQuote | null>(null);
  const [quoteToDelete, setQuoteToDelete] = useState<SupplierQuote | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formData, setFormData] = useState<Partial<SupplierQuote>>(getDefaultFormData());
  const [previewVersion, setPreviewVersion] = useState<SupplierQuoteVersion | null>(null);

  const baseReadOnly = Boolean(editingQuote?.linkedOrderId);
  const isReadOnly = baseReadOnly || previewVersion !== null;

  const readOnlyReason = t('sales:supplierQuotes.readOnlyLinked', {
    defaultValue: 'This quote is read-only because an order was created from it.',
  });
  const statusEditable = t('sales:fieldInfo.statusEditable', { defaultValue: 'Editable' });
  const statusLabel = t('sales:fieldInfo.statusLabel', { defaultValue: 'Status:' });
  const readOnlyStatus = isReadOnly ? readOnlyReason : statusEditable;

  const hasOrderForQuote = useCallback((quote: SupplierQuote) => Boolean(quote.linkedOrderId), []);

  const isHistoryRow = useCallback(
    (quote: SupplierQuote) => {
      const hasOrder = hasOrderForQuote(quote);
      return quote.status === 'denied' || hasOrder;
    },
    [hasOrderForQuote],
  );

  const totalsBreakdown = calculateTotals(formData.items || []);

  const inputClassName =
    'w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-praetor disabled:opacity-50 disabled:cursor-not-allowed';
  const itemInputClassName =
    'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-praetor disabled:opacity-50 disabled:cursor-not-allowed';

  const closeModal = useCallback(() => {
    setIsModalOpen(false);
    setPreviewVersion(null);
  }, []);

  const openAddModal = useCallback(() => {
    setEditingQuote(null);
    setFormData(getDefaultFormData());
    setErrors({});
    setPreviewVersion(null);
    setIsModalOpen(true);
  }, []);

  const quoteToFormData = useCallback(
    (quote: SupplierQuote): Partial<SupplierQuote> => ({
      ...quote,
      expirationDate: quote.expirationDate ? normalizeDateOnlyString(quote.expirationDate) : '',
    }),
    [],
  );

  const openEditModal = useCallback(
    (quote: SupplierQuote) => {
      setEditingQuote(quote);
      setFormData(quoteToFormData(quote));
      setErrors({});
      setPreviewVersion(null);
      setIsModalOpen(true);
    },
    [quoteToFormData],
  );

  const handleVersionPreview = useCallback(
    (version: SupplierQuoteVersion) => {
      setPreviewVersion(version);
      setFormData({
        ...version.snapshot.quote,
        id: editingQuote?.id ?? version.snapshot.quote.id,
        items: version.snapshot.items,
        expirationDate: version.snapshot.quote.expirationDate
          ? normalizeDateOnlyString(version.snapshot.quote.expirationDate)
          : '',
        status: version.snapshot.quote.status as SupplierQuote['status'],
      });
      setErrors({});
    },
    [editingQuote],
  );

  const handleClearPreview = useCallback(() => {
    if (editingQuote) setFormData(quoteToFormData(editingQuote));
    setPreviewVersion(null);
  }, [editingQuote, quoteToFormData]);

  const handleVersionRestored = useCallback(
    (updated: SupplierQuote) => {
      setEditingQuote(updated);
      setFormData(quoteToFormData(updated));
      setPreviewVersion(null);
      onQuoteRestored?.(updated);
    },
    [onQuoteRestored, quoteToFormData],
  );

  const getStatusLabel = useCallback(
    (status: string) => {
      const option = statusOptions.find((item) => item.id === status);
      return option ? option.name : status;
    },
    [statusOptions],
  );

  const handleSupplierChange = useCallback(
    (supplierId: string) => {
      const supplier = suppliers.find((item) => item.id === supplierId);
      setFormData((prev) => ({
        ...prev,
        supplierId,
        supplierName: supplier?.name || '',
      }));
    },
    [suppliers],
  );

  const updateItem = useCallback(
    (index: number, field: keyof SupplierQuoteItem, value: string | number) => {
      if (isReadOnly) return;
      setFormData((prev) => {
        const items = [...(prev.items || [])];
        items[index] = { ...items[index], [field]: value };
        return { ...prev, items };
      });
    },
    [isReadOnly],
  );

  const addItem = useCallback(() => {
    if (isReadOnly) return;
    setFormData((prev) => ({
      ...prev,
      items: [
        ...(prev.items || []),
        {
          id: `tmp-${Date.now()}`,
          quoteId: editingQuote?.id || '',
          productName: '',
          quantity: 1,
          unitPrice: 0,
          unitType: 'unit' as const,
          note: '',
        },
      ],
    }));
  }, [editingQuote?.id, isReadOnly]);

  const removeItem = useCallback(
    (index: number) => {
      if (isReadOnly) return;
      setFormData((prev) => {
        const items = [...(prev.items || [])];
        items.splice(index, 1);
        return { ...prev, items };
      });
    },
    [isReadOnly],
  );

  const handleUnitTypeChange = (index: number, newType: SupplierUnitType) => {
    if (isReadOnly) return;
    const item = formData.items?.[index];
    if (!item) return;
    const oldType = item.unitType || 'unit';
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

  const columns = useMemo<Column<SupplierQuote>[]>(
    () => [
      {
        header: t('sales:supplierQuotes.quoteCode', { defaultValue: 'Quote Code' }),
        accessorKey: 'id',
        className: 'whitespace-nowrap',
        headerClassName: 'min-w-[8rem]',
        cell: ({ row }) => <span className="font-bold text-slate-700">{row.id}</span>,
      },
      {
        header: t('crm:clients.tableHeaders.insertDate'),
        id: 'createdAt',
        accessorFn: (row) => row.createdAt ?? 0,
        className: 'whitespace-nowrap',
        cell: ({ row }) => {
          if (!row.createdAt) return <span className="text-xs text-slate-400">-</span>;
          return (
            <span className="text-xs text-slate-500 whitespace-nowrap">
              {formatInsertDate(row.createdAt)}
            </span>
          );
        },
        filterFormat: (value) => {
          const timestamp = typeof value === 'number' ? value : Number(value);
          if (!Number.isFinite(timestamp) || timestamp <= 0) return '-';
          return formatInsertDate(timestamp);
        },
      },
      {
        header: t('sales:supplierQuotes.supplier', { defaultValue: 'Supplier' }),
        accessorKey: 'supplierName',
        cell: ({ row }) => {
          const history = isHistoryRow(row);
          return (
            <div className={history ? 'font-bold text-slate-400' : 'font-bold text-slate-800'}>
              {row.supplierName}
            </div>
          );
        },
      },
      {
        header: t('sales:supplierQuotes.total', { defaultValue: 'Total' }),
        id: 'total',
        accessorFn: (row) => calculateTotals(row.items).total,
        className: 'whitespace-nowrap',
        headerClassName: 'min-w-[8rem]',
        disableFiltering: true,
        cell: ({ row }) => {
          const history = isHistoryRow(row);
          const { total } = calculateTotals(row.items);
          return (
            <span
              className={`text-sm font-bold whitespace-nowrap ${history ? 'text-slate-400' : 'text-slate-700'}`}
            >
              {total.toFixed(2)} {currency}
            </span>
          );
        },
      },
      {
        header: t('sales:supplierQuotes.paymentTerms', { defaultValue: 'Payment Terms' }),
        accessorKey: 'paymentTerms',
        className: 'whitespace-nowrap',
        headerClassName: 'min-w-[10rem]',
        cell: ({ row }) => {
          const history = isHistoryRow(row);
          return (
            <span
              className={`text-sm font-semibold ${history ? 'text-slate-400' : 'text-slate-600'}`}
            >
              {row.paymentTerms === 'immediate'
                ? t('sales:clientQuotes.immediatePayment')
                : row.paymentTerms}
            </span>
          );
        },
      },
      {
        header: t('sales:supplierQuotes.expirationDate', { defaultValue: 'Expiration Date' }),
        accessorKey: 'expirationDate',
        className: 'whitespace-nowrap',
        headerClassName: 'min-w-[9rem]',
        filterFormat: (value) => (value ? formatDateOnlyForLocale(String(value)) : '—'),
        cell: ({ row }) => {
          const history = isHistoryRow(row);
          return (
            <div className={`text-sm ${history ? 'text-slate-400' : 'text-slate-600'}`}>
              {row.expirationDate ? formatDateOnlyForLocale(row.expirationDate) : '—'}
            </div>
          );
        },
      },
      {
        header: t('sales:supplierQuotes.status', { defaultValue: 'Status' }),
        accessorKey: 'status',
        className: 'whitespace-nowrap',
        headerClassName: 'min-w-[9rem]',
        filterFormat: (value) => getStatusLabel(String(value)),
        cell: ({ row }) => {
          const history = isHistoryRow(row);
          return (
            <div className={history ? 'opacity-60' : ''}>
              <StatusBadge type={row.status as StatusType} label={getStatusLabel(row.status)} />
            </div>
          );
        },
      },
      {
        header: t('sales:supplierQuotes.actionsColumn', { defaultValue: 'Actions' }),
        id: 'actions',
        align: 'right',
        className: 'whitespace-nowrap',
        headerClassName: 'min-w-[9rem]',
        disableSorting: true,
        disableFiltering: true,
        cell: ({ row }) => {
          const hasOrder = hasOrderForQuote(row);
          const history = isHistoryRow(row);

          const isEditDisabled = hasOrder;
          const editTitle = hasOrder
            ? t('sales:supplierQuotes.orderAlreadyExists', {
                defaultValue: 'An order for this quote already exists.',
              })
            : t('common:buttons.edit', { defaultValue: 'Edit' });

          const isCreateOrderDisabled = history || hasOrder;
          const createOrderTitle = hasOrder
            ? t('sales:supplierQuotes.orderAlreadyExists', {
                defaultValue: 'An order for this quote already exists.',
              })
            : t('sales:supplierQuotes.createOrder', { defaultValue: 'Create order' });

          return (
            <div className="flex justify-end gap-2">
              {row.linkedOrderId && onViewOrders && (
                <Tooltip
                  label={t('sales:supplierQuotes.viewOrder', { defaultValue: 'View order' })}
                >
                  {() => (
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        onViewOrders(row.id);
                      }}
                      className="p-2 rounded-lg transition-all text-slate-400 hover:text-praetor hover:bg-slate-100"
                    >
                      <i className="fa-solid fa-link"></i>
                    </button>
                  )}
                </Tooltip>
              )}
              <Tooltip label={editTitle}>
                {() => (
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      if (isEditDisabled) return;
                      openEditModal(row);
                    }}
                    disabled={isEditDisabled}
                    className={`p-2 rounded-lg transition-all ${isEditDisabled ? 'cursor-not-allowed opacity-50 text-slate-400' : 'text-slate-400 hover:text-praetor hover:bg-slate-100'}`}
                  >
                    <i className="fa-solid fa-pen-to-square"></i>
                  </button>
                )}
              </Tooltip>
              {row.status === 'draft' && !hasOrder && (
                <Tooltip
                  label={t('sales:supplierQuotes.markSent', { defaultValue: 'Mark as sent' })}
                >
                  {() => (
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        onUpdateQuote(row.id, { status: 'sent' });
                      }}
                      className="p-2 rounded-lg transition-all text-slate-400 hover:text-blue-600 hover:bg-blue-50"
                    >
                      <i className="fa-solid fa-paper-plane"></i>
                    </button>
                  )}
                </Tooltip>
              )}
              {row.status === 'sent' && !hasOrder && (
                <>
                  <Tooltip
                    label={t('sales:supplierQuotes.markAccepted', {
                      defaultValue: 'Mark as accepted',
                    })}
                  >
                    {() => (
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          onUpdateQuote(row.id, { status: 'accepted' });
                        }}
                        className="p-2 rounded-lg transition-all text-slate-400 hover:text-emerald-600 hover:bg-emerald-50"
                      >
                        <i className="fa-solid fa-check"></i>
                      </button>
                    )}
                  </Tooltip>
                  <Tooltip
                    label={t('sales:supplierQuotes.markDenied', {
                      defaultValue: 'Mark as denied',
                    })}
                  >
                    {() => (
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          onUpdateQuote(row.id, { status: 'denied' });
                        }}
                        className="p-2 rounded-lg transition-all text-slate-400 hover:text-red-600 hover:bg-red-50"
                      >
                        <i className="fa-solid fa-xmark"></i>
                      </button>
                    )}
                  </Tooltip>
                </>
              )}
              {row.status === 'accepted' && onCreateOrder && (
                <Tooltip label={createOrderTitle}>
                  {() => (
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        if (isCreateOrderDisabled) return;
                        onCreateOrder(row);
                      }}
                      disabled={isCreateOrderDisabled}
                      className={`p-2 rounded-lg transition-all ${isCreateOrderDisabled ? 'cursor-not-allowed opacity-50 text-slate-400' : 'text-slate-400 hover:text-praetor hover:bg-slate-100'}`}
                    >
                      <i className="fa-solid fa-cart-shopping"></i>
                    </button>
                  )}
                </Tooltip>
              )}
              {row.status === 'draft' && !hasOrder && (
                <Tooltip label={t('common:buttons.delete', { defaultValue: 'Delete' })}>
                  {() => (
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        setQuoteToDelete(row);
                        setIsDeleteConfirmOpen(true);
                      }}
                      className="p-2 rounded-lg transition-all text-slate-400 hover:text-red-600 hover:bg-red-50"
                    >
                      <i className="fa-solid fa-trash-can"></i>
                    </button>
                  )}
                </Tooltip>
              )}
              {history && (
                <Tooltip
                  label={
                    hasOrder
                      ? t('sales:supplierQuotes.orderAlreadyExists', {
                          defaultValue: 'An order for this quote already exists.',
                        })
                      : t('sales:supplierQuotes.restoreQuote', { defaultValue: 'Restore quote' })
                  }
                >
                  {() => (
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        if (hasOrder) return;
                        onUpdateQuote(row.id, { status: 'draft' });
                      }}
                      disabled={hasOrder}
                      className={`p-2 rounded-lg transition-all ${hasOrder ? 'cursor-not-allowed opacity-50 text-slate-400' : 'text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50'}`}
                    >
                      <i className="fa-solid fa-rotate-left"></i>
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
      currency,
      getStatusLabel,
      onCreateOrder,
      onUpdateQuote,
      onViewOrders,
      openEditModal,
      t,
      isHistoryRow,
      hasOrderForQuote,
    ],
  );

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    const nextErrors: Record<string, string> = {};
    if (!formData.supplierId) {
      nextErrors.supplierId = t('sales:supplierQuotes.errors.supplierRequired', {
        defaultValue: 'Supplier is required',
      });
    }
    if (!formData.id?.trim()) {
      nextErrors.id = t('sales:supplierQuotes.errors.quoteCodeRequired', {
        defaultValue: 'Quote Code is required',
      });
    }
    if (!formData.items || formData.items.length === 0) {
      nextErrors.items = t('sales:supplierQuotes.errors.itemsRequired', {
        defaultValue: 'At least one item is required',
      });
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    const payload: Partial<SupplierQuote> = {
      ...formData,
      items: (formData.items || []).map((item) => ({
        ...item,
        unitPrice: Number(item.unitPrice ?? 0),
      })),
    };

    if (editingQuote) {
      await onUpdateQuote(editingQuote.id, payload);
    } else {
      await onAddQuote(payload);
    }

    closeModal();
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <Modal isOpen={isModalOpen} onClose={closeModal}>
        <div className="flex items-start gap-4 max-w-full">
          <div className="flex max-h-[90vh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl animate-in zoom-in duration-200">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <h3 className="text-xl font-black text-slate-800 flex items-center gap-3">
                <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center text-praetor">
                  <i
                    className={`fa-solid ${
                      isReadOnly ? 'fa-eye' : editingQuote ? 'fa-pen-to-square' : 'fa-plus'
                    }`}
                  ></i>
                </div>
                {isReadOnly
                  ? t('sales:supplierQuotes.viewQuote', { defaultValue: 'View quote' })
                  : editingQuote
                    ? t('sales:supplierQuotes.editQuote', { defaultValue: 'Edit quote' })
                    : t('sales:supplierQuotes.newQuote', { defaultValue: 'New quote' })}
              </h3>
              <button
                onClick={closeModal}
                className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-slate-100 text-slate-400 transition-colors"
              >
                <i className="fa-solid fa-xmark text-lg"></i>
              </button>
            </div>

            <form onSubmit={handleSubmit} className="flex-1 space-y-4 overflow-y-auto p-8">
              {previewVersion && (
                <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl border border-amber-300 bg-amber-50">
                  <span className="text-amber-800 text-xs font-bold flex items-center gap-2">
                    <i className="fa-solid fa-clock-rotate-left"></i>
                    {t('sales:supplierQuotes.versionHistory.previewBanner', {
                      date: formatInsertDateTime(previewVersion.createdAt, i18n.language),
                      defaultValue: 'Previewing version from {{date}}',
                    })}
                  </span>
                  <button
                    type="button"
                    onClick={handleClearPreview}
                    className="text-xs font-bold text-amber-800 hover:underline whitespace-nowrap"
                  >
                    {t('sales:supplierQuotes.versionHistory.backToCurrent', {
                      defaultValue: 'Back to current',
                    })}
                  </button>
                </div>
              )}
              {baseReadOnly && (
                <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-amber-200 bg-amber-50">
                  <span className="text-amber-700 text-xs font-bold">
                    {t('sales:supplierQuotes.readOnlyLinked', {
                      defaultValue: 'This quote is read-only because an order was created from it.',
                    })}
                  </span>
                </div>
              )}
              {editingQuote?.linkedOrderId && (
                <div className="bg-slate-50 border border-slate-100 rounded-xl p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center text-praetor">
                      <i className="fa-solid fa-link"></i>
                    </div>
                    <div>
                      <div className="text-sm font-bold text-slate-900">
                        {t('sales:supplierQuotes.linkedOrderTitle', {
                          defaultValue: 'Linked Order',
                        })}
                      </div>
                      <div className="text-xs text-praetor">
                        {t('sales:supplierQuotes.linkedOrderInfo', {
                          number: editingQuote.linkedOrderId,
                          defaultValue: 'Order #{{number}}',
                        })}
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        {t('sales:supplierQuotes.orderDetailsReadOnly', {
                          defaultValue: '(Quote details are read-only)',
                        })}
                      </div>
                    </div>
                  </div>
                  {onViewOrders && (
                    <button
                      type="button"
                      onClick={() => onViewOrders(editingQuote.id)}
                      className="text-xs font-bold text-praetor hover:text-slate-800 hover:underline"
                    >
                      {t('sales:supplierQuotes.viewOrder', { defaultValue: 'View Order' })}
                    </button>
                  )}
                </div>
              )}

              <div className="space-y-2">
                <h4 className="text-xs font-black text-praetor uppercase tracking-widest flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-praetor"></span>
                  {t('sales:supplierQuotes.supplierInformation', {
                    defaultValue: 'Supplier Information',
                  })}
                  <FieldTooltip
                    description={t('sales:fieldInfo.supplierInformation', {
                      defaultValue: 'Supplier and document details',
                    })}
                    status={readOnlyStatus}
                    statusLabel={statusLabel}
                  />
                </h4>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 ml-1">
                      {t('sales:supplierQuotes.supplier', { defaultValue: 'Supplier' })}
                    </label>
                    <CustomSelect
                      options={activeSuppliers.map((supplier) => ({
                        id: supplier.id,
                        name: supplier.name,
                      }))}
                      value={formData.supplierId || ''}
                      onChange={(value) => handleSupplierChange(value as string)}
                      placeholder={t('sales:supplierQuotes.selectSupplier', {
                        defaultValue: 'Select a supplier',
                      })}
                      searchable={true}
                      disabled={isReadOnly}
                      className={errors.supplierId ? 'border-red-300' : ''}
                    />
                    {errors.supplierId && (
                      <p className="text-red-500 text-[10px] font-bold ml-1">{errors.supplierId}</p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 ml-1">
                      {t('sales:supplierQuotes.quoteCode', { defaultValue: 'Quote Code' })}
                    </label>
                    <input
                      type="text"
                      value={formData.id || ''}
                      disabled={isReadOnly}
                      onChange={(event) => {
                        setFormData((prev) => ({
                          ...prev,
                          id: event.target.value,
                        }));
                        if (errors.id) {
                          setErrors((prev) => {
                            const next = { ...prev };
                            delete next.id;
                            return next;
                          });
                        }
                      }}
                      className={`${inputClassName} ${errors.id ? 'border-red-300' : ''}`}
                    />
                    {errors.id && (
                      <p className="text-red-500 text-[10px] font-bold ml-1">{errors.id}</p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 ml-1">
                      {t('sales:supplierQuotes.paymentTerms', { defaultValue: 'Payment Terms' })}
                    </label>
                    <CustomSelect
                      options={paymentTermsOptions}
                      value={formData.paymentTerms || 'immediate'}
                      onChange={(value) =>
                        setFormData((prev) => ({
                          ...prev,
                          paymentTerms: value as SupplierQuote['paymentTerms'],
                        }))
                      }
                      searchable={false}
                      disabled={isReadOnly}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 ml-1">
                      {t('sales:supplierQuotes.expirationDate', {
                        defaultValue: 'Expiration Date',
                      })}
                    </label>
                    <input
                      type="date"
                      value={formData.expirationDate || ''}
                      disabled={isReadOnly}
                      onChange={(event) =>
                        setFormData((prev) => ({ ...prev, expirationDate: event.target.value }))
                      }
                      className={inputClassName}
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <h4 className="text-xs font-black text-praetor uppercase tracking-widest flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-praetor"></span>
                    {t('sales:supplierQuotes.items', { defaultValue: 'Items' })}
                    <FieldTooltip
                      description={t('sales:fieldInfo.supplierItems', {
                        defaultValue: 'Line items for this quote',
                      })}
                      status={readOnlyStatus}
                      statusLabel={statusLabel}
                    />
                  </h4>
                  {!isReadOnly && (
                    <button
                      type="button"
                      onClick={addItem}
                      className="text-xs font-bold text-praetor hover:text-slate-700 flex items-center gap-1"
                    >
                      <i className="fa-solid fa-plus"></i>
                      {t('sales:supplierQuotes.addItem', { defaultValue: 'Add item' })}
                    </button>
                  )}
                </div>
                {errors.items && (
                  <p className="text-red-500 text-[10px] font-bold ml-1 -mt-2">{errors.items}</p>
                )}

                {formData.items && formData.items.length > 0 && (
                  <div className="hidden lg:flex gap-2 px-3 mb-1 items-center">
                    <div className="flex-1 min-w-0 grid grid-cols-12 gap-3">
                      <div className="col-span-7 text-[10px] font-black text-slate-400 uppercase tracking-wider ml-1">
                        {t('sales:supplierQuotes.product', { defaultValue: 'Product' })}
                      </div>
                      <div className="col-span-2 text-[10px] font-black text-slate-400 uppercase tracking-wider text-center">
                        {t('sales:supplierQuotes.qty', { defaultValue: 'Qty' })}
                      </div>
                      <div className="col-span-3 text-[10px] font-black text-slate-400 uppercase tracking-wider ml-1">
                        {t('sales:supplierQuotes.unitPrice', { defaultValue: 'Unit Price' })}
                      </div>
                    </div>
                    <div className="w-24 shrink-0 text-[10px] font-black text-slate-400 uppercase tracking-wider text-right">
                      {t('sales:supplierQuotes.total', { defaultValue: 'Total' })}
                    </div>
                    <div className="w-10 shrink-0" />
                  </div>
                )}

                {formData.items && formData.items.length > 0 ? (
                  <div className="space-y-3">
                    {formData.items.map((item, index) => {
                      const lineTotal = item.quantity * item.unitPrice;
                      const itemProduct = item.productId
                        ? products.find((p) => p.id === item.productId)
                        : undefined;
                      const isSupply = itemProduct?.type === 'supply';
                      return (
                        <div
                          key={item.id}
                          className="rounded-xl border border-slate-100 bg-slate-50 p-3 space-y-3"
                        >
                          <div className="lg:hidden flex items-start gap-3">
                            <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-3">
                              <div>
                                <div className="mb-1 text-[10px] font-black text-slate-400 uppercase tracking-wider">
                                  {t('sales:supplierQuotes.product', { defaultValue: 'Product' })}
                                </div>
                                <input
                                  type="text"
                                  value={item.productName || ''}
                                  disabled={isReadOnly}
                                  onChange={(event) =>
                                    updateItem(index, 'productName', event.target.value)
                                  }
                                  placeholder={t('sales:supplierQuotes.product', {
                                    defaultValue: 'Product',
                                  })}
                                  className={itemInputClassName}
                                />
                              </div>
                              <div>
                                <div className="mb-1 text-[10px] font-black text-slate-400 uppercase tracking-wider">
                                  {t('sales:supplierQuotes.qty', { defaultValue: 'Qty' })}
                                </div>
                                <div className="flex items-center gap-1">
                                  <ValidatedNumberInput
                                    value={item.quantity}
                                    onValueChange={(value) =>
                                      updateItem(index, 'quantity', parseNumberInputValue(value))
                                    }
                                    disabled={isReadOnly}
                                    className={`${itemInputClassName} text-center flex-1`}
                                  />
                                  <span className="text-xs font-semibold text-slate-400 shrink-0">
                                    /
                                  </span>
                                  <UnitTypeSelector
                                    value={item.unitType || 'unit'}
                                    onChange={(val) => handleUnitTypeChange(index, val)}
                                    isSupply={isSupply}
                                    quantity={Number(item.quantity) || 0}
                                    disabled={isReadOnly}
                                    i18nPrefix="sales:supplierQuotes"
                                  />
                                </div>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => removeItem(index)}
                              disabled={isReadOnly}
                              className="mt-5 w-10 h-10 flex items-center justify-center text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              <i className="fa-solid fa-trash-can"></i>
                            </button>
                          </div>
                          <div className="grid grid-cols-2 gap-3 lg:hidden">
                            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 space-y-1">
                              <div className="text-[10px] font-black text-slate-400 uppercase tracking-wider">
                                {t('sales:supplierQuotes.unitPrice', {
                                  defaultValue: 'Unit Price',
                                })}
                              </div>
                              <div className="flex items-center gap-1">
                                <ValidatedNumberInput
                                  value={item.unitPrice}
                                  formatDecimals={2}
                                  onValueChange={(value) =>
                                    updateItem(index, 'unitPrice', parseNumberInputValue(value))
                                  }
                                  disabled={isReadOnly}
                                  className="w-full text-sm px-2 py-2 bg-white border border-slate-200 rounded-lg focus:ring-1 focus:ring-praetor outline-none text-center disabled:opacity-50 disabled:cursor-not-allowed"
                                />
                                <span className="text-[9px] font-semibold text-slate-400 shrink-0">
                                  {currency}
                                </span>
                              </div>
                            </div>
                            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 space-y-1">
                              <div className="text-[10px] font-black text-slate-400 uppercase tracking-wider">
                                {t('sales:supplierQuotes.total', { defaultValue: 'Total' })}
                              </div>
                              <div className="text-xs font-bold text-slate-700 whitespace-nowrap">
                                {lineTotal.toFixed(2)} {currency}
                              </div>
                            </div>
                          </div>
                          <div className="hidden lg:flex gap-2 items-center">
                            <div className="flex-1 min-w-0 grid grid-cols-12 gap-3 items-center">
                              <div className="col-span-7">
                                <input
                                  type="text"
                                  value={item.productName || ''}
                                  disabled={isReadOnly}
                                  onChange={(event) =>
                                    updateItem(index, 'productName', event.target.value)
                                  }
                                  placeholder={t('sales:supplierQuotes.product', {
                                    defaultValue: 'Product',
                                  })}
                                  className={itemInputClassName}
                                />
                              </div>
                              <div className="col-span-2 flex items-center gap-1">
                                <ValidatedNumberInput
                                  value={item.quantity}
                                  onValueChange={(value) =>
                                    updateItem(index, 'quantity', parseNumberInputValue(value))
                                  }
                                  disabled={isReadOnly}
                                  className={`${itemInputClassName} text-center`}
                                />
                                <span className="text-xs font-semibold text-slate-400 shrink-0">
                                  /
                                </span>
                                <UnitTypeSelector
                                  value={item.unitType || 'unit'}
                                  onChange={(val) => handleUnitTypeChange(index, val)}
                                  isSupply={isSupply}
                                  quantity={Number(item.quantity) || 0}
                                  disabled={isReadOnly}
                                  i18nPrefix="sales:supplierQuotes"
                                />
                              </div>
                              <div className="col-span-3 flex items-center gap-1.5">
                                <ValidatedNumberInput
                                  value={item.unitPrice}
                                  formatDecimals={2}
                                  onValueChange={(value) =>
                                    updateItem(index, 'unitPrice', parseNumberInputValue(value))
                                  }
                                  disabled={isReadOnly}
                                  className={`${itemInputClassName} flex-1`}
                                />
                                <span className="text-xs font-semibold text-slate-400 shrink-0 whitespace-nowrap">
                                  {currency}
                                </span>
                              </div>
                            </div>
                            <div className="w-24 shrink-0 flex items-center justify-end">
                              <span className="text-sm font-bold text-slate-800 whitespace-nowrap">
                                {lineTotal.toFixed(2)} {currency}
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() => removeItem(index)}
                              disabled={isReadOnly}
                              className="w-10 h-10 flex items-center justify-center text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              <i className="fa-solid fa-trash-can"></i>
                            </button>
                          </div>
                          <div>
                            <input
                              type="text"
                              value={item.note || ''}
                              disabled={isReadOnly}
                              onChange={(event) => updateItem(index, 'note', event.target.value)}
                              placeholder={t('form:placeholderNotes', {
                                defaultValue: 'Notes',
                              })}
                              className={itemInputClassName}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-center py-8 text-slate-400 text-sm">
                    {t('sales:supplierQuotes.noItemsAdded', {
                      defaultValue: 'No items added yet',
                    })}
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-4 border-t border-slate-100 pt-4 md:flex-row">
                <div className="w-full space-y-4 md:w-2/3">
                  <h4 className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-praetor">
                    <span className="h-1.5 w-1.5 rounded-full bg-praetor"></span>
                    {t('sales:supplierQuotes.notes', { defaultValue: 'Notes' })}
                    <FieldTooltip
                      description={t('sales:fieldInfo.notes', {
                        defaultValue: 'Additional notes for the entire document',
                      })}
                      status={readOnlyStatus}
                      statusLabel={statusLabel}
                    />
                  </h4>
                  <textarea
                    rows={4}
                    value={formData.notes || ''}
                    disabled={isReadOnly}
                    placeholder={t('form:placeholderNotes', {
                      defaultValue: 'Optional notes...',
                    })}
                    onChange={(event) =>
                      setFormData((prev) => ({ ...prev, notes: event.target.value }))
                    }
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm outline-none resize-none disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                </div>

                <div className="w-full md:w-1/3">
                  <CostSummaryPanel
                    currency={currency}
                    subtotal={totalsBreakdown.subtotal}
                    total={totalsBreakdown.total}
                    subtotalLabel={t('sales:supplierQuotes.subtotal', { defaultValue: 'Subtotal' })}
                    totalLabel={t('sales:supplierQuotes.total', { defaultValue: 'Total' })}
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={closeModal}
                  className="rounded-xl px-6 py-3 font-bold text-slate-500 hover:bg-slate-50"
                >
                  {t('common:buttons.cancel', { defaultValue: 'Cancel' })}
                </button>
                {!isReadOnly && (
                  <button
                    type="submit"
                    className="rounded-xl bg-praetor px-8 py-3 font-bold text-white shadow-lg shadow-slate-200 hover:bg-slate-700"
                  >
                    {editingQuote
                      ? t('common:buttons.update', { defaultValue: 'Update' })
                      : t('common:buttons.save', { defaultValue: 'Save' })}
                  </button>
                )}
              </div>
            </form>
          </div>
          {editingQuote?.id && (
            <SupplierQuoteVersionsPanel
              quoteId={editingQuote.id}
              selectedVersionId={previewVersion?.id ?? null}
              onPreview={handleVersionPreview}
              onClearPreview={handleClearPreview}
              onRestored={handleVersionRestored}
              disabled={baseReadOnly}
            />
          )}
        </div>
      </Modal>

      <Modal isOpen={isDeleteConfirmOpen} onClose={() => setIsDeleteConfirmOpen(false)}>
        <div className="w-full max-w-sm space-y-4 overflow-hidden rounded-2xl bg-white p-6 text-center shadow-2xl">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600">
            <i className="fa-solid fa-triangle-exclamation text-xl"></i>
          </div>
          <h3 className="text-lg font-black text-slate-800">
            {t('sales:supplierQuotes.deleteTitle', { defaultValue: 'Delete supplier quote?' })}
          </h3>
          <p className="text-sm text-slate-500">{quoteToDelete?.id}</p>
          <div className="flex gap-3 pt-2">
            <button
              onClick={() => setIsDeleteConfirmOpen(false)}
              className="flex-1 rounded-xl py-3 font-bold text-slate-500 hover:bg-slate-50"
            >
              {t('common:buttons.cancel', { defaultValue: 'Cancel' })}
            </button>
            <button
              onClick={async () => {
                if (!quoteToDelete) return;
                await onDeleteQuote(quoteToDelete.id);
                setIsDeleteConfirmOpen(false);
                setQuoteToDelete(null);
              }}
              className="flex-1 rounded-xl bg-red-600 py-3 font-bold text-white hover:bg-red-700"
            >
              {t('common:buttons.delete', { defaultValue: 'Delete' })}
            </button>
          </div>
        </div>
      </Modal>

      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h2 className="text-2xl font-black text-slate-800">
              {t('sales:supplierQuotes.title', { defaultValue: 'Supplier Quotes' })}
            </h2>
            <p className="text-slate-500 text-sm">
              {t('sales:supplierQuotes.subtitle', {
                defaultValue: 'Quotes that can be converted into supplier orders.',
              })}
            </p>
          </div>
          <button
            onClick={openAddModal}
            className="bg-praetor text-white px-5 py-2.5 rounded-xl text-sm font-black shadow-xl shadow-slate-200 transition-all hover:bg-slate-700 active:scale-95 flex items-center gap-2"
          >
            <i className="fa-solid fa-plus"></i>
            {t('sales:supplierQuotes.addQuote', { defaultValue: 'Add quote' })}
          </button>
        </div>
      </div>

      <StandardTable<SupplierQuote>
        title={t('sales:supplierQuotes.activeQuotes', { defaultValue: 'Active Quotes' })}
        data={quotes}
        columns={columns}
        defaultRowsPerPage={5}
        onRowClick={(row) => {
          const canOpenModal =
            !isHistoryRow(row) || row.status === 'accepted' || row.status === 'denied';
          if (canOpenModal) {
            openEditModal(row);
          }
        }}
        rowClassName={(row) => {
          const history = isHistoryRow(row);
          const canOpenModal = !history || row.status === 'accepted' || row.status === 'denied';
          const cursorClass = canOpenModal ? 'cursor-pointer' : 'cursor-not-allowed';
          return history
            ? `bg-slate-50 text-slate-400 hover:bg-slate-100 ${cursorClass}`
            : `hover:bg-slate-50/50 ${cursorClass}`;
        }}
        initialFilterState={tableInitialFilterState}
      />
    </div>
  );
};

export default SupplierQuotesView;
