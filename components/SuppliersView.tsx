import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Supplier } from '../types';
import CustomSelect from './CustomSelect';

interface SuppliersViewProps {
  suppliers: Supplier[];
  onAddSupplier: (supplierData: Partial<Supplier>) => void;
  onUpdateSupplier: (id: string, updates: Partial<Supplier>) => void;
  onDeleteSupplier: (id: string) => void;
}

const SuppliersView: React.FC<SuppliersViewProps> = ({ suppliers, onAddSupplier, onUpdateSupplier, onDeleteSupplier }) => {
  const { t } = useTranslation('suppliers');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [supplierToDelete, setSupplierToDelete] = useState<Supplier | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(() => {
    const saved = localStorage.getItem('praetor_suppliers_rowsPerPage');
    return saved ? parseInt(saved, 10) : 5;
  });

  const handleRowsPerPageChange = (val: string) => {
    const value = parseInt(val, 10);
    setRowsPerPage(value);
    localStorage.setItem('praetor_suppliers_rowsPerPage', value.toString());
    setCurrentPage(1);
  };

  const [formData, setFormData] = useState<Partial<Supplier>>({
    name: '',
    supplierCode: '',
    contactName: '',
    email: '',
    phone: '',
    address: '',
    vatNumber: '',
    taxCode: '',
    paymentTerms: '',
    notes: ''
  });

  const openAddModal = () => {
    setEditingSupplier(null);
    setFormData({
      name: '',
      supplierCode: '',
      contactName: '',
      email: '',
      phone: '',
      address: '',
      vatNumber: '',
      taxCode: '',
      paymentTerms: '',
      notes: ''
    });
    setErrors({});
    setIsModalOpen(true);
  };

  const openEditModal = (supplier: Supplier) => {
    setEditingSupplier(supplier);
    setFormData({
      name: supplier.name || '',
      supplierCode: supplier.supplierCode || '',
      contactName: supplier.contactName || '',
      email: supplier.email || '',
      phone: supplier.phone || '',
      address: supplier.address || '',
      vatNumber: supplier.vatNumber || '',
      taxCode: supplier.taxCode || '',
      paymentTerms: supplier.paymentTerms || '',
      notes: supplier.notes || ''
    });
    setErrors({});
    setIsModalOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const newErrors: Record<string, string> = {};
    if (!formData.name?.trim()) {
      newErrors.name = t('suppliers.nameRequired', { defaultValue: 'Name is required' });
    }
    if (!formData.supplierCode?.trim()) {
      newErrors.supplierCode = t('suppliers.codeRequired', { defaultValue: 'Supplier ID is required' });
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    if (editingSupplier) {
      onUpdateSupplier(editingSupplier.id, formData);
    } else {
      onAddSupplier(formData);
    }
    setIsModalOpen(false);
  };

  const confirmDelete = (supplier: Supplier) => {
    setSupplierToDelete(supplier);
    setIsDeleteConfirmOpen(true);
  };

  const handleDelete = () => {
    if (supplierToDelete) {
      onDeleteSupplier(supplierToDelete.id);
      setIsDeleteConfirmOpen(false);
      setSupplierToDelete(null);
    }
  };

  const activeSuppliersTotal = suppliers.filter(s => !s.isDisabled);
  const disabledSuppliers = suppliers.filter(s => s.isDisabled);

  const totalPages = Math.ceil(activeSuppliersTotal.length / rowsPerPage);
  const startIndex = (currentPage - 1) * rowsPerPage;
  const activeSuppliers = activeSuppliersTotal.slice(startIndex, startIndex + rowsPerPage);

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden animate-in zoom-in duration-200 flex flex-col max-h-[90vh]">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <h3 className="text-xl font-black text-slate-800 flex items-center gap-3">
                <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center text-praetor">
                  <i className={`fa-solid ${editingSupplier ? 'fa-pen-to-square' : 'fa-plus'}`}></i>
                </div>
                {editingSupplier ? t('suppliers.editSupplier') : t('suppliers.addSupplier')}
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-slate-100 text-slate-400 transition-colors"
              >
                <i className="fa-solid fa-xmark text-lg"></i>
              </button>
            </div>

            <form onSubmit={handleSubmit} className="overflow-y-auto p-8 space-y-8" noValidate>
              <div className="space-y-4">
                <h4 className="text-xs font-black text-praetor uppercase tracking-widest flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-praetor"></span>
                  {t('suppliers.supplierDetails')}
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 ml-1">{t('suppliers.supplierCode')}</label>
                    <input
                      type="text"
                      value={formData.supplierCode}
                      onChange={(e) => {
                        setFormData({ ...formData, supplierCode: e.target.value });
                        if (errors.supplierCode) setErrors({ ...errors, supplierCode: '' });
                      }}
                      placeholder="es. SUP-001"
                      className={`w-full text-sm px-4 py-2.5 bg-slate-50 border rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all ${errors.supplierCode ? 'border-red-500 bg-red-50' : 'border-slate-200'}`}
                    />
                    {errors.supplierCode && (
                      <p className="text-red-500 text-[10px] font-bold ml-1">{errors.supplierCode}</p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 ml-1">{t('suppliers.title')}</label>
                    <input
                      type="text"
                      value={formData.name}
                      onChange={(e) => {
                        setFormData({ ...formData, name: e.target.value });
                        if (errors.name) setErrors({ ...errors, name: '' });
                      }}
                      placeholder="es. Alfa Forniture S.r.l."
                      className={`w-full text-sm px-4 py-2.5 bg-slate-50 border rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all ${errors.name ? 'border-red-500 bg-red-50' : 'border-slate-200'}`}
                    />
                    {errors.name && (
                      <p className="text-red-500 text-[10px] font-bold ml-1">{errors.name}</p>
                    )}
                  </div>
                  <div className="col-span-full space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 ml-1">{t('suppliers.contactName')}</label>
                    <input
                      type="text"
                      value={formData.contactName}
                      onChange={(e) => setFormData({ ...formData, contactName: e.target.value })}
                      placeholder="es. Ufficio Acquisti"
                      className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <h4 className="text-xs font-black text-praetor uppercase tracking-widest flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-praetor"></span>
                  {t('suppliers.contacts', { defaultValue: 'Contacts' })}
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 ml-1">{t('suppliers.email')}</label>
                    <input
                      type="email"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      placeholder="email@fornitore.com"
                      className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 ml-1">{t('suppliers.phone')}</label>
                    <input
                      type="text"
                      value={formData.phone}
                      onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                      placeholder="+39 000 0000000"
                      className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all"
                    />
                  </div>
                  <div className="col-span-full space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 ml-1">{t('suppliers.address')}</label>
                    <textarea
                      rows={2}
                      value={formData.address}
                      onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                      placeholder="Via Esempio 123, 00100 Roma (RM)"
                      className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all resize-none"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <h4 className="text-xs font-black text-praetor uppercase tracking-widest flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-praetor"></span>
                  {t('suppliers.administrativeDetails', { defaultValue: 'Administrative Details' })}
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 ml-1">{t('suppliers.vatNumber')}</label>
                    <input
                      type="text"
                      value={formData.vatNumber}
                      onChange={(e) => setFormData({ ...formData, vatNumber: e.target.value })}
                      placeholder="IT01234567890"
                      className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 ml-1">{t('suppliers.taxCode')}</label>
                    <input
                      type="text"
                      value={formData.taxCode}
                      onChange={(e) => setFormData({ ...formData, taxCode: e.target.value })}
                      className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 ml-1">{t('suppliers.paymentTerms')}</label>
                    <input
                      type="text"
                      value={formData.paymentTerms}
                      onChange={(e) => setFormData({ ...formData, paymentTerms: e.target.value })}
                      placeholder="es. 30 gg D.F.F.M."
                      className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 ml-1">{t('suppliers.notes')}</label>
                    <input
                      type="text"
                      value={formData.notes}
                      onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                      className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all"
                    />
                  </div>
                </div>
              </div>

              <div className="flex justify-between items-center pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-8 py-3 text-sm font-bold text-slate-500 hover:bg-slate-50 rounded-xl transition-colors border border-slate-200"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  className="px-10 py-3 bg-praetor text-white text-sm font-bold rounded-xl shadow-lg shadow-slate-200 hover:bg-slate-700 transition-all active:scale-95"
                >
                  {editingSupplier ? t('common.update') : t('common.save')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isDeleteConfirmOpen && (
        <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-sm overflow-hidden animate-in zoom-in duration-200">
            <div className="p-6 text-center space-y-4">
              <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto text-red-600">
                <i className="fa-solid fa-triangle-exclamation text-xl"></i>
              </div>
              <div>
                <h3 className="text-lg font-black text-slate-800">{t('suppliers.deleteConfirmTitle', { defaultValue: 'Delete Supplier?' })}</h3>
                <p className="text-sm text-slate-500 mt-2 leading-relaxed">
                  {t('suppliers.deleteConfirm', { name: supplierToDelete?.name })}
                  {t('suppliers.actionUndone', { defaultValue: ' This action cannot be undone.' })}
                </p>
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setIsDeleteConfirmOpen(false)}
                  className="flex-1 py-3 text-sm font-bold text-slate-500 hover:bg-slate-50 rounded-xl transition-colors"
                >
                  {t('common.cancel')}
                </button>
                <button
                  onClick={handleDelete}
                  className="flex-1 py-3 bg-red-600 text-white text-sm font-bold rounded-xl shadow-lg shadow-red-200 hover:bg-red-700 transition-all active:scale-95"
                >
                  {t('common.yesDelete')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-black text-slate-800">{t('suppliers.title')}</h2>
          <p className="text-slate-500 text-sm">{t('suppliers.subtitle')}</p>
        </div>
        <button
          onClick={openAddModal}
          className="bg-praetor text-white px-6 py-3 rounded-2xl font-black shadow-xl shadow-slate-200 transition-all hover:bg-slate-700 active:scale-95 flex items-center gap-2"
        >
          <i className="fa-solid fa-plus"></i> {t('suppliers.addSupplier')}
        </button>
      </div>

      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm">
        <div className="px-8 py-5 bg-slate-50 border-b border-slate-200 flex justify-between items-center rounded-t-3xl">
          <h4 className="font-black text-slate-400 uppercase text-[10px] tracking-widest">{t('common.active')}</h4>
          <span className="bg-slate-100 text-praetor px-3 py-1 rounded-full text-[10px] font-black">{activeSuppliersTotal.length} {t('common.total')}</span>
        </div>
        <div className="divide-y divide-slate-100">
          {activeSuppliers.map(s => (
            <div key={s.id} onClick={() => openEditModal(s)} className="p-6 hover:bg-slate-50/50 active:bg-slate-100 active:scale-[0.98] transition-all group cursor-pointer select-none">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex gap-4 items-start">
                  <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-lg shadow-sm bg-slate-100 text-praetor">
                    <i className="fa-solid fa-industry"></i>
                  </div>
                  <div>
                    <div className="flex items-center gap-3">
                      <h4 className="font-bold text-slate-800 leading-tight">{s.name}</h4>
                      {s.supplierCode && (
                        <span className="text-[10px] font-black bg-slate-100 text-slate-500 px-2 py-0.5 rounded uppercase">{s.supplierCode}</span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
                      {s.email && (
                        <span className="text-xs text-slate-500 flex items-center gap-1.5">
                          <i className="fa-solid fa-envelope text-[10px] text-slate-300"></i> {s.email}
                        </span>
                      )}
                      {s.phone && (
                        <span className="text-xs text-slate-500 flex items-center gap-1.5">
                          <i className="fa-solid fa-phone text-[10px] text-slate-300"></i> {s.phone}
                        </span>
                      )}
                      {s.vatNumber && (
                        <span className="text-xs text-slate-400 font-mono tracking-tighter">VAT: {s.vatNumber}</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      openEditModal(s);
                    }}
                    className="p-2.5 text-slate-400 hover:text-praetor hover:bg-slate-100 rounded-xl transition-all"
                    title={t('suppliers.editSupplier')}
                  >
                    <i className="fa-solid fa-pen-to-square"></i>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onUpdateSupplier(s.id, { isDisabled: true });
                    }}
                    className="p-2.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-xl transition-all"
                    title={t('suppliers.isDisabled')}
                  >
                    <i className="fa-solid fa-ban"></i>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      confirmDelete(s);
                    }}
                    className="p-2.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all"
                    title={t('common.delete')}
                  >
                    <i className="fa-solid fa-trash-can"></i>
                  </button>
                </div>
              </div>
            </div>
          ))}
          {activeSuppliersTotal.length === 0 && (
            <div className="p-12 text-center">
              <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto text-slate-300 mb-4">
                <i className="fa-solid fa-truck text-2xl"></i>
              </div>
              <p className="text-slate-400 text-sm font-bold">{t('suppliers.noSuppliers')}.</p>
              <button onClick={openAddModal} className="mt-4 text-praetor text-sm font-black hover:underline">{t('suppliers.createFirst')}</button>
            </div>
          )}
        </div>

        <div className="px-8 py-4 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row justify-between items-center gap-4 rounded-b-3xl">
          <div className="flex items-center gap-3">
            <span className="text-xs font-bold text-slate-500">{t('common.rowsPerPage')}</span>
            <CustomSelect
              options={[
                { id: '5', name: '5' },
                { id: '10', name: '10' },
                { id: '20', name: '20' },
                { id: '50', name: '50' }
              ]}
              value={rowsPerPage.toString()}
              onChange={(val) => handleRowsPerPageChange(val)}
              className="w-20"
              buttonClassName="px-2 py-1 bg-white border border-slate-200 text-xs font-bold text-slate-700 rounded-lg"
              searchable={false}
            />
            <span className="text-xs font-bold text-slate-400 ml-2">
              {t('common.showing')} {activeSuppliers.length > 0 ? startIndex + 1 : 0}-{Math.min(startIndex + rowsPerPage, activeSuppliersTotal.length)} {t('common.of')} {activeSuppliersTotal.length}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
              disabled={currentPage === 1}
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
            >
              <i className="fa-solid fa-chevron-left text-xs"></i>
            </button>
            <div className="flex items-center gap-1">
              {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
                <button
                  key={page}
                  onClick={() => setCurrentPage(page)}
                  className={`w-8 h-8 flex items-center justify-center rounded-lg text-xs font-bold transition-all ${currentPage === page
                    ? 'bg-praetor text-white shadow-md shadow-slate-200'
                    : 'text-slate-500 hover:bg-slate-100'
                    }`}
                >
                  {page}
                </button>
              ))}
            </div>
            <button
              onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
              disabled={currentPage === totalPages || totalPages === 0}
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
            >
              <i className="fa-solid fa-chevron-right text-xs"></i>
            </button>
          </div>
        </div>
      </div>

      {disabledSuppliers.length > 0 && (
        <div className="bg-slate-50 rounded-3xl border border-slate-200 shadow-sm overflow-hidden border-dashed">
          <div className="px-8 py-4 bg-slate-100/50 border-b border-slate-200 flex justify-between items-center">
            <h4 className="font-black text-slate-400 uppercase text-[10px] tracking-widest">{t('common.disabled')}</h4>
            <span className="bg-slate-200 text-slate-500 px-3 py-1 rounded-full text-[10px] font-black">{disabledSuppliers.length} {disabledSuppliers.length === 1 ? t('common.disabled').toUpperCase() : t('common.disabled').toUpperCase()}</span>
          </div>
          <div className="divide-y divide-slate-100">
            {disabledSuppliers.map(s => (
              <div key={s.id} onClick={() => openEditModal(s)} className="p-6 opacity-60 grayscale hover:grayscale-0 hover:opacity-100 active:bg-slate-100 active:scale-[0.98] transition-all flex items-center justify-between gap-4 cursor-pointer select-none">
                <div className="flex gap-4 items-center">
                  <div className="w-10 h-10 bg-slate-200 text-slate-400 rounded-xl flex items-center justify-center">
                    <i className="fa-solid fa-industry"></i>
                  </div>
                  <div>
                    <h5 className="font-bold text-slate-500 line-through">{s.name}</h5>
                    <span className="text-[10px] font-black text-amber-500 uppercase">{t('common.disabled')}</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onUpdateSupplier(s.id, { isDisabled: false });
                    }}
                    className="p-2 text-praetor hover:bg-slate-100 rounded-lg transition-colors"
                  >
                    <i className="fa-solid fa-rotate-left"></i>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      confirmDelete(s);
                    }}
                    className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                  >
                    <i className="fa-solid fa-trash-can"></i>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default SuppliersView;
