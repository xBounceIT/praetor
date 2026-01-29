import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Client, Product, SpecialBid } from '../types';
import CustomSelect from './CustomSelect';
import StandardTable from './StandardTable';
import ValidatedNumberInput from './ValidatedNumberInput';
import { parseNumberInputValue, roundToTwoDecimals } from '../utils/numbers';
import Calendar from './Calendar';
import StatusBadge from './StatusBadge';

interface SpecialBidsViewProps {
  bids: SpecialBid[];
  clients: Client[];
  products: Product[];
  onAddBid: (bidData: Partial<SpecialBid>) => void;
  onUpdateBid: (id: string, updates: Partial<SpecialBid>) => void;
  onDeleteBid: (id: string) => void;
  currency: string;
}

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

  const [currentPage, setCurrentPage] = useState(1);

  const [rowsPerPage, setRowsPerPage] = useState(() => {
    const saved = localStorage.getItem('praetor_special_bids_rowsPerPage');
    return saved ? parseInt(saved, 10) : 5;
  });

  const handleRowsPerPageChange = (val: string) => {
    const value = parseInt(val, 10);
    setRowsPerPage(value);
    localStorage.setItem('praetor_special_bids_rowsPerPage', value.toString());
    setCurrentPage(1);
  };

  /* Filters removed as per user request */
  const filteredBids = bids;

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
      newErrors.clientId = t('specialBids.errors.clientRequired');
    }
    if (!formData.productId) {
      newErrors.productId = t('specialBids.errors.productRequired');
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
      newErrors.unitPrice = t('specialBids.errors.invalidPrice');
    }
    if (!formData.startDate) {
      newErrors.dates = t('specialBids.errors.startDateRequired');
    }
    if (!formData.endDate) {
      newErrors.dates = t('specialBids.errors.endDateRequired');
    }
    if (formData.startDate && formData.endDate && formData.startDate > formData.endDate) {
      newErrors.dates = t('specialBids.errors.startDateBeforeEndDate');
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
        newErrors.productId = t('specialBids.errors.existingBid');
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

  const totalPages = Math.ceil(filteredBids.length / rowsPerPage);
  const startIndex = (currentPage - 1) * rowsPerPage;
  const paginatedBids = filteredBids.slice(startIndex, startIndex + rowsPerPage);

  const renderBidRow = (bid: SpecialBid) => {
    const expired = isExpired(bid.endDate);
    const notStarted = isNotStarted(bid.startDate);

    return (
      <tr
        key={bid.id}
        onClick={() => openEditModal(bid)}
        className={`hover:bg-slate-50/50 transition-colors group cursor-pointer ${expired ? 'bg-red-50/30' : notStarted ? 'bg-amber-50/30' : ''}`}
      >
        <td className="px-8 py-5">
          <div className="font-bold text-slate-800">{bid.clientName}</div>
        </td>
        <td className="px-8 py-5 text-sm font-bold text-slate-700">{bid.productName}</td>
        <td className="px-8 py-5 text-sm font-bold text-slate-700">
          {Number(bid.unitPrice).toFixed(2)} {currency}
        </td>
        <td className="px-8 py-5 text-sm font-bold text-slate-700">
          {bid.molPercentage !== undefined && bid.molPercentage !== null
            ? `${Number(bid.molPercentage).toFixed(2)} %`
            : '--'}
        </td>
        <td className="px-8 py-5">
          <div
            className={`text-sm ${expired ? 'text-red-600 font-bold' : notStarted ? 'text-amber-600 font-bold' : 'text-slate-600'}`}
          >
            {new Date(bid.startDate).toLocaleDateString()} -{' '}
            {new Date(bid.endDate).toLocaleDateString()}
          </div>
        </td>
        <td className="px-8 py-5">
          {expired ? (
            <StatusBadge type="expired" label={t('specialBids.expired')} />
          ) : notStarted ? (
            <StatusBadge type="pending" label={t('specialBids.notStarted')} />
          ) : (
            <StatusBadge type="active" label={t('specialBids.active')} />
          )}
        </td>
        <td className="px-8 py-5">
          <div className="flex justify-end gap-2">
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (!expired) {
                  confirmDelete(bid);
                }
              }}
              disabled={expired}
              className={`p-2 rounded-lg transition-all ${expired ? 'text-slate-200 cursor-not-allowed' : 'text-slate-400 hover:text-red-600 hover:bg-red-50'}`}
              title={
                expired
                  ? t('specialBids.cannotDeleteExpired')
                  : t('specialBids.deleteSpecialBidTooltip')
              }
            >
              <i className="fa-solid fa-trash-can"></i>
            </button>
          </div>
        </td>
      </tr>
    );
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4 backdrop-blur-sm">
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
                    ? t('specialBids.viewSpecialBid')
                    : t('specialBids.editSpecialBid')
                  : t('specialBids.createSpecialBid')}
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-slate-100 text-slate-400 transition-colors"
              >
                <i className="fa-solid fa-xmark text-lg"></i>
              </button>
            </div>

            <form onSubmit={handleSubmit} className="overflow-y-auto p-8 space-y-8">
              <div className="space-y-4">
                <h4 className="text-xs font-black text-praetor uppercase tracking-widest flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-praetor"></span>
                  {t('specialBids.specialBidDetails')}
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 ml-1">
                      {t('specialBids.dedicatedClient')}
                    </label>
                    <CustomSelect
                      options={activeClients.map((c) => ({ id: c.id, name: c.name }))}
                      value={formData.clientId || ''}
                      onChange={(val) => handleClientChange(val as string)}
                      placeholder={t('specialBids.selectClient')}
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
                      {t('specialBids.productItem')}
                    </label>
                    <CustomSelect
                      options={activeProducts.map((p) => ({ id: p.id, name: p.name }))}
                      value={formData.productId || ''}
                      onChange={(val) => handleProductChange(val as string)}
                      placeholder={t('specialBids.selectProduct')}
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
                          {t('specialBids.labelOriginal')} {t('specialBids.unitPrice')} ({currency})
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
                          {t('specialBids.labelNew')} {t('specialBids.unitPrice')} ({currency})
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
                          {t('specialBids.labelOriginal')} {t('crm:products.mol')}
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
                          {t('specialBids.labelNew')} {t('crm:products.mol')}
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
                      {t('crm:products.salePriceCalculated')}
                    </label>
                    <div className="w-full text-sm px-4 py-2.5 bg-slate-100 border border-slate-200 rounded-xl text-slate-600 font-semibold">
                      {hasBidPricing
                        ? `${calcSalePrice(bidCostValue!, bidMolValue!).toFixed(2)} ${currency}`
                        : '--'}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 ml-1">
                      {t('crm:products.marginCalculated')}
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
                  {t('specialBids.validityPeriod')}
                </h4>
                <div className="flex items-center gap-4 text-sm text-slate-600 mb-2">
                  <span className="font-bold">
                    {formData.startDate
                      ? new Date(formData.startDate).toLocaleDateString()
                      : t('specialBids.selectStart')}
                  </span>
                  <i className="fa-solid fa-arrow-right text-slate-400"></i>
                  <span className="font-bold">
                    {formData.endDate
                      ? new Date(formData.endDate).toLocaleDateString()
                      : t('specialBids.selectEnd')}
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
                    ? t('specialBids.close')
                    : t('specialBids.cancel')}
                </button>
                {!(editingBid && isExpired(editingBid.endDate)) && (
                  <button
                    type="submit"
                    className="px-10 py-3 bg-praetor text-white text-sm font-bold rounded-xl shadow-lg shadow-slate-200 hover:bg-slate-700 transition-all active:scale-95"
                  >
                    {editingBid ? t('specialBids.updateBid') : t('specialBids.createBid')}
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      )}

      {isDeleteConfirmOpen && (
        <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in duration-200">
            <div className="p-6 text-center space-y-4">
              <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto text-red-600">
                <i className="fa-solid fa-triangle-exclamation text-xl"></i>
              </div>
              <div>
                <h3 className="text-lg font-black text-slate-800">
                  {t('specialBids.deleteConfirmTitle')}
                </h3>
                <p className="text-sm text-slate-500 mt-2 leading-relaxed">
                  {t('specialBids.deleteConfirmMessage', { clientName: bidToDelete?.clientName })}
                </p>
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setIsDeleteConfirmOpen(false)}
                  className="flex-1 py-3 text-sm font-bold text-slate-500 hover:bg-slate-50 rounded-xl transition-colors"
                >
                  {t('specialBids.cancel')}
                </button>
                <button
                  onClick={handleDelete}
                  className="flex-1 py-3 bg-red-600 text-white text-sm font-bold rounded-xl shadow-lg shadow-red-200 hover:bg-red-700 transition-all active:scale-95"
                >
                  {t('specialBids.yesDelete')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-black text-slate-800">{t('specialBids.title')}</h2>
          <p className="text-slate-500 text-sm">{t('specialBids.subtitle')}</p>
        </div>
      </div>

      <StandardTable
        title={t('specialBids.title')}
        totalCount={filteredBids.length}
        headerAction={
          <button
            onClick={openAddModal}
            className="bg-praetor text-white px-4 py-2.5 rounded-xl text-sm font-black shadow-xl shadow-slate-200 transition-all hover:bg-slate-700 active:scale-95 flex items-center gap-2"
          >
            <i className="fa-solid fa-plus"></i> {t('specialBids.createSpecialBid')}
          </button>
        }
        footerClassName="flex flex-col sm:flex-row justify-between items-center gap-4"
        footer={
          <>
            <div className="flex items-center gap-3">
              <span className="text-xs font-bold text-slate-500">
                {t('specialBids.rowsPerPage')}
              </span>
              <CustomSelect
                options={[
                  { id: '5', name: '5' },
                  { id: '10', name: '10' },
                  { id: '20', name: '20' },
                  { id: '50', name: '50' },
                ]}
                value={rowsPerPage.toString()}
                onChange={(val) => handleRowsPerPageChange(val as string)}
                className="w-20"
                buttonClassName="px-2 py-1 bg-white border border-slate-200 text-xs font-bold text-slate-700 rounded-lg"
                searchable={false}
              />
              <span className="text-xs font-bold text-slate-400 ml-2">
                {t('specialBids.showing')} {paginatedBids.length > 0 ? startIndex + 1 : 0}-
                {Math.min(startIndex + rowsPerPage, filteredBids.length)} {t('specialBids.of')}{' '}
                {filteredBids.length}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                disabled={currentPage === 1}
                className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
              >
                <i className="fa-solid fa-chevron-left text-xs"></i>
              </button>
              <div className="flex items-center gap-1">
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                  <button
                    key={page}
                    onClick={() => setCurrentPage(page)}
                    className={`w-8 h-8 flex items-center justify-center rounded-lg text-xs font-bold transition-all ${
                      currentPage === page
                        ? 'bg-praetor text-white shadow-md shadow-slate-200'
                        : 'text-slate-500 hover:bg-slate-100'
                    }`}
                  >
                    {page}
                  </button>
                ))}
              </div>
              <button
                onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                disabled={currentPage === totalPages || totalPages === 0}
                className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
              >
                <i className="fa-solid fa-chevron-right text-xs"></i>
              </button>
            </div>
          </>
        }
      >
        <table className="w-full text-left border-collapse">
          <thead className="bg-slate-50 border-b border-slate-100">
            <tr>
              <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                {t('specialBids.client')}
              </th>
              <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                {t('specialBids.product')}
              </th>
              <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                {t('specialBids.unitPrice')}
              </th>
              <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                {t('specialBids.mol')}
              </th>
              <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                {t('specialBids.validityPeriod')}
              </th>
              <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                {t('common:labels.status')}
              </th>
              <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">
                {t('common:labels.actions')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {paginatedBids.map(renderBidRow)}
            {filteredBids.length === 0 && (
              <tr>
                <td colSpan={7} className="p-12 text-center">
                  <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto text-slate-300 mb-4">
                    <i className="fa-solid fa-tags text-2xl"></i>
                  </div>
                  <p className="text-slate-400 text-sm font-bold">
                    {t('specialBids.noActiveSpecialBids')}
                  </p>
                  <button
                    onClick={openAddModal}
                    className="mt-4 text-praetor text-sm font-black hover:underline"
                  >
                    {t('specialBids.createYourFirstSpecialBid')}
                  </button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </StandardTable>
    </div>
  );
};

export default SpecialBidsView;
