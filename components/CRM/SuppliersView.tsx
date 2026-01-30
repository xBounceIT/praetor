import React, { useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Supplier } from '../../types';
import StandardTable, { Column } from '../StandardTable';
import StatusBadge from '../StatusBadge';
import Modal from '../Modal';

interface SuppliersViewProps {
  suppliers: Supplier[];
  onAddSupplier: (supplierData: Partial<Supplier>) => Promise<void>;
  onUpdateSupplier: (id: string, updates: Partial<Supplier>) => Promise<void>;
  onDeleteSupplier: (id: string) => Promise<void>;
  userRole: 'admin' | 'manager' | 'user';
}

const SuppliersView: React.FC<SuppliersViewProps> = ({
  suppliers,
  onAddSupplier,
  onUpdateSupplier,
  onDeleteSupplier,
  userRole,
}) => {
  const { t } = useTranslation(['crm', 'common']);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [supplierToDelete, setSupplierToDelete] = useState<Supplier | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Form State
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
    notes: '',
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
      notes: '',
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
      notes: supplier.notes || '',
    });
    setErrors({});
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validation
    const trimmedName = formData.name?.trim() || '';
    const trimmedSupplierCode = formData.supplierCode?.trim() || '';
    const newErrors: Record<string, string> = {};

    if (!trimmedName) {
      newErrors.name = t('common:validation.nameRequired');
    }
    if (!trimmedSupplierCode) {
      newErrors.supplierCode = t('crm:suppliers.codeRequired');
    } else if (!/^[a-zA-Z0-9_-]+$/.test(trimmedSupplierCode)) {
      newErrors.supplierCode = t('crm:suppliers.codeInvalid');
    } else {
      const isDuplicate = suppliers.some(
        (s) =>
          (s.supplierCode || '').toLowerCase() === trimmedSupplierCode.toLowerCase() &&
          (!editingSupplier || s.id !== editingSupplier.id),
      );
      if (isDuplicate) {
        newErrors.supplierCode = t('crm:suppliers.codeUnique');
      }
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    const payload = {
      ...formData,
      name: trimmedName,
      supplierCode: trimmedSupplierCode,
    };

    try {
      if (editingSupplier) {
        await onUpdateSupplier(editingSupplier.id, payload);
      } else {
        await onAddSupplier(payload);
      }
      setIsModalOpen(false);
    } catch (err) {
      const message = (err as Error).message;
      if (message.toLowerCase().includes('supplier code')) {
        setErrors({ ...newErrors, supplierCode: t('crm:suppliers.codeUnique') });
      } else {
        setErrors({ ...newErrors, general: message });
      }
    }
  };

  const confirmDelete = useCallback((supplier: Supplier) => {
    setSupplierToDelete(supplier);
    setIsDeleteConfirmOpen(true);
  }, []);

  const handleDelete = () => {
    if (supplierToDelete) {
      onDeleteSupplier(supplierToDelete.id).then(() => {
        setIsDeleteConfirmOpen(false);
        setSupplierToDelete(null);
      });
    }
  };

  // Column definitions
  const columns = useMemo<Column<Supplier>[]>(
    () => [
      {
        header: t('crm:suppliers.tableHeaders.name'),
        accessorKey: 'name',
        cell: ({ row }) => (
          <span
            className={`font-semibold ${row.isDisabled ? 'line-through text-slate-400' : 'text-slate-800'}`}
          >
            {row.name}
          </span>
        ),
      },
      {
        header: t('crm:suppliers.tableHeaders.code'),
        accessorKey: 'supplierCode',
        cell: ({ row }) =>
          row.supplierCode ? (
            <span className="text-[10px] font-black bg-slate-100 text-slate-500 px-2 py-0.5 rounded uppercase">
              {row.supplierCode}
            </span>
          ) : null,
      },
      {
        header: t('crm:suppliers.tableHeaders.contact'),
        id: 'contact',
        accessorFn: (row) => row.contactName || row.email || row.phone || '',
        cell: ({ row }) => (
          <div className="flex flex-col gap-1">
            {row.contactName && <span className="text-xs text-slate-600">{row.contactName}</span>}
            {row.email && (
              <span className="text-xs text-slate-500 flex items-center gap-1.5">
                <i className="fa-solid fa-envelope text-[10px] text-slate-300"></i>
                {row.email}
              </span>
            )}
            {row.phone && (
              <span className="text-xs text-slate-500 flex items-center gap-1.5">
                <i className="fa-solid fa-phone text-[10px] text-slate-300"></i>
                {row.phone}
              </span>
            )}
          </div>
        ),
      },
      {
        header: t('crm:suppliers.tableHeaders.vat'),
        accessorKey: 'vatNumber',
        className: 'font-mono text-xs text-slate-400',
      },
      {
        header: t('crm:suppliers.tableHeaders.taxCode'),
        accessorKey: 'taxCode',
        className: 'font-mono text-xs text-slate-400',
      },
      {
        header: t('crm:suppliers.tableHeaders.status'),
        id: 'status',
        accessorFn: (row) =>
          row.isDisabled ? t('common:common.disabled') : t('common:common.active'),
        cell: ({ row }) => (
          <StatusBadge
            type={row.isDisabled ? 'disabled' : 'active'}
            label={row.isDisabled ? t('common:common.disabled') : t('common:common.active')}
          />
        ),
      },
      {
        header: t('common:labels.actions'),
        id: 'actions',
        align: 'right',
        disableSorting: true,
        disableFiltering: true,
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-1">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onUpdateSupplier(row.id, { isDisabled: !row.isDisabled });
              }}
              className={`p-2 rounded-lg transition-all ${
                row.isDisabled
                  ? 'text-praetor hover:bg-slate-100'
                  : 'text-slate-400 hover:text-amber-600 hover:bg-amber-50'
              }`}
              title={row.isDisabled ? t('common:buttons.enable') : t('crm:suppliers.disable')}
            >
              <i className={`fa-solid ${row.isDisabled ? 'fa-rotate-left' : 'fa-ban'}`}></i>
            </button>
            {userRole === 'admin' && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  confirmDelete(row);
                }}
                className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                title={t('common:buttons.delete')}
              >
                <i className="fa-solid fa-trash-can"></i>
              </button>
            )}
          </div>
        ),
      },
    ],
    [t, userRole, onUpdateSupplier, confirmDelete],
  );

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Add/Edit Modal */}
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden animate-in zoom-in duration-200 flex flex-col max-h-[90vh]">
          <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
            <h3 className="text-xl font-black text-slate-800 flex items-center gap-3">
              <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center text-praetor">
                <i className={`fa-solid ${editingSupplier ? 'fa-pen-to-square' : 'fa-plus'}`}></i>
              </div>
              {editingSupplier ? t('crm:suppliers.editSupplier') : t('crm:suppliers.addSupplier')}
            </h3>
            <button
              onClick={() => setIsModalOpen(false)}
              className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-slate-100 text-slate-400 transition-colors"
            >
              <i className="fa-solid fa-xmark text-lg"></i>
            </button>
          </div>

          <form onSubmit={handleSubmit} className="overflow-y-auto p-8 space-y-8" noValidate>
            {/* Section 1: Supplier Details */}
            <div className="space-y-4">
              <h4 className="text-xs font-black text-praetor uppercase tracking-widest flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-praetor"></span>
                {t('crm:suppliers.identifyingData')}
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 ml-1">
                    {t('crm:suppliers.code')}
                  </label>
                  <input
                    type="text"
                    value={formData.supplierCode}
                    onChange={(e) => {
                      setFormData({ ...formData, supplierCode: e.target.value });
                      if (errors.supplierCode) setErrors({ ...errors, supplierCode: '' });
                    }}
                    placeholder={t('crm:suppliers.codePlaceholder')}
                    className={`w-full text-sm px-4 py-2.5 bg-slate-50 border rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all ${
                      errors.supplierCode ? 'border-red-500 bg-red-50' : 'border-slate-200'
                    }`}
                  />
                  {errors.supplierCode && (
                    <p className="text-red-500 text-[10px] font-bold ml-1">{errors.supplierCode}</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 ml-1">
                    {t('crm:suppliers.name')}
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => {
                      setFormData({ ...formData, name: e.target.value });
                      if (errors.name) setErrors({ ...errors, name: '' });
                    }}
                    placeholder={t('crm:suppliers.namePlaceholder')}
                    className={`w-full text-sm px-4 py-2.5 bg-slate-50 border rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all ${
                      errors.name ? 'border-red-500 bg-red-50' : 'border-slate-200'
                    }`}
                  />
                  {errors.name && (
                    <p className="text-red-500 text-[10px] font-bold ml-1">{errors.name}</p>
                  )}
                </div>
                <div className="col-span-full space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 ml-1">
                    {t('crm:suppliers.contactName')}
                  </label>
                  <input
                    type="text"
                    value={formData.contactName}
                    onChange={(e) => setFormData({ ...formData, contactName: e.target.value })}
                    placeholder={t('crm:suppliers.contactPlaceholder')}
                    className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all"
                  />
                </div>
              </div>
            </div>

            {/* Section 2: Contacts */}
            <div className="space-y-4">
              <h4 className="text-xs font-black text-praetor uppercase tracking-widest flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-praetor"></span>
                {t('crm:suppliers.contacts')}
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 ml-1">
                    {t('crm:suppliers.email')}
                  </label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    placeholder={t('crm:suppliers.emailPlaceholder')}
                    className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 ml-1">
                    {t('crm:suppliers.phone')}
                  </label>
                  <input
                    type="text"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    placeholder={t('crm:suppliers.phonePlaceholder')}
                    className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all"
                  />
                </div>
                <div className="col-span-full space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 ml-1">
                    {t('crm:suppliers.address')}
                  </label>
                  <textarea
                    rows={2}
                    value={formData.address}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                    placeholder={t('crm:suppliers.addressPlaceholder')}
                    className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all resize-none"
                  />
                </div>
              </div>
            </div>

            {/* Section 3: Administrative */}
            <div className="space-y-4">
              <h4 className="text-xs font-black text-praetor uppercase tracking-widest flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-praetor"></span>
                {t('crm:suppliers.adminFiscal')}
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 ml-1">
                    {t('crm:suppliers.vatNumber')}
                  </label>
                  <input
                    type="text"
                    value={formData.vatNumber}
                    onChange={(e) => setFormData({ ...formData, vatNumber: e.target.value })}
                    placeholder={t('crm:suppliers.vatPlaceholder')}
                    className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 ml-1">
                    {t('crm:suppliers.taxCode')}
                  </label>
                  <input
                    type="text"
                    value={formData.taxCode}
                    onChange={(e) => setFormData({ ...formData, taxCode: e.target.value })}
                    placeholder={t('crm:suppliers.taxCodePlaceholder')}
                    className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 ml-1">
                    {t('crm:suppliers.paymentTerms')}
                  </label>
                  <input
                    type="text"
                    value={formData.paymentTerms}
                    onChange={(e) => setFormData({ ...formData, paymentTerms: e.target.value })}
                    placeholder={t('crm:suppliers.paymentTermsPlaceholder')}
                    className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 ml-1">
                    {t('crm:suppliers.notes')}
                  </label>
                  <input
                    type="text"
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    placeholder={t('crm:suppliers.notesPlaceholder')}
                    className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all"
                  />
                </div>
              </div>
            </div>

            {errors.general && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-xl flex items-center gap-3 text-red-600">
                <i className="fa-solid fa-circle-exclamation text-lg"></i>
                <p className="text-sm font-bold">{errors.general}</p>
              </div>
            )}

            <div className="flex justify-between items-center pt-4 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="px-8 py-3 text-sm font-bold text-slate-500 hover:bg-slate-50 rounded-xl transition-colors border border-slate-200"
              >
                {t('common:buttons.cancel')}
              </button>
              <button
                type="submit"
                className="px-10 py-3 bg-praetor text-white text-sm font-bold rounded-xl shadow-lg shadow-slate-200 hover:bg-slate-700 transition-all active:scale-95"
              >
                {editingSupplier ? t('common:buttons.update') : t('common:buttons.save')}
              </button>
            </div>
          </form>
        </div>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal isOpen={isDeleteConfirmOpen} onClose={() => setIsDeleteConfirmOpen(false)}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in duration-200">
          <div className="p-6 text-center space-y-4">
            <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto text-red-600">
              <i className="fa-solid fa-triangle-exclamation text-xl"></i>
            </div>
            <div>
              <h3 className="text-lg font-black text-slate-800">
                {t('crm:suppliers.deleteSupplier')}
              </h3>
              <p className="text-sm text-slate-500 mt-2 leading-relaxed">
                {t('common:messages.deleteConfirmNamed', { name: supplierToDelete?.name })}
                {t('crm:suppliers.deleteConfirm')}
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
                onClick={handleDelete}
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
            <h2 className="text-2xl font-black text-slate-800">{t('crm:suppliers.title')}</h2>
            <p className="text-slate-500 text-sm">{t('crm:suppliers.subtitle')}</p>
          </div>
          <button
            onClick={openAddModal}
            className="bg-praetor text-white px-5 py-2.5 rounded-xl text-sm font-black shadow-xl shadow-slate-200 transition-all hover:bg-slate-700 active:scale-95 flex items-center gap-2"
          >
            <i className="fa-solid fa-plus"></i> {t('crm:suppliers.addSupplier')}
          </button>
        </div>
      </div>

      <StandardTable<Supplier>
        title={t('crm:suppliers.suppliersDirectory')}
        data={suppliers}
        columns={columns}
        defaultRowsPerPage={10}
        onRowClick={openEditModal}
        rowClassName={(row) => (row.isDisabled ? 'opacity-70 grayscale hover:grayscale-0' : '')}
      />
    </div>
  );
};

export default SuppliersView;
