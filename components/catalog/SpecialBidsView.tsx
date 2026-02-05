import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Client, Product, SpecialBid } from '../../types';
import CustomSelect from '../shared/CustomSelect';
import StandardTable from '../shared/StandardTable';
import ValidatedNumberInput from '../shared/ValidatedNumberInput';
import { parseNumberInputValue, roundToTwoDecimals } from '../../utils/numbers';
import Calendar from '../shared/Calendar';
import StatusBadge from '../shared/StatusBadge';
import Modal from '../shared/Modal';

interface SpecialBidsViewProps {
  bids: SpecialBid[];
  clients: Client[];
  products: Product[];
  onAddBid: (bidData: Partial<SpecialBid>) => void;
  onUpdateBid: (id: string, updates: Partial<SpecialBid>) => void;
  onDeleteBid: (id: string) => void;
  currency: string;
}

const getBidStatus = (bid: SpecialBid) => {
  const isExpired = new Date(bid.endDate) < new Date();
  const isNotStarted = new Date(bid.startDate) > new Date();
  if (isExpired) return 'expired';
  if (isNotStarted) return 'notStarted';
  return 'active';
};

const SpecialBidsView: React.FC<SpecialBidsViewProps> = ({
  bids,
  clients,
  products,
  onAddBid,
  onUpdateBid,
  onDeleteBid,
  currency,
}) => {
  const { t } = useTranslation(['crm', 'common']);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingBid, setEditingBid] = useState<SpecialBid | null>(null);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [bidToDelete, setBidToDelete] = useState<SpecialBid | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const isExpired = (endDate: string) => new Date(endDate) < new Date();
  const isNotStarted = (startDate: string) => new Date(startDate) > new Date();
  const isActiveBid = (bid: SpecialBid) => !isExpired(bid.endDate) && !isNotStarted(bid.startDate);

  const [formData, setFormData] = useState<Partial<SpecialBid>>({
    clientId: '',
    clientName: '',
    productId: '',
    productName: '',
    unitPrice: 0,
    molPercentage: undefined,
    startDate: new Date().toISOString().split('T')[0],
    endDate: new Date().toISOString().split('T')[0],
  });

  const openAddModal = () => {
    setEditingBid(null);
    setFormData({
      clientId: '',
      clientName: '',
      productId: '',
      productName: '',
      unitPrice: 0,
      molPercentage: undefined,
      startDate: new Date().toISOString().split('T')[0],
      endDate: new Date().toISOString().split('T')[0],
    });
    setErrors({});
    setIsModalOpen(true);
  };

  const openEditModal = (bid: SpecialBid) => {
    setEditingBid(bid);
    const formattedStartDate = bid.startDate
      ? new Date(bid.startDate).toISOString().split('T')[0]
      : '';
    const formattedEndDate = bid.endDate ? new Date(bid.endDate).toISOString().split('T')[0] : '';
    setFormData({
      clientId: bid.clientId,
      clientName: bid.clientName,
      productId: bid.productId,
      productName: bid.productName,
      unitPrice: bid.unitPrice,
      molPercentage: bid.molPercentage,
      startDate: formattedStartDate,
      endDate: formattedEndDate,
    });
    setErrors({});
    setIsModalOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const newErrors: Record<string, string> = {};
    if (!formData.clientId) {
      newErrors.clientId = t('externalListing.errors.clientRequired');
    }
    if (!formData.productId) {
      newErrors.productId = t('externalListing.errors.productRequired');
    }
    const selectedProduct = formData.productId
      ? products.find((p) => p.id === formData.productId)
      : undefined;
    const originalPrice = selectedProduct ? Number(selectedProduct.costo) : undefined;
    const normalizedOriginalPrice =
      originalPrice !== undefined && !Number.isNaN(originalPrice) ? originalPrice : undefined;
    if (
      formData.unitPrice === undefined ||
      formData.unitPrice === null ||
      Number.isNaN(formData.unitPrice) ||
      formData.unitPrice <= 0 ||
      normalizedOriginalPrice === undefined ||
      formData.unitPrice >= normalizedOriginalPrice
    ) {
      newErrors.unitPrice = t('externalListing.errors.invalidPrice');
    }
    if (!formData.startDate) {
      newErrors.dates = t('externalListing.errors.startDateRequired');
    }
    if (!formData.endDate) {
      newErrors.dates = t('externalListing.errors.endDateRequired');
    }
    if (formData.startDate && formData.endDate && formData.startDate > formData.endDate) {
      newErrors.dates = t('externalListing.errors.startDateBeforeEndDate');
    }

    if (formData.clientId && formData.productId) {
      const existingBid = bids.find(
        (b) =>
          b.clientId === formData.clientId &&
          b.productId === formData.productId &&
          b.id !== editingBid?.id &&
          isActiveBid(b),
      );
      if (existingBid) {
        newErrors.productId = t('externalListing.errors.existingBid');
      }
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    const payload = {
      ...formData,
      unitPrice: formData.unitPrice !== undefined ? roundToTwoDecimals(formData.unitPrice) : 0,
      molPercentage:
        formData.molPercentage !== undefined
          ? roundToTwoDecimals(formData.molPercentage)
          : undefined,
    };

    if (editingBid) {
      const expired = isExpired(editingBid.endDate);
      if (!expired) {
        onUpdateBid(editingBid.id, payload);
      }
    } else {
      onAddBid(payload);
    }
    setIsModalOpen(false);
  };

  const confirmDelete = (bid: SpecialBid) => {
    setBidToDelete(bid);
    setIsDeleteConfirmOpen(true);
  };

  const handleDelete = () => {
    if (bidToDelete) {
      onDeleteBid(bidToDelete.id);
      setIsDeleteConfirmOpen(false);
      setBidToDelete(null);
    }
  };

  const handleClientChange = (clientId: string) => {
    const client = clients.find((c) => c.id === clientId);
    setFormData({
      ...formData,
      clientId,
      clientName: client?.name || '',
    });
    if (errors.clientId || errors.productId) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next.clientId;
        delete next.productId;
        return next;
      });
    }
  };

  const handleProductChange = (productId: string) => {
    const product = products.find((p) => p.id === productId);
    setFormData({
      ...formData,
      productId,
      productName: product?.name || '',
    });
    if (errors.productId || errors.unitPrice) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next.productId;
        delete next.unitPrice;
        return next;
      });
    }
  };

  const selectedProductForPrice = formData.productId
    ? products.find((p) => p.id === formData.productId)
    : undefined;
  const originalPriceValue = selectedProductForPrice
    ? Number(selectedProductForPrice.costo)
    : undefined;
  const originalPriceDisplay =
    originalPriceValue !== undefined && !Number.isNaN(originalPriceValue)
      ? `${originalPriceValue.toFixed(2)} ${currency}`
      : '--';
  const originalMolValue = selectedProductForPrice
    ? Number(selectedProductForPrice.molPercentage)
    : undefined;
  const originalMolDisplay =
    originalMolValue !== undefined && !Number.isNaN(originalMolValue)
      ? `${originalMolValue.toFixed(2)} %`
      : '--';

  const calcSalePrice = (costo: number, molPercentage: number) => {
    if (molPercentage >= 100) return costo;
    return costo / (1 - molPercentage / 100);
  };

  const calcMargin = (costo: number, molPercentage: number) => {
    return calcSalePrice(costo, molPercentage) - costo;
  };

  const bidCostValue =
    formData.unitPrice !== undefined && !Number.isNaN(formData.unitPrice)
      ? Number(formData.unitPrice)
      : undefined;
  const bidMolValue =
    formData.molPercentage !== undefined && !Number.isNaN(formData.molPercentage)
      ? Number(formData.molPercentage)
      : undefined;
  const hasBidPricing = bidCostValue !== undefined && bidMolValue !== undefined;

  const activeClients = clients.filter((c) => !c.isDisabled);
  const activeProducts = products.filter(
    (p) => !p.isDisabled && (p.type === 'item' || p.type === 'supply'),
  );

  // Table columns definition with TableFilter support
  const columns = useMemo(
    () => [
      {
        header: t('externalListing.client'),
        accessorFn: (row: SpecialBid) => row.clientName,
        cell: ({ row }: { row: SpecialBid }) => (
          <div className="font-bold text-slate-800">{row.clientName}</div>
        ),
      },
      {
        header: t('externalListing.product'),
        accessorFn: (row: SpecialBid) => row.productName,
        cell: ({ row }: { row: SpecialBid }) => (
          <span className="text-sm font-bold text-slate-700">{row.productName}</span>
        ),
      },
      {
        header: t('externalListing.unitPrice'),
        accessorFn: (row: SpecialBid) => row.unitPrice,
        cell: ({ row }: { row: SpecialBid }) => (
          <span className="text-sm font-bold text-slate-700">
            {Number(row.unitPrice).toFixed(2)} {currency}
          </span>
        ),
        filterFormat: (val: unknown) => Number(val).toFixed(2),
      },
      {
        header: t('externalListing.mol'),
        accessorFn: (row: SpecialBid) =>
          row.molPercentage !== undefined && row.molPercentage !== null
            ? `${Number(row.molPercentage).toFixed(2)} %`
            : '--',
        cell: ({ row }: { row: SpecialBid }) => (
          <span className="text-sm font-bold text-slate-700">
            {row.molPercentage !== undefined && row.molPercentage !== null
              ? `${Number(row.molPercentage).toFixed(2)} %`
              : '--'}
          </span>
        ),
      },
      {
        header: t('externalListing.validityPeriod'),
        accessorFn: (row: SpecialBid) => {
          const start = new Date(row.startDate).toLocaleDateString();
          const end = new Date(row.endDate).toLocaleDateString();
          return `${start} - ${end}`;
        },
        cell: ({ row }: { row: SpecialBid }) => {
          const expired = isExpired(row.endDate);
          const notStarted = isNotStarted(row.startDate);
          return (
            <div
              className={`text-sm ${expired ? 'text-red-600 font-bold' : notStarted ? 'text-amber-600 font-bold' : 'text-slate-600'}`}
            >
              {new Date(row.startDate).toLocaleDateString()} -{' '}
              {new Date(row.endDate).toLocaleDateString()}
            </div>
          );
        },
      },
      {
        header: t('common:labels.status'),
        accessorFn: (row: SpecialBid) => {
          const status = getBidStatus(row);
          if (status === 'expired') return t('externalListing.expired');
          if (status === 'notStarted') return t('externalListing.notStarted');
          return t('externalListing.active');
        },
        cell: ({ row }: { row: SpecialBid }) => {
          const expired = isExpired(row.endDate);
          const notStarted = isNotStarted(row.startDate);
          return (
            <div className={expired || notStarted ? 'opacity-60' : ''}>
              {expired ? (
                <StatusBadge type="expired" label={t('externalListing.expired')} />
              ) : notStarted ? (
                <StatusBadge type="pending" label={t('externalListing.notStarted')} />
              ) : (
                <StatusBadge type="active" label={t('externalListing.active')} />
              )}
            </div>
          );
        },
      },
      {
        header: t('common:labels.actions'),
        id: 'actions',
        disableSorting: true,
        disableFiltering: true,
        align: 'right' as const,
        cell: ({ row }: { row: SpecialBid }) => {
          const expired = isExpired(row.endDate);
          return (
            <div className="flex justify-end gap-2">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (!expired) {
                    confirmDelete(row);
                  }
                }}
                disabled={expired}
                className={`p-2 rounded-lg transition-all ${expired ? 'text-slate-200 cursor-not-allowed' : 'text-slate-400 hover:text-red-600 hover:bg-red-50'}`}
                title={
                  expired
                    ? t('externalListing.cannotDeleteExpired')
                    : t('externalListing.deleteSpecialBidTooltip')
                }
              >
                <i className="fa-solid fa-trash-can"></i>
              </button>
            </div>
          );
        },
      },
    ],
    [currency, t],
  );

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden animate-in zoom-in duration-200 flex flex-col max-h-[90vh]">
          <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
            <h3 className="text-xl font-black text-slate-800 flex items-center gap-3">
              <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center text-praetor">
                <i
                  className={`fa-solid ${editingBid ? (isExpired(editingBid.endDate) ? 'fa-eye' : 'fa-pen-to-square') : 'fa-plus'}`}
                ></i>
              </div>
              {editingBid
                ? isExpired(editingBid.endDate)
                  ? t('externalListing.viewSpecialBid')
                  : t('externalListing.editSpecialBid')
                : t('externalListing.createSpecialBid')}
            </h3>
            <button
              onClick={() => setIsModalOpen(false)}
              className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-slate-100 text-slate-400 transition-colors"
            >
              <i className="fa-solid fa-xmark text-lg"></i>
            </button>
          </div>

          <form onSubmit={handleSubmit} className="overflow-y-auto p-8 space-y-8">
            {editingBid && isExpired(editingBid.endDate) && (
              <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-amber-200 bg-amber-50">
                <i className="fa-solid fa-lock text-amber-600 text-sm"></i>
                <span className="text-amber-700 text-xs font-bold">
                  {t('crm:externalListing.readOnlyExpired')}
                </span>
              </div>
            )}
            <div className="space-y-4">
              <h4 className="text-xs font-black text-praetor uppercase tracking-widest flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-praetor"></span>
                {t('externalListing.specialBidDetails')}
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 ml-1">
                    {t('externalListing.dedicatedClient')}
                  </label>
                  <CustomSelect
                    options={activeClients.map((c) => ({ id: c.id, name: c.name }))}
                    value={formData.clientId || ''}
                    onChange={(val) => handleClientChange(val as string)}
                    placeholder={t('externalListing.selectClient')}
                    searchable={true}
                    disabled={editingBid ? isExpired(editingBid.endDate) : false}
                    className={errors.clientId ? 'border-red-300' : ''}
                  />
                  {errors.clientId && (
                    <p className="text-red-500 text-[10px] font-bold ml-1">{errors.clientId}</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 ml-1">
                    {t('externalListing.productItem')}
                  </label>
                  <CustomSelect
                    options={activeProducts.map((p) => ({ id: p.id, name: p.name }))}
                    value={formData.productId || ''}
                    onChange={(val) => handleProductChange(val as string)}
                    placeholder={t('externalListing.selectProduct')}
                    searchable={true}
                    disabled={editingBid ? isExpired(editingBid.endDate) : false}
                    className={errors.productId ? 'border-red-300' : ''}
                  />
                  {errors.productId && (
                    <p className="text-red-500 text-[10px] font-bold ml-1">{errors.productId}</p>
                  )}
                </div>
                <div className="space-y-1.5 md:col-span-2">
                  <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-3">
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-500 ml-1">
                        {t('externalListing.labelOriginal')} {t('externalListing.unitPrice')} (
                        {currency})
                      </label>
                      <div className="w-full text-sm px-4 py-2.5 bg-slate-100 border border-slate-200 rounded-xl text-slate-600 font-semibold">
                        {originalPriceDisplay}
                      </div>
                    </div>
                    <div className="hidden md:flex items-center justify-center self-end h-[42px]">
                      <i className="fa-solid fa-arrow-right text-slate-400"></i>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-500 ml-1">
                        {t('externalListing.labelNew')} {t('externalListing.unitPrice')} ({currency}
                        )
                      </label>
                      <ValidatedNumberInput
                        step="0.01"
                        min="0.01"
                        required
                        value={formData.unitPrice ?? ''}
                        onValueChange={(value) => {
                          const parsed = parseNumberInputValue(value);
                          setFormData({ ...formData, unitPrice: parsed });
                          if (errors.unitPrice) {
                            setErrors((prev) => {
                              const next = { ...prev };
                              delete next.unitPrice;
                              return next;
                            });
                          }
                        }}
                        disabled={editingBid ? isExpired(editingBid.endDate) : false}
                        className={`w-full text-sm px-4 py-2.5 bg-slate-50 border rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all ${errors.unitPrice ? 'border-red-300' : 'border-slate-200'}`}
                      />
                    </div>
                  </div>
                  {errors.unitPrice && (
                    <p className="text-red-500 text-[10px] font-bold ml-1">{errors.unitPrice}</p>
                  )}
                </div>
                <div className="space-y-1.5 md:col-span-2">
                  <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-3">
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-500 ml-1">
                        {t('externalListing.labelOriginal')} {t('crm:internalListing.mol')}
                      </label>
                      <div className="w-full text-sm px-4 py-2.5 bg-slate-100 border border-slate-200 rounded-xl text-slate-600 font-semibold">
                        {originalMolDisplay}
                      </div>
                    </div>
                    <div className="hidden md:flex items-center justify-center self-end h-[42px]">
                      <i className="fa-solid fa-arrow-right text-slate-400"></i>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-500 ml-1">
                        {t('externalListing.labelNew')} {t('crm:internalListing.mol')}
                      </label>
                      <ValidatedNumberInput
                        step="0.01"
                        min="0"
                        max="100"
                        value={formData.molPercentage ?? ''}
                        onValueChange={(value) => {
                          const parsed = parseNumberInputValue(value);
                          setFormData({ ...formData, molPercentage: parsed });
                        }}
                        disabled={editingBid ? isExpired(editingBid.endDate) : false}
                        className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all"
                        placeholder="--"
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 ml-1">
                    {t('crm:internalListing.salePriceCalculated')}
                  </label>
                  <div className="w-full text-sm px-4 py-2.5 bg-slate-100 border border-slate-200 rounded-xl text-slate-600 font-semibold">
                    {hasBidPricing
                      ? `${calcSalePrice(bidCostValue!, bidMolValue!).toFixed(2)} ${currency}`
                      : '--'}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 ml-1">
                    {t('crm:internalListing.marginCalculated')}
                  </label>
                  <div className="w-full text-sm px-4 py-2.5 bg-slate-100 border border-slate-200 rounded-xl text-emerald-600 font-semibold">
                    {hasBidPricing
                      ? `${calcMargin(bidCostValue!, bidMolValue!).toFixed(2)} ${currency}`
                      : '--'}
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <h4 className="text-xs font-black text-praetor uppercase tracking-widest flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-praetor"></span>
                {t('externalListing.validityPeriod')}
              </h4>
              <div className="flex items-center gap-4 text-sm text-slate-600 mb-2">
                <span className="font-bold">
                  {formData.startDate
                    ? new Date(formData.startDate).toLocaleDateString()
                    : t('externalListing.selectStart')}
                </span>
                <i className="fa-solid fa-arrow-right text-slate-400"></i>
                <span className="font-bold">
                  {formData.endDate
                    ? new Date(formData.endDate).toLocaleDateString()
                    : t('externalListing.selectEnd')}
                </span>
              </div>
              <Calendar
                selectionMode="range"
                startDate={formData.startDate}
                endDate={formData.endDate || undefined}
                onRangeSelect={(start, end) => {
                  if (!(editingBid && isExpired(editingBid.endDate))) {
                    setFormData({
                      ...formData,
                      startDate: start,
                      endDate: end ?? '',
                    });
                    if (errors.dates) {
                      setErrors((prev) => {
                        const next = { ...prev };
                        delete next.dates;
                        return next;
                      });
                    }
                  }
                }}
              />
              {errors.dates && (
                <p className="text-red-500 text-[10px] font-bold ml-1">{errors.dates}</p>
              )}
            </div>

            <div className="flex justify-between items-center pt-6 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="px-8 py-3 text-sm font-bold text-slate-500 hover:bg-slate-50 rounded-xl transition-colors border border-slate-200"
              >
                {editingBid && isExpired(editingBid.endDate)
                  ? t('externalListing.close')
                  : t('externalListing.cancel')}
              </button>
              {!(editingBid && isExpired(editingBid.endDate)) && (
                <button
                  type="submit"
                  className="px-10 py-3 bg-praetor text-white text-sm font-bold rounded-xl shadow-lg shadow-slate-200 hover:bg-slate-700 transition-all active:scale-95"
                >
                  {editingBid ? t('externalListing.updateBid') : t('externalListing.createBid')}
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
                {t('externalListing.deleteConfirmTitle')}
              </h3>
              <p className="text-sm text-slate-500 mt-2 leading-relaxed">
                {t('externalListing.deleteConfirmMessage', { clientName: bidToDelete?.clientName })}
              </p>
            </div>
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setIsDeleteConfirmOpen(false)}
                className="flex-1 py-3 text-sm font-bold text-slate-500 hover:bg-slate-50 rounded-xl transition-colors"
              >
                {t('externalListing.cancel')}
              </button>
              <button
                onClick={handleDelete}
                className="flex-1 py-3 bg-red-600 text-white text-sm font-bold rounded-xl shadow-lg shadow-red-200 hover:bg-red-700 transition-all active:scale-95"
              >
                {t('externalListing.yesDelete')}
              </button>
            </div>
          </div>
        </div>
      </Modal>

      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h2 className="text-2xl font-black text-slate-800">{t('externalListing.title')}</h2>
            <p className="text-slate-500 text-sm">{t('externalListing.subtitle')}</p>
          </div>
          <button
            onClick={openAddModal}
            className="bg-praetor text-white px-5 py-2.5 rounded-xl text-sm font-black shadow-xl shadow-slate-200 transition-all hover:bg-slate-700 active:scale-95 flex items-center gap-2"
          >
            <i className="fa-solid fa-plus"></i> {t('externalListing.createSpecialBid')}
          </button>
        </div>
      </div>

      <StandardTable
        title={t('externalListing.title')}
        data={bids}
        columns={columns}
        defaultRowsPerPage={5}
        containerClassName="overflow-visible"
        rowClassName={(row: SpecialBid) => {
          const expired = isExpired(row.endDate);
          const notStarted = isNotStarted(row.startDate);
          return expired ? 'bg-red-50/30' : notStarted ? 'bg-amber-50/30' : 'hover:bg-slate-50/50';
        }}
        onRowClick={(row: SpecialBid) => openEditModal(row)}
      />
    </div>
  );
};

export default SpecialBidsView;
