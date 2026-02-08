import type React from 'react';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Client } from '../../types';
import { buildPermission, hasPermission } from '../../utils/permissions';
import Modal from '../shared/Modal';
import StandardTable, { type Column } from '../shared/StandardTable';
import StatusBadge from '../shared/StatusBadge';
import Tooltip from '../shared/Tooltip';

export interface ClientsViewProps {
  clients: Client[];
  onAddClient: (clientData: Partial<Client>) => Promise<void>;
  onUpdateClient: (id: string, updates: Partial<Client>) => Promise<void>;
  onDeleteClient: (id: string) => Promise<void>;
  permissions: string[];
}

const ClientsView: React.FC<ClientsViewProps> = ({
  clients,
  onAddClient,
  onUpdateClient,
  onDeleteClient,
  permissions,
}) => {
  const { t } = useTranslation(['crm', 'common', 'form']);
  const canCreateClients = hasPermission(permissions, buildPermission('crm.clients', 'create'));
  const canUpdateClients = hasPermission(permissions, buildPermission('crm.clients', 'update'));
  const canDeleteClients = hasPermission(permissions, buildPermission('crm.clients', 'delete'));
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [clientToDelete, setClientToDelete] = useState<Client | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

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
    if (!canCreateClients) return;
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
    if (!canUpdateClients) return;
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

    if (editingClient && !canUpdateClients) return;
    if (!editingClient && !canCreateClients) return;

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

  const confirmDelete = useCallback((client: Client) => {
    setClientToDelete(client);
    setIsDeleteConfirmOpen(true);
  }, []);

  const handleDelete = () => {
    if (!canDeleteClients) return;
    if (clientToDelete) {
      onDeleteClient(clientToDelete.id).then(() => {
        setIsDeleteConfirmOpen(false);
        setClientToDelete(null);
      });
    }
  };

  const canSubmit = editingClient ? canUpdateClients : canCreateClients;

  // Column definitions
  const columns = useMemo<Column<Client>[]>(
    () => [
      {
        header: t('crm:clients.tableHeaders.name'),
        accessorKey: 'name',
        cell: ({ row }) => (
          <span
            className={`font-semibold whitespace-nowrap ${row.isDisabled ? 'line-through text-slate-400' : 'text-slate-800'}`}
          >
            {row.name}
          </span>
        ),
      },
      {
        header: t('crm:clients.tableHeaders.clientCode'),
        accessorKey: 'clientCode',
        cell: ({ row }) =>
          row.clientCode ? (
            <span className="text-[10px] font-black bg-slate-100 text-slate-500 px-2 py-0.5 rounded uppercase">
              {row.clientCode}
            </span>
          ) : null,
      },
      {
        header: t('crm:clients.tableHeaders.type'),
        id: 'type',
        accessorFn: (row) =>
          row.type === 'company' ? t('crm:clients.typeCompany') : t('crm:clients.typeIndividual'),
      },
      {
        header: t('crm:clients.tableHeaders.email'),
        accessorKey: 'email',
        cell: ({ row }) => <span className="text-xs text-slate-500">{row.email || '-'}</span>,
      },
      {
        header: t('crm:clients.tableHeaders.phone'),
        accessorKey: 'phone',
        cell: ({ row }) => (
          <span className="text-xs text-slate-500 whitespace-nowrap">{row.phone || '-'}</span>
        ),
      },
      {
        header: t('crm:clients.tableHeaders.vat'),
        accessorKey: 'vatNumber',
        className: 'font-mono text-xs text-slate-400',
      },
      {
        header: t('crm:clients.tableHeaders.taxCode'),
        accessorKey: 'taxCode',
        className: 'font-mono text-xs text-slate-400 pr-8',
      },
      {
        header: t('crm:clients.tableHeaders.billingCode'),
        accessorKey: 'billingCode',
        className: 'font-mono text-xs text-slate-400',
      },
      {
        header: t('crm:clients.tableHeaders.status'),
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
            <Tooltip
              label={row.isDisabled ? t('common:buttons.enable') : t('crm:clients.isDisabled')}
            >
              {() => (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!canUpdateClients) return;
                    onUpdateClient(row.id, { isDisabled: !row.isDisabled });
                  }}
                  disabled={!canUpdateClients}
                  className={`p-2 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                    row.isDisabled
                      ? 'text-praetor hover:bg-slate-100'
                      : 'text-slate-400 hover:text-amber-600 hover:bg-amber-50'
                  }`}
                >
                  <i className={`fa-solid ${row.isDisabled ? 'fa-rotate-left' : 'fa-ban'}`}></i>
                </button>
              )}
            </Tooltip>
            {canDeleteClients && (
              <Tooltip label={t('common:buttons.delete')}>
                {() => (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      confirmDelete(row);
                    }}
                    className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                  >
                    <i className="fa-solid fa-trash-can"></i>
                  </button>
                )}
              </Tooltip>
            )}
          </div>
        ),
      },
    ],
    [t, canUpdateClients, canDeleteClients, onUpdateClient, confirmDelete],
  );

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Add/Edit Modal */}
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)}>
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
                disabled={!canSubmit}
                className={`px-10 py-3 text-white text-sm font-bold rounded-xl shadow-lg transition-all active:scale-95 ${
                  canSubmit
                    ? 'bg-praetor shadow-slate-200 hover:bg-slate-700'
                    : 'bg-slate-300 shadow-none cursor-not-allowed'
                }`}
              >
                {editingClient ? t('common:buttons.update') : t('common:buttons.save')}
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
              <h3 className="text-lg font-black text-slate-800">{t('crm:clients.deleteClient')}</h3>
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
      </Modal>

      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h2 className="text-2xl font-black text-slate-800">{t('crm:clients.title')}</h2>
            <p className="text-slate-500 text-sm">{t('crm:clients.subtitle')}</p>
          </div>
          {canCreateClients && (
            <button
              onClick={openAddModal}
              className="bg-praetor text-white px-5 py-2.5 rounded-xl text-sm font-black shadow-xl shadow-slate-200 transition-all hover:bg-slate-700 active:scale-95 flex items-center gap-2"
            >
              <i className="fa-solid fa-plus"></i> {t('crm:clients.addClient')}
            </button>
          )}
        </div>
      </div>

      <StandardTable<Client>
        title={t('crm:clients.clientsDirectory')}
        data={clients}
        columns={columns}
        defaultRowsPerPage={10}
        onRowClick={canUpdateClients ? openEditModal : undefined}
        rowClassName={(row) => (row.isDisabled ? 'opacity-70 grayscale hover:grayscale-0' : '')}
      />
    </div>
  );
};

export default ClientsView;
