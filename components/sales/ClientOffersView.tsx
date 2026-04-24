import type React from 'react';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  Client,
  ClientOffer,
  ClientOfferItem,
  Product,
  SpecialBid,
  SupplierQuote,
  SupplierUnitType,
} from '../../types';
import {
  addMonthsToDateOnly,
  getLocalDateString,
  isDateOnlyBeforeToday,
  isDateOnlyWithinInclusiveRange,
  normalizeDateOnlyString,
} from '../../utils/date';
import {
  calcProductSalePrice,
  calculatePricingTotals,
  convertUnitPrice,
  getItemPricingContext,
  parseNumberInputValue,
  roundToTwoDecimals,
} from '../../utils/numbers';
import { getPaymentTermsOptions } from '../../utils/options';
import { makeCostUpdater, makeMolUpdater } from '../../utils/pricingHandlers';
import CostSummaryPanel from '../shared/CostSummaryPanel';
import CustomSelect from '../shared/CustomSelect';
import Modal from '../shared/Modal';
import StandardTable, { type Column } from '../shared/StandardTable';
import StatusBadge, { type StatusType } from '../shared/StatusBadge';
import Tooltip from '../shared/Tooltip';
import UnitTypeSelector from '../shared/UnitTypeSelector';
import ValidatedNumberInput from '../shared/ValidatedNumberInput';

export interface ClientOffersViewProps {
  offers: ClientOffer[];
  clients: Client[];
  products: Product[];
  specialBids: SpecialBid[];
  supplierQuotes: SupplierQuote[];
  offerIdsWithOrders: ReadonlySet<string>;
  onAddOffer?: (offerData: Partial<ClientOffer>) => void | Promise<void>;
  onUpdateOffer: (id: string, updates: Partial<ClientOffer>) => void | Promise<void>;
  onDeleteOffer: (id: string) => void | Promise<void>;
  onCreateClientsOrder?: (offer: ClientOffer) => void | Promise<void>;
  onViewQuote?: (quoteId: string) => void;
  currency: string;
  quoteFilterId?: string | null;
  offerFilterId?: string | null;
}

const getDefaultFormData = (): Partial<ClientOffer> => ({
  id: '',
  linkedQuoteId: '',
  clientId: '',
  clientName: '',
  items: [],
  paymentTerms: 'immediate',
  discount: 0,
  status: 'draft',
  expirationDate: addMonthsToDateOnly(getLocalDateString(), 1),
  notes: '',
});

const ClientOffersView: React.FC<ClientOffersViewProps> = ({
  offers,
  clients,
  products,
  specialBids,
  supplierQuotes,
  offerIdsWithOrders,
  onAddOffer,
  onUpdateOffer,
  onDeleteOffer,
  onCreateClientsOrder,
  onViewQuote,
  currency,
  quoteFilterId,
  offerFilterId,
}) => {
  const { t } = useTranslation(['sales', 'crm', 'common', 'form']);
  const paymentTermsOptions = useMemo(() => getPaymentTermsOptions(t), [t]);
  const STATUS_OPTIONS = useMemo(
    () => [
      { id: 'draft', name: t('sales:clientOffers.statusDraft', { defaultValue: 'Draft' }) },
      { id: 'sent', name: t('sales:clientOffers.statusSent', { defaultValue: 'Sent' }) },
      {
        id: 'accepted',
        name: t('sales:clientOffers.statusAccepted', { defaultValue: 'Accepted' }),
      },
      { id: 'denied', name: t('sales:clientOffers.statusDenied', { defaultValue: 'Denied' }) },
    ],
    [t],
  );

  const activeClients = useMemo(() => clients.filter((client) => !client.isDisabled), [clients]);
  const clientOptions = useMemo(
    () => activeClients.map((client) => ({ id: client.id, name: client.name })),
    [activeClients],
  );
  const activeProducts = useMemo(
    () => products.filter((product) => !product.isDisabled),
    [products],
  );
  const productOptions = useMemo(
    () => activeProducts.map((product) => ({ id: product.id, name: product.name })),
    [activeProducts],
  );
  const today = getLocalDateString();
  const activeSpecialBids = useMemo(() => {
    return specialBids.filter((bid) => {
      return isDateOnlyWithinInclusiveRange(today, bid.startDate, bid.endDate);
    });
  }, [specialBids, today]);

  const acceptedSupplierQuotes = useMemo(
    () =>
      supplierQuotes.filter(
        (q) => q.status === 'accepted' && !isDateOnlyBeforeToday(q.expirationDate, today),
      ),
    [supplierQuotes, today],
  );

  const supplierQuoteItemOptions = useMemo(() => {
    const options: Array<{ id: string; name: string }> = [];
    for (const quote of acceptedSupplierQuotes) {
      for (const item of quote.items) {
        options.push({
          id: item.id,
          name: `${quote.supplierName} · ${item.productName} (${item.unitPrice.toFixed(2)}${item.discount ? ` -${item.discount}%` : ''})`,
        });
      }
    }
    return options;
  }, [acceptedSupplierQuotes]);

  const supplierQuoteSelectOptions = useMemo(
    () => [
      { id: 'none' as const, name: t('sales:clientQuotes.noSupplierQuote') },
      ...supplierQuoteItemOptions.map((o) => ({ id: o.id, name: o.name })),
    ],
    [supplierQuoteItemOptions, t],
  );

  const getSupplierQuoteItemDisplayValue = (itemId?: string | null) => {
    if (!itemId) return t('sales:clientQuotes.noSupplierQuote');
    const option = supplierQuoteItemOptions.find((o) => o.id === itemId);
    return option?.name ?? t('sales:clientQuotes.noSupplierQuote');
  };

  const activeProductIds = useMemo(
    () => new Set(activeProducts.map((p) => p.id)),
    [activeProducts],
  );

  const isLinkedProductMissing = (item: ClientOfferItem) =>
    Boolean(item.supplierQuoteItemId && (!item.productId || !activeProductIds.has(item.productId)));

  const renderProductSelectOrFallback = (
    item: ClientOfferItem,
    index: number,
    selectProps: { className?: string; buttonClassName?: string },
  ) => {
    if (isLinkedProductMissing(item)) {
      return (
        <input
          type="text"
          readOnly
          value={item.productName || ''}
          className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-600"
        />
      );
    }
    return (
      <CustomSelect
        options={productOptions}
        value={item.productId}
        onChange={(val) => updateItem(index, 'productId', val as string)}
        placeholder={t('sales:clientOffers.selectProduct', {
          defaultValue: 'Select product',
        })}
        searchable={true}
        disabled={isReadOnly || Boolean(item.supplierQuoteItemId)}
        className={selectProps.className}
        buttonClassName={selectProps.buttonClassName}
      />
    );
  };

  const handleUnitTypeChange = (index: number, newType: SupplierUnitType) => {
    if (isReadOnly) return;
    setFormData((prev) => {
      const items = [...(prev.items || [])];
      const item = items[index];
      if (!item) return prev;
      const oldType = item.unitType || 'hours';
      if (oldType === newType) return prev;
      const adjustedPrice = convertUnitPrice(item.unitPrice, oldType, newType);
      items[index] = {
        ...items[index],
        unitType: newType,
        unitPrice: roundToTwoDecimals(adjustedPrice),
      };
      return { ...prev, items };
    });
  };

  const [editingOffer, setEditingOffer] = useState<ClientOffer | null>(null);
  const [offerToDelete, setOfferToDelete] = useState<ClientOffer | null>(null);
  const [searchTerm, _setSearchTerm] = useState('');
  const [filterStatus, _setFilterStatus] = useState('all');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formData, setFormData] = useState<Partial<ClientOffer>>(getDefaultFormData());

  const isReadOnly = Boolean(editingOffer && editingOffer.status !== 'draft');
  const isClientLocked = Boolean(editingOffer?.linkedQuoteId);

  const filteredOffers = useMemo(() => {
    return offers.filter((offer) => {
      const matchesSearch =
        searchTerm.trim() === '' ||
        offer.clientName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        offer.id.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesStatus = filterStatus === 'all' || offer.status === filterStatus;
      return matchesSearch && matchesStatus;
    });
  }, [offers, searchTerm, filterStatus]);

  const tableInitialFilterState = useMemo(() => {
    const filters: Record<string, string[]> = {};
    if (offerFilterId) {
      filters.id = [offerFilterId];
    }
    if (quoteFilterId) {
      filters.linkedQuoteId = [quoteFilterId];
    }
    return Object.keys(filters).length > 0 ? filters : undefined;
  }, [offerFilterId, quoteFilterId]);

  const openEditModal = useCallback((offer: ClientOffer) => {
    setEditingOffer(offer);
    setFormData({
      ...offer,
      expirationDate: offer.expirationDate ? normalizeDateOnlyString(offer.expirationDate) : '',
    });
    setErrors({});
    setIsModalOpen(true);
  }, []);

  const getStatusLabel = useCallback(
    (status: string) => {
      const option = STATUS_OPTIONS.find((o) => o.id === status);
      return option ? option.name : status;
    },
    [STATUS_OPTIONS],
  );

  const columns = useMemo<Column<ClientOffer>[]>(
    () => [
      {
        header: t('sales:clientOffers.offerCodeColumn', { defaultValue: 'Offer Code' }),
        accessorKey: 'id',
        className: 'whitespace-nowrap',
        headerClassName: 'min-w-[8rem]',
        cell: ({ row }) => <span className="font-bold text-slate-700">{row.id}</span>,
      },
      {
        header: t('sales:clientOffers.clientColumn', { defaultValue: 'Client' }),
        accessorKey: 'clientName',
        cell: ({ row }) => {
          return <div className="font-bold text-slate-800">{row.clientName}</div>;
        },
      },
      {
        header: t('sales:clientOffers.totalColumn', { defaultValue: 'Total' }),
        id: 'total',
        accessorFn: (row) => calculatePricingTotals(row.items, row.discount).total,
        className: 'whitespace-nowrap',
        headerClassName: 'min-w-[8rem]',
        disableFiltering: true,
        cell: ({ row }) => {
          const { total } = calculatePricingTotals(row.items, row.discount);
          return (
            <span className="text-sm font-bold text-slate-700">
              {total.toFixed(2)} {currency}
            </span>
          );
        },
      },
      {
        header: t('sales:clientOffers.statusColumn', { defaultValue: 'Status' }),
        accessorKey: 'status',
        className: 'whitespace-nowrap',
        headerClassName: 'min-w-[9rem]',
        cell: ({ row }) => {
          return <StatusBadge type={row.status as StatusType} label={getStatusLabel(row.status)} />;
        },
      },
      {
        header: 'linkedQuoteId',
        accessorKey: 'linkedQuoteId',
        hidden: true,
      },
      {
        header: t('sales:clientOffers.actionsColumn', { defaultValue: 'Actions' }),
        id: 'actions',
        align: 'right',
        className: 'whitespace-nowrap',
        headerClassName: 'min-w-[9rem]',
        disableSorting: true,
        disableFiltering: true,
        cell: ({ row }) => {
          const hasOrder = offerIdsWithOrders.has(row.id);

          return (
            <div className="flex justify-end gap-2">
              {row.linkedQuoteId && onViewQuote && (
                <Tooltip label={t('sales:clientOffers.viewQuote', { defaultValue: 'View quote' })}>
                  {() => (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onViewQuote(row.linkedQuoteId);
                      }}
                      className="p-2 rounded-lg transition-all text-slate-400 hover:text-praetor hover:bg-slate-100"
                    >
                      <i className="fa-solid fa-link"></i>
                    </button>
                  )}
                </Tooltip>
              )}
              <Tooltip label={t('common:buttons.edit')}>
                {() => (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      openEditModal(row);
                    }}
                    className="p-2 rounded-lg transition-all text-slate-400 hover:text-praetor hover:bg-slate-100"
                  >
                    <i className="fa-solid fa-pen-to-square"></i>
                  </button>
                )}
              </Tooltip>
              {row.status === 'draft' && (
                <Tooltip label={t('sales:clientOffers.markSent', { defaultValue: 'Mark as sent' })}>
                  {() => (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onUpdateOffer(row.id, { status: 'sent' });
                      }}
                      className="p-2 rounded-lg transition-all text-slate-400 hover:text-blue-600 hover:bg-blue-50"
                    >
                      <i className="fa-solid fa-paper-plane"></i>
                    </button>
                  )}
                </Tooltip>
              )}
              {row.status === 'sent' && (
                <>
                  <Tooltip
                    label={t('sales:clientOffers.markAccepted', {
                      defaultValue: 'Mark as accepted',
                    })}
                  >
                    {() => (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onUpdateOffer(row.id, { status: 'accepted' });
                        }}
                        className="p-2 rounded-lg transition-all text-slate-400 hover:text-emerald-600 hover:bg-emerald-50"
                      >
                        <i className="fa-solid fa-check"></i>
                      </button>
                    )}
                  </Tooltip>
                  <Tooltip
                    label={t('sales:clientOffers.markDenied', { defaultValue: 'Mark as denied' })}
                  >
                    {() => (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onUpdateOffer(row.id, { status: 'denied' });
                        }}
                        className="p-2 rounded-lg transition-all text-slate-400 hover:text-red-600 hover:bg-red-50"
                      >
                        <i className="fa-solid fa-xmark"></i>
                      </button>
                    )}
                  </Tooltip>
                </>
              )}
              {row.status === 'accepted' && !hasOrder && onCreateClientsOrder && (
                <Tooltip
                  label={t('sales:clientOffers.createOrder', { defaultValue: 'Create sale order' })}
                >
                  {() => (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onCreateClientsOrder(row);
                      }}
                      className="p-2 rounded-lg transition-all text-slate-400 hover:text-praetor hover:bg-slate-100"
                    >
                      <i className="fa-solid fa-cart-plus"></i>
                    </button>
                  )}
                </Tooltip>
              )}
              {row.status === 'draft' && (
                <Tooltip label={t('common:buttons.delete')}>
                  {() => (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setOfferToDelete(row);
                        setIsDeleteConfirmOpen(true);
                      }}
                      className="p-2 text-slate-400 rounded-lg transition-all hover:text-red-600 hover:bg-red-50"
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
      t,
      currency,
      getStatusLabel,
      onViewQuote,
      onUpdateOffer,
      onCreateClientsOrder,
      offerIdsWithOrders,
      openEditModal,
    ],
  );

  const openAddModal = () => {
    setEditingOffer(null);
    setFormData(getDefaultFormData());
    setErrors({});
    setIsModalOpen(true);
  };

  const handleClientChange = (clientId: string) => {
    const client = clients.find((item) => item.id === clientId);
    setFormData((prev) => ({
      ...prev,
      clientId,
      clientName: client?.name || '',
    }));
  };

  const addItem = () => {
    if (isReadOnly) return;
    const nextItem: ClientOfferItem = {
      id: `tmp-${Date.now()}`,
      offerId: editingOffer?.id || '',
      productId: '',
      productName: '',
      specialBidId: '',
      quantity: 1,
      unitType: 'hours',
      unitPrice: 0,
      productCost: 0,
      productMolPercentage: null,
      specialBidUnitPrice: null,
      specialBidMolPercentage: null,
      supplierQuoteId: null,
      supplierQuoteItemId: null,
      supplierQuoteSupplierName: null,
      supplierQuoteUnitPrice: null,
      supplierQuoteItemDiscount: null,
      supplierQuoteDiscount: null,
      note: '',
    };
    setFormData((prev) => ({
      ...prev,
      items: [...(prev.items || []), nextItem],
    }));
  };

  const removeItem = (index: number) => {
    if (isReadOnly) return;
    setFormData((prev) => ({
      ...prev,
      items: (prev.items || []).filter((_, itemIndex) => itemIndex !== index),
    }));
  };

  const updateItem = (index: number, field: keyof ClientOfferItem, value: string | number) => {
    if (isReadOnly) return;
    setFormData((prev) => {
      const items = [...(prev.items || [])];
      const current = { ...items[index], [field]: value };

      if (field === 'productId') {
        const product = products.find((item) => item.id === value);
        if (product) {
          const matchingBid = activeSpecialBids.find(
            (bid) => bid.clientId === prev.clientId && bid.productId === value,
          );
          const molSource = matchingBid?.molPercentage ?? product.molPercentage;
          const mol = molSource ? Number(molSource) : 0;
          const cost = matchingBid ? Number(matchingBid.unitPrice) : Number(product.costo);
          current.productName = product.name;
          current.specialBidId = matchingBid?.id || '';
          current.unitPrice = roundToTwoDecimals(calcProductSalePrice(cost, mol));
          current.productCost = Number(product.costo);
          current.productMolPercentage = product.molPercentage;
          current.specialBidUnitPrice = matchingBid ? Number(matchingBid.unitPrice) : null;
          current.specialBidMolPercentage = matchingBid?.molPercentage ?? null;
          current.supplierQuoteId = null;
          current.supplierQuoteItemId = null;
          current.supplierQuoteSupplierName = null;
          current.supplierQuoteUnitPrice = null;
          current.supplierQuoteItemDiscount = null;
          current.supplierQuoteDiscount = null;
        }
      }

      if (field === 'supplierQuoteItemId') {
        if (!value) {
          current.supplierQuoteId = null;
          current.supplierQuoteItemId = null;
          current.supplierQuoteSupplierName = null;
          current.supplierQuoteUnitPrice = null;
          current.supplierQuoteItemDiscount = null;
          current.supplierQuoteDiscount = null;

          const product = products.find((p) => p.id === current.productId);
          if (product) {
            const applicableBid = activeSpecialBids.find(
              (b) => b.clientId === prev.clientId && b.productId === current.productId,
            );
            if (applicableBid) {
              const molSource = applicableBid.molPercentage ?? product.molPercentage;
              const mol = molSource ? Number(molSource) : 0;
              current.specialBidId = applicableBid.id;
              current.unitPrice = roundToTwoDecimals(
                calcProductSalePrice(Number(applicableBid.unitPrice), mol),
              );
              current.productCost = Number(product.costo);
              current.productMolPercentage = product.molPercentage;
              current.specialBidUnitPrice = Number(applicableBid.unitPrice);
              current.specialBidMolPercentage = applicableBid.molPercentage ?? null;
            } else {
              const mol = product.molPercentage ? Number(product.molPercentage) : 0;
              current.specialBidId = '';
              current.unitPrice = roundToTwoDecimals(
                calcProductSalePrice(Number(product.costo), mol),
              );
              current.productCost = Number(product.costo);
              current.productMolPercentage = product.molPercentage;
              current.specialBidUnitPrice = null;
              current.specialBidMolPercentage = null;
            }
          }
          items[index] = current;
          return { ...prev, items };
        }

        const selectedQuote = acceptedSupplierQuotes.find((quote) =>
          quote.items.some((item) => item.id === value),
        );
        const selectedQuoteItem = selectedQuote?.items.find((item) => item.id === value);

        if (selectedQuote && selectedQuoteItem) {
          const product = selectedQuoteItem.productId
            ? products.find((p) => p.id === selectedQuoteItem.productId)
            : undefined;

          const lineDiscountedCost =
            selectedQuoteItem.unitPrice * (1 - (selectedQuoteItem.discount ?? 0) / 100);
          const netCost = lineDiscountedCost * (1 - selectedQuote.discount / 100);

          current.productId = selectedQuoteItem.productId || '';
          current.productName = product?.name || selectedQuoteItem.productName;
          current.supplierQuoteId = selectedQuote.id;
          current.supplierQuoteItemId = selectedQuoteItem.id;
          current.supplierQuoteSupplierName = selectedQuote.supplierName;
          current.supplierQuoteUnitPrice = netCost;
          current.supplierQuoteItemDiscount = selectedQuoteItem.discount ?? 0;
          current.supplierQuoteDiscount = selectedQuote.discount;
          current.quantity = selectedQuoteItem.quantity;
          current.specialBidId = '';
          current.specialBidUnitPrice = null;
          current.specialBidMolPercentage = null;

          let salePrice: number;
          if (product) {
            const mol = product.molPercentage ? Number(product.molPercentage) : 0;
            salePrice = calcProductSalePrice(netCost, mol);
            current.productCost = Number(product.costo);
            current.productMolPercentage = product.molPercentage;
          } else {
            salePrice = netCost;
            current.productCost = netCost;
            current.productMolPercentage = null;
          }
          current.unitPrice = roundToTwoDecimals(salePrice);
        }
      }

      items[index] = current;
      return { ...prev, items };
    });
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    const nextErrors: Record<string, string> = {};
    if (!formData.clientId) {
      nextErrors.clientId = t('sales:clientOffers.clientRequired');
    }
    if (!formData.id?.trim()) {
      nextErrors.id = t('sales:clientOffers.offerCodeRequired', {
        defaultValue: 'Offer code is required',
      });
    }
    if (!formData.items || formData.items.length === 0) {
      nextErrors.items = t('sales:clientOffers.itemsRequired');
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    const payload: Partial<ClientOffer> = {
      ...formData,
      discount: Number(formData.discount ?? 0),
      items: (formData.items || []).map((item) => ({
        ...item,
        unitPrice: Number(item.unitPrice ?? 0),
        productCost: Number(item.productCost ?? 0),
      })),
    };

    if (editingOffer) {
      await onUpdateOffer(editingOffer.id, payload);
    } else if (onAddOffer) {
      await onAddOffer(payload);
    }
    setIsModalOpen(false);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)}>
        <div className="flex max-h-[90vh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl animate-in zoom-in duration-200">
          <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
            <h3 className="text-xl font-black text-slate-800 flex items-center gap-3">
              <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center text-praetor">
                <i className={`fa-solid ${editingOffer ? 'fa-pen-to-square' : 'fa-plus'}`}></i>
              </div>
              {isReadOnly
                ? t('sales:clientOffers.viewOffer', { defaultValue: 'View offer' })
                : editingOffer
                  ? t('sales:clientOffers.editOffer', { defaultValue: 'Edit offer' })
                  : t('sales:clientOffers.newOffer', { defaultValue: 'New offer' })}
            </h3>
            <button
              onClick={() => setIsModalOpen(false)}
              className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-slate-100 text-slate-400 transition-colors"
            >
              <i className="fa-solid fa-xmark text-lg"></i>
            </button>
          </div>

          <form onSubmit={handleSubmit} className="flex-1 space-y-4 overflow-y-auto p-8">
            {editingOffer?.linkedQuoteId && (
              <div className="bg-slate-50 border border-slate-100 rounded-xl p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-white border border-slate-200 flex items-center justify-center text-praetor">
                    <i className="fa-solid fa-link text-sm"></i>
                  </div>
                  <div>
                    <p className="text-xs font-black text-slate-500 uppercase tracking-widest">
                      {t('sales:clientOffers.sourceQuote', { defaultValue: 'Source quote' })}
                    </p>
                    <p className="text-sm font-bold text-slate-800">{editingOffer.linkedQuoteId}</p>
                  </div>
                </div>
                {onViewQuote && (
                  <button
                    type="button"
                    onClick={() => onViewQuote(editingOffer.linkedQuoteId)}
                    className="text-xs font-bold text-praetor hover:text-slate-700 flex items-center gap-1"
                  >
                    {t('sales:clientOffers.viewQuote', { defaultValue: 'View quote' })}
                    <i className="fa-solid fa-arrow-right text-[10px]"></i>
                  </button>
                )}
              </div>
            )}

            {isReadOnly && (
              <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-amber-200 bg-amber-50">
                <span className="text-amber-700 text-xs font-bold">
                  {t('sales:clientOffers.readOnlyStatus', {
                    defaultValue:
                      'Non-draft offers are read-only. Change status from the list actions.',
                  })}
                </span>
              </div>
            )}

            {/* Client Information */}
            <div className="space-y-2">
              <h4 className="text-xs font-black text-praetor uppercase tracking-widest flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-praetor"></span>
                {t('sales:clientOffers.clientInformation', { defaultValue: 'Client Information' })}
              </h4>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 ml-1">
                    {t('sales:clientOffers.client', { defaultValue: 'Client' })}
                  </label>
                  <CustomSelect
                    options={clientOptions}
                    value={formData.clientId || ''}
                    onChange={(value) => handleClientChange(value as string)}
                    placeholder={t('sales:clientOffers.selectAClient', {
                      defaultValue: 'Select a client',
                    })}
                    searchable={true}
                    disabled={isReadOnly || isClientLocked}
                    className={errors.clientId ? 'border-red-300' : ''}
                  />
                  {errors.clientId && (
                    <p className="text-red-500 text-[10px] font-bold ml-1">{errors.clientId}</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 ml-1">
                    {t('sales:clientOffers.offerCode', { defaultValue: 'Offer code' })}
                  </label>
                  <input
                    type="text"
                    value={formData.id || ''}
                    disabled={isReadOnly}
                    onChange={(event) =>
                      setFormData((prev) => ({ ...prev, id: event.target.value }))
                    }
                    placeholder="O0000"
                    className={`w-full text-sm px-4 py-2.5 bg-slate-50 border ${errors.id ? 'border-red-300' : 'border-slate-200'} rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all disabled:opacity-50 disabled:cursor-not-allowed`}
                  />
                  {errors.id && (
                    <p className="text-red-500 text-[10px] font-bold ml-1">{errors.id}</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 ml-1">
                    {t('sales:clientOffers.paymentTerms', { defaultValue: 'Payment terms' })}
                  </label>
                  <CustomSelect
                    options={paymentTermsOptions}
                    value={formData.paymentTerms || 'immediate'}
                    onChange={(value) =>
                      setFormData((prev) => ({
                        ...prev,
                        paymentTerms: value as ClientOffer['paymentTerms'],
                      }))
                    }
                    searchable={false}
                    disabled={isReadOnly}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 ml-1">
                    {t('sales:clientOffers.expirationDate', { defaultValue: 'Expiration date' })}
                  </label>
                  <input
                    type="date"
                    required
                    value={formData.expirationDate || ''}
                    disabled={isReadOnly}
                    onChange={(event) =>
                      setFormData((prev) => ({ ...prev, expirationDate: event.target.value }))
                    }
                    className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                </div>
              </div>
            </div>

            {/* Products */}
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h4 className="text-xs font-black text-praetor uppercase tracking-widest flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-praetor"></span>
                  {t('sales:clientOffers.items', { defaultValue: 'Items' })}
                </h4>
                <button
                  type="button"
                  onClick={addItem}
                  disabled={isReadOnly}
                  className="text-xs font-bold text-praetor hover:text-slate-700 flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <i className="fa-solid fa-plus"></i>{' '}
                  {t('sales:clientOffers.addItem', { defaultValue: 'Add item' })}
                </button>
              </div>
              {errors.items && (
                <p className="text-red-500 text-[10px] font-bold ml-1 -mt-2">{errors.items}</p>
              )}

              {formData.items && formData.items.length > 0 && (
                <div className="hidden lg:flex gap-2 px-3 mb-1 items-center">
                  <div className="flex-1 min-w-0 grid grid-cols-13 gap-2">
                    <div className="col-span-3 text-[10px] font-black text-slate-400 uppercase tracking-wider ml-1">
                      {t('sales:clientQuotes.supplierQuoteColumn')}
                    </div>
                    <div className="col-span-3 text-[10px] font-black text-slate-400 uppercase tracking-wider">
                      {t('sales:clientOffers.product', { defaultValue: 'Product' })}
                    </div>
                    <div className="col-span-2 text-[10px] font-black text-slate-400 uppercase tracking-wider text-center">
                      {t('sales:clientOffers.qty', { defaultValue: 'Qty' })}
                    </div>
                    <div className="col-span-1 text-[10px] font-black text-slate-400 uppercase tracking-wider text-center">
                      {t('crm:internalListing.cost')}
                    </div>
                    <div className="col-span-1 text-[10px] font-black text-slate-400 uppercase tracking-wider text-center whitespace-nowrap">
                      {t('sales:clientQuotes.molLabel', { defaultValue: 'MOL' })}
                    </div>
                    <div className="col-span-1 text-[10px] font-black text-slate-400 uppercase tracking-wider text-center whitespace-nowrap">
                      {t('sales:clientQuotes.totalCost', { defaultValue: 'Total cost' })}
                    </div>
                    <div className="col-span-1 text-[10px] font-black text-slate-400 uppercase tracking-wider text-center">
                      {t('sales:clientQuotes.marginLabel')}
                    </div>
                    <div className="col-span-1 text-[10px] font-black text-slate-400 uppercase tracking-wider text-center">
                      {t('sales:clientQuotes.revenue')}
                    </div>
                  </div>
                  <div className="w-10 shrink-0"></div>
                </div>
              )}

              {formData.items && formData.items.length > 0 ? (
                <div className="space-y-3">
                  {formData.items.map((item, index) => {
                    const selectedBid = item.specialBidId
                      ? activeSpecialBids.find((b) => b.id === item.specialBidId)
                      : undefined;
                    const selectedSupplierQuote = item.supplierQuoteItemId
                      ? supplierQuoteItemOptions.find((o) => o.id === item.supplierQuoteItemId)
                      : undefined;
                    const isSupply =
                      products.find((p) => p.id === item.productId)?.type === 'supply';

                    const {
                      unitCost: cost,
                      molPercentage,
                      lineCost,
                      quantity,
                    } = getItemPricingContext(item);
                    const unitSalePrice = Number(item.unitPrice || 0);
                    const lineSalePrice = unitSalePrice * quantity;
                    const lineMargin = lineSalePrice - lineCost;

                    const handleCostChange = (value: string) => {
                      if (isReadOnly) return;
                      setFormData(makeCostUpdater<Partial<ClientOffer>>(index, value));
                    };

                    const handleMolChange = (value: string) => {
                      if (isReadOnly) return;
                      setFormData(makeMolUpdater<Partial<ClientOffer>>(index, value));
                    };

                    return (
                      <div
                        key={item.id}
                        className="rounded-xl border border-slate-100 bg-slate-50 p-3 space-y-3"
                      >
                        <div className="lg:hidden flex items-start gap-3">
                          <div className="grid flex-1 min-w-0 grid-cols-1 md:grid-cols-2 gap-3">
                            <div className="min-w-0">
                              <div className="mb-1 text-[10px] font-black text-slate-400 uppercase tracking-wider">
                                {t('sales:clientQuotes.supplierQuoteColumn')}
                              </div>
                              <CustomSelect
                                options={supplierQuoteSelectOptions}
                                value={item.supplierQuoteItemId || 'none'}
                                onChange={(val) =>
                                  updateItem(
                                    index,
                                    'supplierQuoteItemId',
                                    val === 'none' ? '' : (val as string),
                                  )
                                }
                                placeholder={t('sales:clientQuotes.selectSupplierQuote')}
                                displayValue={getSupplierQuoteItemDisplayValue(
                                  item.supplierQuoteItemId,
                                )}
                                searchable={true}
                                disabled={isReadOnly}
                                className="min-w-0"
                                buttonClassName="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm"
                              />
                            </div>
                            <div className="min-w-0">
                              <div className="mb-1 text-[10px] font-black text-slate-400 uppercase tracking-wider">
                                {t('sales:clientOffers.product', { defaultValue: 'Product' })}
                              </div>
                              {renderProductSelectOrFallback(item, index, {
                                className: 'min-w-0',
                                buttonClassName:
                                  'w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm',
                              })}
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
                        <div className="grid grid-cols-2 gap-3 md:grid-cols-6 lg:hidden">
                          <div>
                            <div className="mb-1 text-[10px] font-black text-slate-400 uppercase tracking-wider">
                              {t('sales:clientOffers.qty', { defaultValue: 'Qty' })}
                            </div>
                            <div className="flex items-center gap-1">
                              <ValidatedNumberInput
                                step="0.01"
                                min="0"
                                required
                                placeholder={t('sales:clientOffers.qty', { defaultValue: 'Qty' })}
                                value={item.quantity}
                                onValueChange={(value) =>
                                  updateItem(index, 'quantity', parseNumberInputValue(value))
                                }
                                disabled={isReadOnly || Boolean(item.supplierQuoteItemId)}
                                className="w-full text-sm px-3 py-2 bg-white border border-slate-200 rounded-lg focus:ring-2 focus:ring-praetor outline-none text-center disabled:opacity-50 disabled:cursor-not-allowed flex-1"
                              />
                              <span className="text-xs font-semibold text-slate-400 shrink-0">
                                /
                              </span>
                              <UnitTypeSelector
                                value={(item.unitType || 'hours') as SupplierUnitType}
                                onChange={(val) => handleUnitTypeChange(index, val)}
                                isSupply={isSupply}
                                quantity={Number(item.quantity) || 0}
                                disabled={isReadOnly || Boolean(item.supplierQuoteItemId)}
                              />
                            </div>
                          </div>
                          <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 space-y-1">
                            <div className="text-[10px] font-black text-slate-400 uppercase tracking-wider">
                              {t('crm:internalListing.cost')}
                            </div>
                            {selectedSupplierQuote && (
                              <span className="inline-flex px-2 py-0.5 rounded-full bg-emerald-600 text-white text-[8px] font-black uppercase tracking-wider">
                                {t('sales:clientQuotes.supplierQuoteBadge')}
                              </span>
                            )}
                            {selectedBid && !selectedSupplierQuote && (
                              <span className="inline-flex px-2 py-0.5 rounded-full bg-praetor text-white text-[8px] font-black uppercase tracking-wider">
                                {t('sales:clientQuotes.bidBadge')}
                              </span>
                            )}
                            <div className="flex items-center gap-1">
                              <ValidatedNumberInput
                                value={cost.toFixed(2)}
                                onValueChange={handleCostChange}
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
                              {t('sales:clientQuotes.molLabel', { defaultValue: 'MOL' })} (%)
                            </div>
                            <div className="flex items-center gap-1">
                              <ValidatedNumberInput
                                value={molPercentage.toFixed(1)}
                                onValueChange={handleMolChange}
                                disabled={isReadOnly}
                                className="w-full text-sm px-2 py-2 bg-white border border-slate-200 rounded-lg focus:ring-1 focus:ring-praetor outline-none text-center disabled:opacity-50 disabled:cursor-not-allowed"
                              />
                              <span className="text-[9px] font-semibold text-slate-400 shrink-0">
                                %
                              </span>
                            </div>
                          </div>
                          <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 space-y-1">
                            <div className="text-[10px] font-black text-slate-400 uppercase tracking-wider">
                              {t('sales:clientQuotes.totalCost', { defaultValue: 'Total cost' })}
                            </div>
                            <div className="text-xs font-bold text-slate-700 whitespace-nowrap">
                              {lineCost.toFixed(2)} {currency}
                            </div>
                          </div>
                          <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 space-y-1">
                            <div className="text-[10px] font-black text-slate-400 uppercase tracking-wider">
                              {t('sales:clientQuotes.marginLabel')}
                            </div>
                            <div className="text-xs font-bold text-emerald-600 whitespace-nowrap">
                              {lineMargin.toFixed(2)} {currency}
                            </div>
                          </div>
                          <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 space-y-1 col-span-2 md:col-span-1">
                            <div className="text-[10px] font-black text-slate-400 uppercase tracking-wider">
                              {t('sales:clientQuotes.revenue')}
                            </div>
                            <div
                              className={`text-sm font-semibold whitespace-nowrap ${selectedSupplierQuote ? 'text-emerald-600' : selectedBid ? 'text-praetor' : 'text-slate-800'}`}
                            >
                              {lineSalePrice.toFixed(2)} {currency}
                            </div>
                          </div>
                        </div>
                        <div className="hidden lg:flex gap-2 items-center">
                          <div className="flex-1 min-w-0 grid grid-cols-13 gap-2 items-center">
                            <div className="col-span-3 min-w-0">
                              <CustomSelect
                                options={supplierQuoteSelectOptions}
                                value={item.supplierQuoteItemId || 'none'}
                                onChange={(val) =>
                                  updateItem(
                                    index,
                                    'supplierQuoteItemId',
                                    val === 'none' ? '' : (val as string),
                                  )
                                }
                                placeholder={t('sales:clientQuotes.selectSupplierQuote')}
                                displayValue={getSupplierQuoteItemDisplayValue(
                                  item.supplierQuoteItemId,
                                )}
                                searchable={true}
                                disabled={isReadOnly}
                                className="min-w-0"
                                buttonClassName="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm"
                              />
                            </div>
                            <div className="col-span-3 min-w-0">
                              {renderProductSelectOrFallback(item, index, {
                                className: 'min-w-0',
                                buttonClassName:
                                  'w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm',
                              })}
                            </div>
                            <div className="col-span-2">
                              <div className="flex items-center gap-1">
                                <ValidatedNumberInput
                                  step="0.01"
                                  min="0"
                                  required
                                  placeholder={t('sales:clientOffers.qty', { defaultValue: 'Qty' })}
                                  value={item.quantity}
                                  onValueChange={(value) =>
                                    updateItem(index, 'quantity', parseNumberInputValue(value))
                                  }
                                  disabled={isReadOnly || Boolean(item.supplierQuoteItemId)}
                                  className="w-full text-sm px-2 py-2 bg-white border border-slate-200 rounded-lg focus:ring-2 focus:ring-praetor outline-none text-center disabled:opacity-50 disabled:cursor-not-allowed"
                                />
                                <span className="text-xs font-semibold text-slate-400 shrink-0">
                                  /
                                </span>
                                <UnitTypeSelector
                                  value={(item.unitType || 'hours') as SupplierUnitType}
                                  onChange={(val) => handleUnitTypeChange(index, val)}
                                  isSupply={isSupply}
                                  quantity={Number(item.quantity) || 0}
                                  disabled={isReadOnly || Boolean(item.supplierQuoteItemId)}
                                />
                              </div>
                            </div>
                            <div className="col-span-1 flex flex-col items-center justify-center gap-1">
                              {selectedSupplierQuote && (
                                <span className="px-2 py-0.5 rounded-full bg-emerald-600 text-white text-[8px] font-black uppercase tracking-wider">
                                  {t('sales:clientQuotes.supplierQuoteBadge')}
                                </span>
                              )}
                              {selectedBid && !selectedSupplierQuote && (
                                <span className="px-2 py-0.5 rounded-full bg-praetor text-white text-[8px] font-black uppercase tracking-wider">
                                  {t('sales:clientQuotes.bidBadge')}
                                </span>
                              )}
                              <div className="flex items-center gap-1 w-full">
                                <ValidatedNumberInput
                                  value={cost.toFixed(2)}
                                  onValueChange={handleCostChange}
                                  disabled={isReadOnly}
                                  className="w-full text-sm px-1 py-2 bg-white border border-slate-200 rounded-lg focus:ring-1 focus:ring-praetor outline-none text-center disabled:opacity-50 disabled:cursor-not-allowed"
                                />
                                <span className="text-[9px] font-semibold text-slate-400 shrink-0">
                                  {currency}
                                </span>
                              </div>
                            </div>
                            <div className="col-span-1 flex items-center justify-center gap-1">
                              <ValidatedNumberInput
                                value={molPercentage.toFixed(1)}
                                onValueChange={handleMolChange}
                                disabled={isReadOnly}
                                className="w-full text-sm px-1 py-2 bg-white border border-slate-200 rounded-lg focus:ring-1 focus:ring-praetor outline-none text-center disabled:opacity-50 disabled:cursor-not-allowed"
                              />
                              <span className="text-[9px] font-semibold text-slate-400 shrink-0">
                                %
                              </span>
                            </div>
                            <div className="col-span-1 flex items-center justify-center">
                              <span className="text-xs font-bold text-slate-700 whitespace-nowrap">
                                {lineCost.toFixed(2)} {currency}
                              </span>
                            </div>
                            <div className="col-span-1 flex items-center justify-center">
                              <span className="text-xs font-bold text-emerald-600 whitespace-nowrap">
                                {lineMargin.toFixed(2)} {currency}
                              </span>
                            </div>
                            <div className="col-span-1 flex items-center justify-center">
                              <span
                                className={`text-xs font-semibold whitespace-nowrap ${selectedSupplierQuote ? 'text-emerald-600' : selectedBid ? 'text-praetor' : 'text-slate-800'}`}
                              >
                                {lineSalePrice.toFixed(2)} {currency}
                              </span>
                            </div>
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
                        <input
                          type="text"
                          placeholder={t('form:placeholderNotes', {
                            defaultValue: 'Optional notes...',
                          })}
                          value={item.note || ''}
                          onChange={(event) => updateItem(index, 'note', event.target.value)}
                          disabled={isReadOnly}
                          className="w-full text-sm px-3 py-2 bg-white border border-slate-200 rounded-lg focus:ring-2 focus:ring-praetor outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                        />
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-8 text-slate-400 text-sm">
                  {t('sales:clientOffers.noItemsAdded', { defaultValue: 'No items added yet' })}
                </div>
              )}
            </div>

            {(() => {
              const discountValue = Number.isNaN(formData.discount ?? 0)
                ? 0
                : (formData.discount ?? 0);
              const { subtotal, discountAmount, total, margin, marginPercentage } =
                calculatePricingTotals(formData.items || [], discountValue);
              return (
                <div className="flex flex-col gap-4 border-t border-slate-100 pt-4 md:flex-row">
                  <div className="md:w-2/3 space-y-1.5">
                    <h4 className="text-xs font-black text-praetor uppercase tracking-widest flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-praetor"></span>
                      {t('sales:clientOffers.notes', { defaultValue: 'Notes' })}
                    </h4>
                    <textarea
                      rows={4}
                      value={formData.notes || ''}
                      disabled={isReadOnly}
                      placeholder={t('sales:clientOffers.additionalNotesPlaceholder', {
                        defaultValue: 'Additional notes...',
                      })}
                      onChange={(event) =>
                        setFormData((prev) => ({ ...prev, notes: event.target.value }))
                      }
                      className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all resize-none disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                  </div>
                  <div className="md:w-1/3">
                    <CostSummaryPanel
                      currency={currency}
                      subtotal={subtotal}
                      total={total}
                      subtotalLabel={t('sales:clientOffers.subtotal', { defaultValue: 'Subtotal' })}
                      totalLabel={t('sales:clientOffers.total', { defaultValue: 'Total' })}
                      globalDiscount={{
                        label: t('sales:clientOffers.globalDiscount', {
                          defaultValue: 'Global Discount %',
                        }),
                        value: formData.discount || 0,
                        onChange: (value) =>
                          setFormData((prev) => ({
                            ...prev,
                            discount: value === '' ? 0 : Number(value),
                          })),
                        disabled: isReadOnly,
                      }}
                      discountRow={
                        discountValue > 0
                          ? {
                              label: t('sales:clientOffers.discountAmount', {
                                defaultValue: 'Discount',
                              }),
                              amount: discountAmount,
                            }
                          : undefined
                      }
                      margin={{
                        label: `${t('sales:clientOffers.margin', { defaultValue: 'Margin' })} (${(marginPercentage || 0).toFixed(1)}%)`,
                        amount: margin,
                      }}
                    />
                  </div>
                </div>
              );
            })()}

            <div className="flex justify-end gap-3 pt-4">
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="px-8 py-3 text-sm font-bold text-slate-500 hover:bg-slate-50 rounded-xl transition-colors border border-slate-200"
              >
                {t('common:buttons.cancel')}
              </button>
              {!isReadOnly && (
                <button
                  type="submit"
                  className="px-8 py-3 bg-praetor text-white text-sm font-bold rounded-xl shadow-lg shadow-slate-200 hover:bg-slate-700 transition-all active:scale-95"
                >
                  {editingOffer ? t('common:buttons.update') : t('common:buttons.save')}
                </button>
              )}
            </div>
          </form>
        </div>
      </Modal>

      <Modal isOpen={isDeleteConfirmOpen} onClose={() => setIsDeleteConfirmOpen(false)}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in duration-200">
          <div className="p-6 text-center space-y-4">
            <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto text-red-600">
              <i className="fa-solid fa-triangle-exclamation text-xl"></i>
            </div>
            <div>
              <h3 className="text-lg font-black text-slate-800">
                {t('sales:clientOffers.deleteTitle', { defaultValue: 'Delete offer?' })}
              </h3>
              <p className="text-sm text-slate-500 mt-2 leading-relaxed">{offerToDelete?.id}</p>
            </div>
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setIsDeleteConfirmOpen(false)}
                className="flex-1 py-3 text-sm font-bold text-slate-500 hover:bg-slate-50 rounded-xl transition-colors"
              >
                {t('common:buttons.cancel')}
              </button>
              <button
                onClick={async () => {
                  if (!offerToDelete) return;
                  await onDeleteOffer(offerToDelete.id);
                  setIsDeleteConfirmOpen(false);
                  setOfferToDelete(null);
                }}
                className="flex-1 py-3 bg-red-600 text-white text-sm font-bold rounded-xl shadow-lg shadow-red-200 hover:bg-red-700 transition-all active:scale-95"
              >
                {t('common:buttons.delete')}
              </button>
            </div>
          </div>
        </div>
      </Modal>

      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h2 className="text-2xl font-black text-slate-800">
              {t('sales:clientOffers.title', { defaultValue: 'Client Offers' })}
            </h2>
            <p className="text-slate-500 text-sm">
              {t('sales:clientOffers.subtitle', {
                defaultValue: 'Offers created from customer quotes.',
              })}
            </p>
          </div>
          {onAddOffer && (
            <button
              onClick={openAddModal}
              className="bg-praetor text-white px-5 py-2.5 rounded-xl text-sm font-black shadow-xl shadow-slate-200 transition-all hover:bg-slate-700 active:scale-95 flex items-center gap-2"
            >
              <i className="fa-solid fa-plus"></i>
              {t('sales:clientOffers.addOffer', { defaultValue: 'Add offer' })}
            </button>
          )}
        </div>
      </div>

      <StandardTable<ClientOffer>
        title={t('sales:clientOffers.activeOffers', { defaultValue: 'Customer offers' })}
        data={filteredOffers}
        columns={columns}
        defaultRowsPerPage={5}
        onRowClick={(row) => openEditModal(row)}
        rowClassName={() => 'cursor-pointer hover:bg-slate-50/50'}
        initialFilterState={tableInitialFilterState}
      />
    </div>
  );
};

export default ClientOffersView;
