import type React from 'react';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Client, ClientOffer, ClientOfferItem, Product, SpecialBid } from '../../types';
import {
  getLocalDateString,
  isDateOnlyWithinInclusiveRange,
  normalizeDateOnlyString,
} from '../../utils/date';
import { roundToTwoDecimals } from '../../utils/numbers';
import CustomSelect from '../shared/CustomSelect';
import Modal from '../shared/Modal';
import StandardTable, { type Column } from '../shared/StandardTable';
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

const calcProductSalePrice = (cost: number, molPercentage: number) => {
  if (molPercentage >= 100) return cost;
  return cost / (1 - molPercentage / 100);
};

const calculateTotals = (items: ClientOfferItem[], globalDiscount: number) => {
  let subtotal = 0;
  let totalCost = 0;
  const taxGroups: Record<number, number> = {};

  items.forEach((item) => {
    const lineSubtotal = item.quantity * item.unitPrice;
    const lineDiscount = (lineSubtotal * Number(item.discount ?? 0)) / 100;
    const lineNet = lineSubtotal - lineDiscount;

    subtotal += lineNet;

    const taxRate = Number(item.productTaxRate ?? 0);
    const lineNetAfterGlobal = lineNet * (1 - globalDiscount / 100);
    const taxAmount = lineNetAfterGlobal * (taxRate / 100);
    taxGroups[taxRate] = (taxGroups[taxRate] || 0) + taxAmount;

    const cost = item.specialBidId
      ? Number(item.specialBidUnitPrice ?? 0)
      : Number(item.productCost ?? 0);
    totalCost += item.quantity * cost;
  });

  const discountAmount = subtotal * (globalDiscount / 100);
  const taxableAmount = subtotal - discountAmount;
  const totalTax = Object.values(taxGroups).reduce((sum, val) => sum + val, 0);
  const total = taxableAmount + totalTax;
  const margin = taxableAmount - totalCost;
  const marginPercentage = taxableAmount > 0 ? (margin / taxableAmount) * 100 : 0;

  return {
    subtotal,
    taxableAmount,
    discountAmount,
    totalTax,
    total,
    margin,
    marginPercentage,
    taxGroups,
  };
};

export interface ClientOffersViewProps {
  offers: ClientOffer[];
  clients: Client[];
  products: Product[];
  specialBids: SpecialBid[];
  offerIdsWithOrders: ReadonlySet<string>;
  onAddOffer?: (offerData: Partial<ClientOffer>) => void | Promise<void>;
  onUpdateOffer: (id: string, updates: Partial<ClientOffer>) => void | Promise<void>;
  onDeleteOffer: (id: string) => void | Promise<void>;
  onCreateClientsOrder?: (offer: ClientOffer) => void | Promise<void>;
  onViewQuote?: (quoteId: string) => void;
  currency: string;
  quoteFilterId?: string | null;
  offerFilterCode?: string | null;
}

const ClientOffersView: React.FC<ClientOffersViewProps> = ({
  offers,
  clients,
  products,
  specialBids,
  offerIdsWithOrders,
  onAddOffer,
  onUpdateOffer,
  onDeleteOffer,
  onCreateClientsOrder,
  onViewQuote,
  currency,
  quoteFilterId,
  offerFilterCode,
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
  const activeProducts = useMemo(
    () => products.filter((product) => !product.isDisabled),
    [products],
  );
  const today = getLocalDateString();
  const activeSpecialBids = useMemo(() => {
    return specialBids.filter((bid) => {
      return isDateOnlyWithinInclusiveRange(today, bid.startDate, bid.endDate);
    });
  }, [specialBids, today]);

  const [editingOffer, setEditingOffer] = useState<ClientOffer | null>(null);
  const [offerToDelete, setOfferToDelete] = useState<ClientOffer | null>(null);
  const [searchTerm, _setSearchTerm] = useState('');
  const [filterStatus, _setFilterStatus] = useState('all');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formData, setFormData] = useState<Partial<ClientOffer>>({
    offerCode: '',
    linkedQuoteId: '',
    clientId: '',
    clientName: '',
    items: [],
    paymentTerms: 'immediate',
    discount: 0,
    status: 'draft',
    expirationDate: getLocalDateString(),
    notes: '',
  });

  const isReadOnly = Boolean(editingOffer && editingOffer.status !== 'draft');
  const isClientLocked = Boolean(editingOffer?.linkedQuoteId);

  const filteredOffers = useMemo(() => {
    let currentOffers = offers;
    if (quoteFilterId) {
      currentOffers = currentOffers.filter((o) => o.linkedQuoteId === quoteFilterId);
    }
    if (offerFilterCode) {
      currentOffers = currentOffers.filter((o) => o.offerCode === offerFilterCode);
    }

    return currentOffers.filter((offer) => {
      const matchesSearch =
        searchTerm.trim() === '' ||
        offer.clientName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        offer.offerCode.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesStatus = filterStatus === 'all' || offer.status === filterStatus;
      return matchesSearch && matchesStatus;
    });
  }, [offers, searchTerm, filterStatus, quoteFilterId, offerFilterCode]);

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

  // Column definitions for StandardTable
  const columns = useMemo<Column<ClientOffer>[]>(
    () => [
      {
        header: t('sales:clientOffers.offerCodeColumn', { defaultValue: 'Offer Code' }),
        accessorKey: 'offerCode',
        className: 'whitespace-nowrap',
        headerClassName: 'min-w-[8rem]',
        cell: ({ row }) => <span className="font-bold text-slate-700">{row.offerCode}</span>,
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
        accessorFn: (row) => calculateTotals(row.items, row.discount).total,
        className: 'whitespace-nowrap',
        headerClassName: 'min-w-[8rem]',
        disableFiltering: true,
        cell: ({ row }) => {
          const { total } = calculateTotals(row.items, row.discount);
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
              {onViewQuote && (
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
    setFormData({
      offerCode: '',
      linkedQuoteId: '',
      clientId: '',
      clientName: '',
      items: [],
      paymentTerms: 'immediate',
      discount: 0,
      status: 'draft',
      expirationDate: getLocalDateString(),
      notes: '',
    });
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
      unitPrice: 0,
      productCost: 0,
      productTaxRate: 0,
      productMolPercentage: null,
      specialBidUnitPrice: null,
      specialBidMolPercentage: null,
      discount: 0,
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
          current.unitPrice = calcProductSalePrice(cost, mol);
          current.productCost = Number(product.costo);
          current.productTaxRate = Number(product.taxRate ?? 0);
          current.productMolPercentage = product.molPercentage;
          current.specialBidUnitPrice = matchingBid ? Number(matchingBid.unitPrice) : null;
          current.specialBidMolPercentage = matchingBid?.molPercentage ?? null;
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
    if (!formData.offerCode?.trim()) {
      nextErrors.offerCode = t('sales:clientOffers.offerCodeRequired', {
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
      discount: roundToTwoDecimals(Number(formData.discount ?? 0)),
      items: (formData.items || []).map((item) => ({
        ...item,
        unitPrice: roundToTwoDecimals(Number(item.unitPrice ?? 0)),
        productCost: roundToTwoDecimals(Number(item.productCost ?? 0)),
        productTaxRate: roundToTwoDecimals(Number(item.productTaxRate ?? 0)),
        discount: roundToTwoDecimals(Number(item.discount ?? 0)),
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
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl overflow-hidden animate-in zoom-in duration-200 flex flex-col max-h-[90vh]">
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

          <form onSubmit={handleSubmit} className="overflow-y-auto p-8 space-y-8">
            {editingOffer?.linkedQuoteId && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 flex items-center justify-between gap-3">
                <span>
                  {t('sales:clientOffers.sourceQuote', {
                    defaultValue: 'Source quote: {{quoteId}}',
                    quoteId: editingOffer.linkedQuoteCode || editingOffer.linkedQuoteId,
                  })}
                </span>
                {onViewQuote && (
                  <button
                    type="button"
                    onClick={() => onViewQuote(editingOffer.linkedQuoteId)}
                    className="text-praetor font-bold hover:text-slate-700"
                  >
                    {t('sales:clientOffers.viewQuote', { defaultValue: 'View quote' })}
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

            {/* Client Selection */}
            <div className="space-y-4">
              <h4 className="text-xs font-black text-praetor uppercase tracking-widest flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-praetor"></span>
                {t('sales:clientOffers.clientInformation', { defaultValue: 'Client Information' })}
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 ml-1">
                    {t('sales:clientOffers.client', { defaultValue: 'Client' })}
                  </label>
                  <CustomSelect
                    options={activeClients.map((client) => ({ id: client.id, name: client.name }))}
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
                    value={formData.offerCode || ''}
                    disabled={isReadOnly}
                    onChange={(event) =>
                      setFormData((prev) => ({ ...prev, offerCode: event.target.value }))
                    }
                    placeholder="O0000"
                    className={`w-full text-sm px-4 py-2.5 bg-slate-50 border ${errors.offerCode ? 'border-red-300' : 'border-slate-200'} rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all disabled:opacity-50 disabled:cursor-not-allowed`}
                  />
                  {errors.offerCode && (
                    <p className="text-red-500 text-[10px] font-bold ml-1">{errors.offerCode}</p>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
                    {t('sales:clientOffers.globalDiscount', { defaultValue: 'Global Discount %' })}
                  </label>
                  <ValidatedNumberInput
                    step="0.01"
                    min="0"
                    max="100"
                    value={formData.discount || 0}
                    onValueChange={(value) =>
                      setFormData((prev) => ({
                        ...prev,
                        discount: value === '' ? 0 : Number(value),
                      }))
                    }
                    disabled={isReadOnly}
                    className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
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
                <div className="col-span-full space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 ml-1">
                    {t('sales:clientOffers.notes', { defaultValue: 'Notes' })}
                  </label>
                  <textarea
                    rows={3}
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
                <div className="flex gap-3 px-3 mb-1 items-center">
                  <div className="flex-1 grid grid-cols-12 gap-3">
                    <div className="col-span-4 text-[10px] font-black text-slate-400 uppercase tracking-wider ml-1">
                      {t('sales:clientOffers.product', { defaultValue: 'Product' })}
                    </div>
                    <div className="col-span-1 text-[10px] font-black text-slate-400 uppercase tracking-wider text-center">
                      {t('sales:clientOffers.qty', { defaultValue: 'Qty' })}
                    </div>
                    <div className="col-span-2 text-[10px] font-black text-slate-400 uppercase tracking-wider text-center">
                      {t('sales:clientOffers.unitPrice', { defaultValue: 'Unit Price' })}
                    </div>
                    <div className="col-span-2 text-[10px] font-black text-slate-400 uppercase tracking-wider text-center">
                      {t('sales:clientOffers.discount', { defaultValue: 'Discount %' })}
                    </div>
                    <div className="col-span-2 text-[10px] font-black text-slate-400 uppercase tracking-wider text-center">
                      {t('sales:clientOffers.taxRate', { defaultValue: 'Tax %' })}
                    </div>
                  </div>
                  <div className="w-10 shrink-0"></div>
                </div>
              )}

              {formData.items && formData.items.length > 0 ? (
                <div className="space-y-3">
                  {formData.items.map((item, index) => (
                    <div key={item.id} className="bg-slate-50 p-3 rounded-xl space-y-2">
                      <div className="flex gap-3 items-center">
                        <div className="flex-1 grid grid-cols-12 gap-3 items-center">
                          <div className="col-span-4">
                            <CustomSelect
                              options={activeProducts.map((product) => ({
                                id: product.id,
                                name: product.name,
                              }))}
                              value={item.productId}
                              onChange={(value) => updateItem(index, 'productId', value as string)}
                              placeholder={t('sales:clientOffers.selectProduct', {
                                defaultValue: 'Select product',
                              })}
                              searchable={true}
                              disabled={isReadOnly}
                              buttonClassName="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm"
                            />
                          </div>
                          <div className="col-span-1">
                            <ValidatedNumberInput
                              step="0.01"
                              min="0"
                              required
                              placeholder={t('sales:clientOffers.qty', { defaultValue: 'Qty' })}
                              value={item.quantity}
                              onValueChange={(value) => {
                                const parsed = parseFloat(value);
                                updateItem(
                                  index,
                                  'quantity',
                                  value === '' || Number.isNaN(parsed) ? 0 : parsed,
                                );
                              }}
                              disabled={isReadOnly}
                              className="w-full text-sm px-2 py-2 bg-white border border-slate-200 rounded-lg focus:ring-2 focus:ring-praetor outline-none text-center disabled:opacity-50 disabled:cursor-not-allowed"
                            />
                          </div>
                          <div className="col-span-2">
                            <ValidatedNumberInput
                              step="0.01"
                              min="0"
                              value={item.unitPrice}
                              onValueChange={(value) =>
                                updateItem(index, 'unitPrice', value === '' ? 0 : Number(value))
                              }
                              disabled={isReadOnly}
                              className="w-full text-sm px-2 py-2 bg-white border border-slate-200 rounded-lg focus:ring-2 focus:ring-praetor outline-none text-center disabled:opacity-50 disabled:cursor-not-allowed"
                            />
                          </div>
                          <div className="col-span-2">
                            <ValidatedNumberInput
                              step="0.01"
                              min="0"
                              max="100"
                              value={item.discount || 0}
                              onValueChange={(value) =>
                                updateItem(index, 'discount', value === '' ? 0 : Number(value))
                              }
                              disabled={isReadOnly}
                              className="w-full text-sm px-2 py-2 bg-white border border-slate-200 rounded-lg focus:ring-2 focus:ring-praetor outline-none text-center disabled:opacity-50 disabled:cursor-not-allowed"
                            />
                          </div>
                          <div className="col-span-2">
                            <ValidatedNumberInput
                              step="0.01"
                              min="0"
                              max="100"
                              value={item.productTaxRate || 0}
                              onValueChange={(value) =>
                                updateItem(
                                  index,
                                  'productTaxRate',
                                  value === '' ? 0 : Number(value),
                                )
                              }
                              disabled={isReadOnly}
                              className="w-full text-sm px-2 py-2 bg-white border border-slate-200 rounded-lg focus:ring-2 focus:ring-praetor outline-none text-center disabled:opacity-50 disabled:cursor-not-allowed"
                            />
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
                      <div>
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
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-slate-400 text-sm">
                  {t('sales:clientOffers.noItemsAdded', { defaultValue: 'No items added yet' })}
                </div>
              )}
            </div>

            {/* Totals Section */}
            {formData.items && formData.items.length > 0 && (
              <div className="mt-4 flex flex-col items-end space-y-2 px-3">
                {(() => {
                  const discountValue = Number.isNaN(formData.discount ?? 0)
                    ? 0
                    : (formData.discount ?? 0);
                  const {
                    taxableAmount,
                    discountAmount,
                    total,
                    margin,
                    marginPercentage,
                    taxGroups,
                  } = calculateTotals(formData.items, discountValue);
                  return (
                    <>
                      {/* Taxable Amount */}
                      <div className="flex items-center gap-4">
                        <span className="text-sm font-bold text-slate-500">
                          {t('sales:clientOffers.taxableAmount', {
                            defaultValue: 'Taxable Amount',
                          })}
                          :
                        </span>
                        <span className="text-sm font-black text-slate-800">
                          {taxableAmount.toFixed(2)} {currency}
                        </span>
                      </div>

                      {/* Discount */}
                      {discountValue > 0 && (
                        <div className="flex items-center gap-4">
                          <span className="text-sm font-bold text-slate-500">
                            {t('sales:clientOffers.discountAmount', { defaultValue: 'Discount' })} (
                            {discountValue}%):
                          </span>
                          <span className="text-sm font-black text-amber-600">
                            -{discountAmount.toFixed(2)} {currency}
                          </span>
                        </div>
                      )}

                      {/* Tax */}
                      {Object.entries(taxGroups).map(([rate, amount]) => (
                        <div key={rate} className="flex items-center gap-4">
                          <span className="text-sm font-bold text-slate-500">
                            {t('sales:clientOffers.tax', { defaultValue: 'Tax', rate })}:
                          </span>
                          <span className="text-sm font-black text-slate-800">
                            {amount.toFixed(2)} {currency}
                          </span>
                        </div>
                      ))}

                      {/* Margin */}
                      <div className="flex items-center gap-4">
                        <span className="text-sm font-bold text-emerald-600">
                          {t('sales:clientOffers.margin', { defaultValue: 'Margin' })} (
                          {(marginPercentage || 0).toFixed(1)}%):
                        </span>
                        <span className="text-sm font-black text-emerald-600">
                          {margin.toFixed(2)} {currency}
                        </span>
                      </div>

                      {/* Total */}
                      <div className="flex items-center gap-4 pt-2 mt-2 border-t border-slate-100">
                        <span className="text-lg font-black text-slate-400 uppercase tracking-widest">
                          {t('sales:clientOffers.total', { defaultValue: 'Total' })}:
                        </span>
                        <span className="text-3xl font-black text-praetor">
                          {total.toFixed(2)}{' '}
                          <span className="text-lg text-slate-400 font-bold">{currency}</span>
                        </span>
                      </div>
                    </>
                  );
                })()}
              </div>
            )}

            <div className="flex justify-between items-center pt-8 border-t border-slate-100">
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
                  className="px-10 py-3 bg-praetor text-white text-sm font-bold rounded-xl shadow-lg shadow-slate-200 hover:bg-slate-700 transition-all active:scale-95"
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
              <p className="text-sm text-slate-500 mt-2 leading-relaxed">
                {offerToDelete?.offerCode}
              </p>
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
        title={
          offerFilterCode
            ? t('sales:clientOffers.activeOffersFilteredByCode', {
                defaultValue: 'Offer {{code}}',
                code: offerFilterCode,
              })
            : quoteFilterId
              ? t('sales:clientOffers.activeOffersFiltered', {
                  defaultValue: 'Active Offers for Quote',
                })
              : t('sales:clientOffers.activeOffers', { defaultValue: 'Customers Offers' })
        }
        data={filteredOffers}
        columns={columns}
        defaultRowsPerPage={5}
        onRowClick={(row) => openEditModal(row)}
        rowClassName={() => 'cursor-pointer hover:bg-slate-50/50'}
      />
    </div>
  );
};

export default ClientOffersView;
