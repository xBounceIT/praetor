import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Client, Product, SpecialBid } from '../types';
import CustomSelect from './CustomSelect';
import StandardTable from './StandardTable';
import ValidatedNumberInput from './ValidatedNumberInput';
import { parseNumberInputValue } from '../utils/numbers';
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
  const [expiredPage, setExpiredPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(() => {
    const saved = localStorage.getItem('praetor_special_bids_rowsPerPage');
    return saved ? parseInt(saved, 10) : 5;
  });

  const handleRowsPerPageChange = (val: string) => {
    const value = parseInt(val, 10);
    setRowsPerPage(value);
    localStorage.setItem('praetor_special_bids_rowsPerPage', value.toString());
    setCurrentPage(1);
    setExpiredPage(1);
  };

  const [searchTerm, setSearchTerm] = useState('');
  const [filterClientId, setFilterClientId] = useState('all');

  const isExpired = (endDate: string) => new Date(endDate) < new Date();
  const isNotStarted = (startDate: string) => new Date(startDate) > new Date();
  const isActiveBid = (bid: SpecialBid) => !isExpired(bid.endDate) && !isNotStarted(bid.startDate);

  const filteredBids = useMemo(() => {
    return bids.filter((bid) => {
      const matchesSearch =
        searchTerm === '' ||
        bid.clientName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        bid.productName.toLowerCase().includes(searchTerm.toLowerCase());

      const matchesClient = filterClientId === 'all' || bid.clientId === filterClientId;

      return matchesSearch && matchesClient;
    });
  }, [bids, searchTerm, filterClientId]);

  const filteredActiveBids = filteredBids.filter((bid) => !isExpired(bid.endDate));
  const filteredExpiredBids = filteredBids.filter((bid) => isExpired(bid.endDate));

  React.useEffect(() => {
    setCurrentPage(1);
    setExpiredPage(1);
  }, [searchTerm, filterClientId]);

  const hasActiveFilters = searchTerm.trim() !== '' || filterClientId !== 'all';

  const handleClearFilters = () => {
    setSearchTerm('');
    setFilterClientId('all');
    setCurrentPage(1);
    setExpiredPage(1);
  };

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

    if (editingBid) {
      onUpdateBid(editingBid.id, formData);
    } else {
      onAddBid(formData);
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

  const activeClients = clients.filter((c) => !c.isDisabled);
  const activeProducts = products.filter((p) => !p.isDisabled && p.type === 'item');

  const activeTotalPages = Math.ceil(filteredActiveBids.length / rowsPerPage);
  const activeStartIndex = (currentPage - 1) * rowsPerPage;
  const paginatedActiveBids = filteredActiveBids.slice(
    activeStartIndex,
    activeStartIndex + rowsPerPage,
  );

  const expiredTotalPages = Math.ceil(filteredExpiredBids.length / rowsPerPage);
  const expiredStartIndex = (expiredPage - 1) * rowsPerPage;
  const paginatedExpiredBids = filteredExpiredBids.slice(
    expiredStartIndex,
    expiredStartIndex + rowsPerPage,
  );

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
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-slate-100 text-praetor rounded-xl flex items-center justify-center text-sm">
              <i className="fa-solid fa-handshake"></i>
            </div>
            <div>
              <div className="font-bold text-slate-800">{bid.clientName}</div>
              <div className="text-[10px] font-black text-slate-400 uppercase">
                {t('specialBids.dedicated')}
              </div>
            </div>
          </div>
        </td>
        <td className="px-8 py-5 text-sm font-bold text-slate-700">{bid.productName}</td>
        <td className="px-8 py-5">
          {expired ? (
            <StatusBadge type="expired" label={t('specialBids.expired')} />
          ) : notStarted ? (
            <StatusBadge type="pending" label={t('specialBids.notStarted')} />
          ) : (
            <StatusBadge type="active" label={t('specialBids.active')} />
          )}
        </td>
        <td className="px-8 py-5 text-sm font-bold text-slate-700">
          {Number(bid.unitPrice).toFixed(2)} {currency}
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
          <div className="flex justify-end gap-2">
            <button
              onClick={(e) => {
                e.stopPropagation();
                openEditModal(bid);
              }}
              className="p-2 text-slate-400 hover:text-praetor hover:bg-slate-100 rounded-lg transition-all"
              title={t('specialBids.editSpecialBidTooltip')}
            >
              <i className="fa-solid fa-pen-to-square"></i>
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                confirmDelete(bid);
              }}
              className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
              title={t('specialBids.deleteSpecialBidTooltip')}
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
                  <i className={`fa-solid ${editingBid ? 'fa-pen-to-square' : 'fa-plus'}`}></i>
                </div>
                {editingBid ? t('specialBids.editSpecialBid') : t('specialBids.createSpecialBid')}
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
                      className={errors.productId ? 'border-red-300' : ''}
                    />
                    {errors.productId && (
                      <p className="text-red-500 text-[10px] font-bold ml-1">{errors.productId}</p>
                    )}
                  </div>
                  <div className="space-y-1.5 md:col-span-2">
                    <label className="text-xs font-bold text-slate-500 ml-1">
                      {t('specialBids.originalPriceToSpecialPrice', { currency })}
                    </label>
                    <div className="flex items-center gap-3">
                      <div className="flex-1 text-sm px-4 py-2.5 bg-slate-100 border border-slate-200 rounded-xl text-slate-600 font-semibold">
                        {originalPriceDisplay}
                      </div>
                      <i className="fa-solid fa-arrow-right text-slate-400"></i>
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
                        className={`flex-1 text-sm px-4 py-2.5 bg-slate-50 border rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all ${errors.unitPrice ? 'border-red-300' : 'border-slate-200'}`}
                      />
                    </div>
                    {errors.unitPrice && (
                      <p className="text-red-500 text-[10px] font-bold ml-1">{errors.unitPrice}</p>
                    )}
                  </div>
                  <div className="space-y-1.5 md:col-span-2">
                    <label className="text-xs font-bold text-slate-500 ml-1">
                      {t('specialBids.originalMolToNewMol')}
                    </label>
                    <div className="flex items-center gap-3">
                      <div className="flex-1 text-sm px-4 py-2.5 bg-slate-100 border border-slate-200 rounded-xl text-slate-600 font-semibold">
                        {originalMolDisplay}
                      </div>
                      <i className="fa-solid fa-arrow-right text-slate-400"></i>
                      <ValidatedNumberInput
                        step="0.01"
                        min="0"
                        max="100"
                        value={formData.molPercentage ?? ''}
                        onValueChange={(value) => {
                          const parsed = parseNumberInputValue(value);
                          setFormData({ ...formData, molPercentage: parsed });
                        }}
                        className="flex-1 text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all"
                        placeholder="--"
                      />
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
                  {t('specialBids.cancel')}
                </button>
                <button
                  type="submit"
                  className="px-10 py-3 bg-praetor text-white text-sm font-bold rounded-xl shadow-lg shadow-slate-200 hover:bg-slate-700 transition-all active:scale-95"
                >
                  {editingBid ? t('specialBids.updateBid') : t('specialBids.createBid')}
                </button>
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

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="md:col-span-2 relative">
          <i className="fa-solid fa-search absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"></i>
          <input
            type="text"
            placeholder={t('specialBids.searchPlaceholder')}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-semibold focus:ring-2 focus:ring-praetor outline-none shadow-sm placeholder:font-normal"
          />
        </div>
        <div>
          <CustomSelect
            options={[
              { id: 'all', name: t('specialBids.allClients') },
              ...activeClients.map((c) => ({ id: c.id, name: c.name })),
            ]}
            value={filterClientId}
            onChange={(val) => setFilterClientId(val as string)}
            placeholder={t('specialBids.filterByClient')}
            searchable={true}
            buttonClassName="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 shadow-sm"
          />
        </div>
        <div className="flex items-center justify-end">
          <button
            type="button"
            onClick={handleClearFilters}
            disabled={!hasActiveFilters}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-bold text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <i className="fa-solid fa-rotate-left"></i>
            {t('specialBids.clearFilters')}
          </button>
        </div>
      </div>

      <StandardTable
        title={t('specialBids.activeSpecialBids')}
        totalCount={filteredActiveBids.length}
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
                {t('specialBids.showing')}{' '}
                {paginatedActiveBids.length > 0 ? activeStartIndex + 1 : 0}-
                {Math.min(activeStartIndex + rowsPerPage, filteredActiveBids.length)}{' '}
                {t('specialBids.of')} {filteredActiveBids.length}
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
                {Array.from({ length: activeTotalPages }, (_, i) => i + 1).map((page) => (
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
                onClick={() => setCurrentPage((prev) => Math.min(activeTotalPages, prev + 1))}
                disabled={currentPage === activeTotalPages || activeTotalPages === 0}
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
                {t('common:labels.status')}
              </th>
              <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                {t('specialBids.unitPrice')}
              </th>
              <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                {t('specialBids.validityPeriod')}
              </th>
              <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">
                {t('common:labels.actions')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {paginatedActiveBids.map(renderBidRow)}
            {filteredActiveBids.length === 0 && (
              <tr>
                <td colSpan={6} className="p-12 text-center">
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

      <StandardTable
        title={t('specialBids.expiredSpecialBids')}
        totalCount={filteredExpiredBids.length}
        totalLabel={t('common:labels.total')}
        containerClassName="border-dashed bg-slate-50"
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
                {t('specialBids.showing')}{' '}
                {paginatedExpiredBids.length > 0 ? expiredStartIndex + 1 : 0}-
                {Math.min(expiredStartIndex + rowsPerPage, filteredExpiredBids.length)}{' '}
                {t('specialBids.of')} {filteredExpiredBids.length}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setExpiredPage((prev) => Math.max(1, prev - 1))}
                disabled={expiredPage === 1}
                className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
              >
                <i className="fa-solid fa-chevron-left text-xs"></i>
              </button>
              <div className="flex items-center gap-1">
                {Array.from({ length: expiredTotalPages }, (_, i) => i + 1).map((page) => (
                  <button
                    key={page}
                    onClick={() => setExpiredPage(page)}
                    className={`w-8 h-8 flex items-center justify-center rounded-lg text-xs font-bold transition-all ${
                      expiredPage === page
                        ? 'bg-praetor text-white shadow-md shadow-slate-200'
                        : 'text-slate-500 hover:bg-slate-100'
                    }`}
                  >
                    {page}
                  </button>
                ))}
              </div>
              <button
                onClick={() => setExpiredPage((prev) => Math.min(expiredTotalPages, prev + 1))}
                disabled={expiredPage === expiredTotalPages || expiredTotalPages === 0}
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
                {t('common:labels.status')}
              </th>
              <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                {t('specialBids.unitPrice')}
              </th>
              <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                {t('quotes.expirationDate')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {paginatedExpiredBids.map((bid) => (
              <tr
                key={bid.id}
                className="opacity-60 grayscale hover:grayscale-0 hover:opacity-100 transition-all group"
              >
                <td className="px-8 py-5">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-slate-200 text-slate-400 rounded-xl flex items-center justify-center text-sm">
                      <i className="fa-solid fa-handshake"></i>
                    </div>
                    <div>
                      <div className="font-bold text-slate-500 line-through">{bid.clientName}</div>
                      <div className="text-[10px] font-black text-slate-400 uppercase">
                        {t('specialBids.dedicated')}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-8 py-5 text-sm font-bold text-slate-500 line-through">
                  {bid.productName}
                </td>
                <td className="px-8 py-5">
                  <StatusBadge type="expired" label={t('specialBids.expired')} />
                </td>
                <td className="px-8 py-5 text-sm font-bold text-slate-500">
                  {Number(bid.unitPrice).toFixed(2)} {currency}
                </td>
                <td className="px-8 py-5 text-sm font-bold text-slate-500">
                  {new Date(bid.endDate).toLocaleDateString()}
                </td>
              </tr>
            ))}
            {filteredExpiredBids.length === 0 && (
              <tr>
                <td colSpan={5} className="p-12 text-center">
                  <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto text-slate-300 mb-4">
                    <i className="fa-solid fa-tags text-2xl"></i>
                  </div>
                  <p className="text-slate-400 text-sm font-bold">
                    {t('specialBids.noExpiredSpecialBids')}
                  </p>
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
