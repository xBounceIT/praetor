import React, { useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Client } from '../types';
import CustomSelect from './CustomSelect';
import StandardTable from './StandardTable';
import StatusBadge from './StatusBadge';
import TableFilter from './TableFilter';

interface ClientsViewProps {
  clients: Client[];
  onAddClient: (clientData: Partial<Client>) => Promise<void>;
  onUpdateClient: (id: string, updates: Partial<Client>) => Promise<void>;
  onDeleteClient: (id: string) => Promise<void>;
  userRole: 'admin' | 'manager' | 'user';
}

const ClientsView: React.FC<ClientsViewProps> = ({
  clients,
  onAddClient,
  onUpdateClient,
  onDeleteClient,
  userRole,
}) => {
  const { t } = useTranslation(['crm', 'common', 'form']);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [clientToDelete, setClientToDelete] = useState<Client | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(() => {
    const saved = localStorage.getItem('praetor_clients_rowsPerPage');
    return saved ? parseInt(saved, 10) : 10;
  });

  // Filter & Sort State
  const [filters, setFilters] = useState<Record<string, string[]>>({});
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' | null }>({
    key: '',
    direction: null,
  });
  const [activeFilter, setActiveFilter] = useState<string | null>(null);

  const handleRowsPerPageChange = (val: string) => {
    const value = parseInt(val, 10);
    setRowsPerPage(value);
    localStorage.setItem('praetor_clients_rowsPerPage', value.toString());
    setCurrentPage(1);
  };

  const handleFilterChange = useCallback((columnKey: string, selectedValues: string[]) => {
    setFilters((prev) => ({ ...prev, [columnKey]: selectedValues }));
    setCurrentPage(1);
  }, []);

  const handleSortChange = useCallback((columnKey: string, direction: 'asc' | 'desc' | null) => {
    setSortConfig({ key: columnKey, direction });
  }, []);

  const toggleFilter = useCallback((columnKey: string) => {
    setActiveFilter((prev) => (prev === columnKey ? null : columnKey));
  }, []);

  // Form State
  const [formData, setFormData] = useState<Partial<Client>>({
    name: '',
    type: 'company',
    contactName: '',
    clientCode: '',
    email: '',
    phone: '',
    address: '',
    vatNumber: '',
    taxCode: '',
    billingCode: '',
  });

  const openAddModal = () => {
    setEditingClient(null);
    setFormData({
      name: '',
      type: 'company',
      contactName: '',
      clientCode: '',
      email: '',
      phone: '',
      address: '',
      vatNumber: '',
      taxCode: '',
      billingCode: '',
    });
    setErrors({});
    setIsModalOpen(true);
  };

  const openEditModal = (client: Client) => {
    setEditingClient(client);
    setFormData({
      name: client.name || '',
      type: client.type || 'company',
      contactName: client.contactName || '',
      clientCode: client.clientCode || '',
      email: client.email || '',
      phone: client.phone || '',
      address: client.address || '',
      vatNumber: client.vatNumber || '',
      taxCode: client.taxCode || '',
      billingCode: client.billingCode || '',
    });
    setErrors({});
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validation
    const trimmedName = formData.name?.trim() || '';
    const trimmedClientCode = formData.clientCode?.trim() || '';
    const trimmedVatNumber = formData.vatNumber?.trim() || '';
    const trimmedTaxCode = formData.taxCode?.trim() || '';
    const newErrors: Record<string, string> = {};
    if (!trimmedName) {
      newErrors.name = t('common:validation.nameRequired');
    }
    if (!trimmedClientCode) {
      newErrors.clientCode = t('common:validation.clientCodeRequired');
    } else if (!/^[a-zA-Z0-9_-]+$/.test(trimmedClientCode)) {
      newErrors.clientCode = t('common:validation.clientCodeInvalid');
    } else {
      const isDuplicate = clients.some(
        (c) =>
          (c.clientCode || '').toLowerCase() === trimmedClientCode.toLowerCase() &&
          (!editingClient || c.id !== editingClient.id),
      );
      if (isDuplicate) {
        newErrors.clientCode = t('common:validation.clientCodeUnique');
      }
    }
    if (!trimmedVatNumber && !trimmedTaxCode) {
      const msg = t('common:validation.vatOrTaxRequired');
      newErrors.vatNumber = msg;
      newErrors.taxCode = msg;
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    const payload = {
      ...formData,
      name: trimmedName,
      clientCode: trimmedClientCode,
      vatNumber: trimmedVatNumber,
      taxCode: trimmedTaxCode,
    };

    try {
      if (editingClient) {
        await onUpdateClient(editingClient.id, payload);
      } else {
        await onAddClient(payload);
      }
      setIsModalOpen(false);
    } catch (err) {
      const message = (err as Error).message;
      if (message.toLowerCase().includes('vat number')) {
        setErrors({ ...newErrors, vatNumber: message });
      } else if (
        message.toLowerCase().includes('client id') ||
        message.toLowerCase().includes('client code')
      ) {
        setErrors({ ...newErrors, clientCode: t('common:validation.clientCodeUnique') });
      } else {
        setErrors({ ...newErrors, general: message });
      }
    }
  };

  const confirmDelete = (client: Client) => {
    setClientToDelete(client);
    setIsDeleteConfirmOpen(true);
  };

  const handleDelete = () => {
    if (clientToDelete) {
      onDeleteClient(clientToDelete.id).then(() => {
        setIsDeleteConfirmOpen(false);
        setClientToDelete(null);
      });
    }
  };

  // Column definitions
  const columns = useMemo(
    () => [
      { key: 'name', label: t('crm:clients.tableHeaders.name') },
      { key: 'clientCode', label: t('crm:clients.tableHeaders.clientCode') },
      { key: 'type', label: t('crm:clients.tableHeaders.type') },
      { key: 'email', label: t('crm:clients.tableHeaders.email') },
      { key: 'phone', label: t('crm:clients.tableHeaders.phone') },
      { key: 'vatNumber', label: t('crm:clients.tableHeaders.vat') },
      { key: 'taxCode', label: t('crm:clients.tableHeaders.taxCode') },
      { key: 'billingCode', label: t('crm:clients.tableHeaders.billingCode') },
      { key: 'status', label: t('crm:clients.tableHeaders.status') },
    ],
    [t],
  );

  // Get unique options for a column (for TableFilter)
  const getUniqueOptions = useCallback(
    (columnKey: string) => {
      if (columnKey === 'status') {
        return [t('common:labels.active'), t('common:labels.disabled')];
      }
      if (columnKey === 'type') {
        return [t('crm:clients.typeCompany'), t('crm:clients.typeIndividual')];
      }
      const values = clients.map((c) => {
        const val = c[columnKey as keyof Client];
        return val ? String(val) : '';
      });
      return [...new Set(values)].filter(Boolean).sort();
    },
    [clients, t],
  );

  // Get display value for a cell
  const getCellValue = useCallback(
    (client: Client, columnKey: string): string => {
      if (columnKey === 'status') {
        return client.isDisabled ? t('common:labels.disabled') : t('common:labels.active');
      }
      if (columnKey === 'type') {
        return client.type === 'company'
          ? t('crm:clients.typeCompany')
          : t('crm:clients.typeIndividual');
      }
      const val = client[columnKey as keyof Client];
      return val ? String(val) : '';
    },
    [t],
  );

  // Filtered and sorted clients
  const filteredAndSortedClients = useMemo(() => {
    let result = [...clients];

    // Apply filters
    Object.entries(filters).forEach(([columnKey, selectedValues]) => {
      if (selectedValues.length > 0) {
        result = result.filter((client) => {
          const cellValue = getCellValue(client, columnKey);
          return selectedValues.includes(cellValue);
        });
      }
    });

    // Apply sort
    if (sortConfig.key && sortConfig.direction) {
      result.sort((a, b) => {
        const aVal = getCellValue(a, sortConfig.key);
        const bVal = getCellValue(b, sortConfig.key);
        const comparison = aVal.localeCompare(bVal, undefined, {
          numeric: true,
          sensitivity: 'base',
        });
        return sortConfig.direction === 'asc' ? comparison : -comparison;
      });
    }

    return result;
  }, [clients, filters, sortConfig, getCellValue]);

  // Pagination Logic
  const totalPages = Math.ceil(filteredAndSortedClients.length / rowsPerPage);
  const startIndex = (currentPage - 1) * rowsPerPage;
  const paginatedClients = filteredAndSortedClients.slice(startIndex, startIndex + rowsPerPage);

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Add/Edit Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden animate-in zoom-in duration-200 flex flex-col max-h-[90vh]">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <h3 className="text-xl font-black text-slate-800 flex items-center gap-3">
                <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center text-praetor">
                  <i className={`fa-solid ${editingClient ? 'fa-pen-to-square' : 'fa-plus'}`}></i>
                </div>
                {editingClient ? t('crm:clients.editClient') : t('crm:clients.addClient')}
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-slate-100 text-slate-400 transition-colors"
              >
                <i className="fa-solid fa-xmark text-lg"></i>
              </button>
            </div>

            <form onSubmit={handleSubmit} className="overflow-y-auto p-8 space-y-8" noValidate>
              {/* Section 1: Identification */}
              <div className="space-y-4">
                <h4 className="text-xs font-black text-praetor uppercase tracking-widest flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-praetor"></span>
                  {t('crm:clients.identifyingData')}
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 ml-1">
                      {t('crm:clients.subjectType')}
                    </label>
                    <div className="relative flex p-1 bg-slate-100 rounded-xl">
                      <div
                        className={`absolute top-1 bottom-1 w-[calc(50%-4px)] bg-white rounded-lg shadow-sm transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] ${
                          formData.type === 'company' ? 'translate-x-0' : 'translate-x-full'
                        }`}
                      ></div>
                      <button
                        type="button"
                        onClick={() => setFormData({ ...formData, type: 'company' })}
                        className={`relative z-10 flex-1 py-1.5 text-xs font-bold rounded-lg transition-all duration-300 ${formData.type === 'company' ? 'text-praetor' : 'text-slate-500 hover:text-slate-700'}`}
                      >
                        {t('crm:clients.typeCompany')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setFormData({ ...formData, type: 'individual' })}
                        className={`relative z-10 flex-1 py-1.5 text-xs font-bold rounded-lg transition-all duration-300 ${formData.type === 'individual' ? 'text-praetor' : 'text-slate-500 hover:text-slate-700'}`}
                      >
                        {t('crm:clients.typeIndividual')}
                      </button>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 ml-1">
                      {t('crm:clients.uniqueId')}
                    </label>
                    <input
                      type="text"
                      value={formData.clientCode}
                      onChange={(e) => {
                        setFormData({ ...formData, clientCode: e.target.value });
                        if (errors.clientCode) setErrors({ ...errors, clientCode: '' });
                      }}
                      placeholder={t('form:placeholderCode')}
                      className={`w-full text-sm px-4 py-2.5 bg-slate-50 border rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all ${
                        errors.clientCode ? 'border-red-500 bg-red-50' : 'border-slate-200'
                      }`}
                    />
                    {errors.clientCode && (
                      <p className="text-red-500 text-[10px] font-bold ml-1">{errors.clientCode}</p>
                    )}
                  </div>
                  <div className="col-span-full space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 ml-1">
                      {formData.type === 'company'
                        ? t('crm:clients.companyName')
                        : t('crm:clients.personName')}
                    </label>
                    <input
                      type="text"
                      value={formData.name}
                      onChange={(e) => {
                        setFormData({ ...formData, name: e.target.value });
                        if (errors.name) setErrors({ ...errors, name: '' });
                      }}
                      placeholder={
                        formData.type === 'company'
                          ? t('form:placeholderName')
                          : t('form:placeholderName')
                      }
                      className={`w-full text-sm px-4 py-2.5 bg-slate-50 border rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all ${
                        errors.name ? 'border-red-500 bg-red-50' : 'border-slate-200'
                      }`}
                    />
                    {errors.name && (
                      <p className="text-red-500 text-[10px] font-bold ml-1">{errors.name}</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Section 2: Contacts */}
              <div className="space-y-4">
                <h4 className="text-xs font-black text-praetor uppercase tracking-widest flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-praetor"></span>
                  {t('crm:clients.contacts')}
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 ml-1">
                      {t('crm:clients.primaryEmail')}
                    </label>
                    <input
                      type="email"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      placeholder={t('form:placeholderEmail')}
                      className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 ml-1">
                      {t('crm:clients.phoneLabel')}
                    </label>
                    <input
                      type="text"
                      value={formData.phone}
                      onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                      placeholder={t('form:placeholderPhone')}
                      className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all"
                    />
                  </div>
                  <div className="col-span-full space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 ml-1">
                      {t('crm:clients.contactRole')}
                    </label>
                    <input
                      type="text"
                      value={formData.contactName}
                      onChange={(e) => setFormData({ ...formData, contactName: e.target.value })}
                      placeholder={t('form:placeholderName')}
                      className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all"
                    />
                  </div>
                  <div className="col-span-full space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 ml-1">
                      {t('crm:clients.streetAddress')}
                    </label>
                    <textarea
                      rows={2}
                      value={formData.address}
                      onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                      placeholder={t('form:placeholderDescription')}
                      className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all resize-none"
                    />
                  </div>
                </div>
              </div>

              {/* Section 3: Administrative */}
              <div className="space-y-4">
                <h4 className="text-xs font-black text-praetor uppercase tracking-widest flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-praetor"></span>
                  {t('crm:clients.adminFiscal')}
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 ml-1">
                      {t('crm:clients.vatNumber')}
                    </label>
                    <input
                      type="text"
                      value={formData.vatNumber}
                      onChange={(e) => {
                        setFormData({ ...formData, vatNumber: e.target.value });
                        if (errors.vatNumber) setErrors({ ...errors, vatNumber: '', taxCode: '' });
                      }}
                      placeholder={t('form:placeholderCode')}
                      className={`w-full text-sm px-4 py-2.5 bg-slate-50 border rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all ${
                        errors.vatNumber ? 'border-red-500 bg-red-50' : 'border-slate-200'
                      }`}
                    />
                    {errors.vatNumber && (
                      <p className="text-red-500 text-[10px] font-bold ml-1">{errors.vatNumber}</p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 ml-1">
                      {t('crm:clients.taxCode')}
                    </label>
                    <input
                      type="text"
                      value={formData.taxCode}
                      onChange={(e) => {
                        setFormData({ ...formData, taxCode: e.target.value });
                        if (errors.taxCode) setErrors({ ...errors, taxCode: '', vatNumber: '' });
                      }}
                      className={`w-full text-sm px-4 py-2.5 bg-slate-50 border rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all ${
                        errors.taxCode ? 'border-red-500 bg-red-50' : 'border-slate-200'
                      }`}
                    />
                    {errors.taxCode && (
                      <p className="text-red-500 text-[10px] font-bold ml-1">{errors.taxCode}</p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 ml-1">
                      {t('crm:clients.billingCode')}
                    </label>
                    <input
                      type="text"
                      value={formData.billingCode}
                      onChange={(e) => setFormData({ ...formData, billingCode: e.target.value })}
                      placeholder={t('form:placeholderCode')}
                      className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all font-mono uppercase"
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
                  {editingClient ? t('common:buttons.update') : t('common:buttons.save')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {isDeleteConfirmOpen && (
        <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in duration-200">
            <div className="p-6 text-center space-y-4">
              <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto text-red-600">
                <i className="fa-solid fa-triangle-exclamation text-xl"></i>
              </div>
              <div>
                <h3 className="text-lg font-black text-slate-800">
                  {t('crm:clients.deleteClient')}
                </h3>
                <p className="text-sm text-slate-500 mt-2 leading-relaxed">
                  {t('common:messages.deleteConfirmNamed', { name: clientToDelete?.name })}
                  {t('crm:clients.deleteConfirm')}
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
        </div>
      )}

      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-black text-slate-800">{t('crm:clients.title')}</h2>
          <p className="text-slate-500 text-sm">{t('crm:clients.manageBusinessContacts')}</p>
        </div>
      </div>

      <StandardTable
        title={t('crm:clients.title')}
        totalCount={filteredAndSortedClients.length}
        headerAction={
          <button
            onClick={openAddModal}
            className="bg-praetor text-white px-4 py-2.5 rounded-xl text-sm font-black shadow-xl shadow-slate-200 transition-all hover:bg-slate-700 active:scale-95 flex items-center gap-2"
          >
            <i className="fa-solid fa-plus"></i> {t('crm:clients.addClient')}
          </button>
        }
        footerClassName="flex flex-col sm:flex-row justify-between items-center gap-4"
        footer={
          <>
            <div className="flex items-center gap-3">
              <span className="text-xs font-bold text-slate-500">
                {t('common:labels.rowsPerPage')}
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
                {t('common:pagination.showing', {
                  start: paginatedClients.length > 0 ? startIndex + 1 : 0,
                  end: Math.min(startIndex + rowsPerPage, filteredAndSortedClients.length),
                  total: filteredAndSortedClients.length,
                })}
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
                {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                  let page: number;
                  if (totalPages <= 5) {
                    page = i + 1;
                  } else if (currentPage <= 3) {
                    page = i + 1;
                  } else if (currentPage >= totalPages - 2) {
                    page = totalPages - 4 + i;
                  } else {
                    page = currentPage - 2 + i;
                  }
                  return (
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
                  );
                })}
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
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100">
                {columns.map((col) => {
                  const hasActiveFilter = (filters[col.key] || []).length > 0;
                  const isCurrentSort = sortConfig.key === col.key && sortConfig.direction;
                  return (
                    <th key={col.key} className="relative text-left p-3 font-bold text-slate-600">
                      <button
                        onClick={() => toggleFilter(col.key)}
                        className={`flex items-center gap-1.5 hover:text-praetor transition-colors ${
                          hasActiveFilter || isCurrentSort ? 'text-praetor' : ''
                        }`}
                      >
                        <span className="text-xs uppercase tracking-wider">{col.label}</span>
                        <i
                          className={`fa-solid fa-filter text-[10px] ${
                            hasActiveFilter ? 'text-praetor' : 'text-slate-300'
                          }`}
                        ></i>
                        {isCurrentSort && (
                          <i
                            className={`fa-solid ${
                              sortConfig.direction === 'asc' ? 'fa-arrow-up' : 'fa-arrow-down'
                            } text-[10px] text-praetor`}
                          ></i>
                        )}
                      </button>
                      {activeFilter === col.key && (
                        <div className="absolute left-0 top-full z-50 mt-1">
                          <TableFilter
                            title={col.label}
                            options={getUniqueOptions(col.key)}
                            selectedValues={filters[col.key] || []}
                            onFilterChange={(vals) => handleFilterChange(col.key, vals)}
                            sortDirection={sortConfig.key === col.key ? sortConfig.direction : null}
                            onSortChange={(dir) => handleSortChange(col.key, dir)}
                            onClose={() => setActiveFilter(null)}
                          />
                        </div>
                      )}
                    </th>
                  );
                })}
                <th className="text-right p-3 font-bold text-slate-600">
                  <span className="text-xs uppercase tracking-wider">
                    {t('common:labels.actions')}
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {paginatedClients.map((c) => (
                <tr
                  key={c.id}
                  onClick={() => openEditModal(c)}
                  className={`border-b border-slate-50 cursor-pointer transition-all hover:bg-slate-50 active:bg-slate-100 ${
                    c.isDisabled ? 'opacity-60' : ''
                  }`}
                >
                  <td className="p-3">
                    <span
                      className={`font-semibold ${c.isDisabled ? 'line-through text-slate-400' : 'text-slate-800'}`}
                    >
                      {c.name}
                    </span>
                  </td>
                  <td className="p-3">
                    {c.clientCode && (
                      <span className="text-[10px] font-black bg-slate-100 text-slate-500 px-2 py-0.5 rounded uppercase">
                        {c.clientCode}
                      </span>
                    )}
                  </td>
                  <td className="p-3 text-slate-500">
                    {c.type === 'company'
                      ? t('crm:clients.typeCompany')
                      : t('crm:clients.typeIndividual')}
                  </td>
                  <td className="p-3 text-slate-500">{c.email || '-'}</td>
                  <td className="p-3 text-slate-500">{c.phone || '-'}</td>
                  <td className="p-3 text-slate-400 font-mono text-xs">{c.vatNumber || '-'}</td>
                  <td className="p-3 text-slate-400 font-mono text-xs">{c.taxCode || '-'}</td>
                  <td className="p-3 text-slate-400 font-mono text-xs">{c.billingCode || '-'}</td>
                  <td className="p-3">
                    <StatusBadge
                      type={c.isDisabled ? 'disabled' : 'active'}
                      label={c.isDisabled ? t('common:labels.disabled') : t('common:labels.active')}
                    />
                  </td>
                  <td className="p-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onUpdateClient(c.id, { isDisabled: !c.isDisabled });
                        }}
                        className={`p-2 rounded-lg transition-all ${
                          c.isDisabled
                            ? 'text-praetor hover:bg-slate-100'
                            : 'text-slate-400 hover:text-amber-600 hover:bg-amber-50'
                        }`}
                        title={
                          c.isDisabled ? t('common:buttons.enable') : t('crm:clients.isDisabled')
                        }
                      >
                        <i className={`fa-solid ${c.isDisabled ? 'fa-rotate-left' : 'fa-ban'}`}></i>
                      </button>
                      {userRole === 'admin' && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            confirmDelete(c);
                          }}
                          className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                          title={t('common:buttons.delete')}
                        >
                          <i className="fa-solid fa-trash-can"></i>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredAndSortedClients.length === 0 && (
            <div className="p-12 text-center">
              <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto text-slate-300 mb-4">
                <i className="fa-solid fa-users text-2xl"></i>
              </div>
              <p className="text-slate-400 text-sm font-bold">{t('crm:clients.noClients')}</p>
              <button
                onClick={openAddModal}
                className="mt-4 text-praetor text-sm font-black hover:underline"
              >
                {t('crm:clients.createFirst')}
              </button>
            </div>
          )}
        </div>
      </StandardTable>
    </div>
  );
};

export default ClientsView;
