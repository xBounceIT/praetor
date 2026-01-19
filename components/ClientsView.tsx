import React, { useState } from 'react';
import { Client } from '../types';
import CustomSelect from './CustomSelect';

interface ClientsViewProps {
  clients: Client[];
  onAddClient: (clientData: Partial<Client>) => void;
  onUpdateClient: (id: string, updates: Partial<Client>) => void;
  onDeleteClient: (id: string) => void;
  userRole: 'admin' | 'manager' | 'user';
}

const ClientsView: React.FC<ClientsViewProps> = ({ clients, onAddClient, onUpdateClient, onDeleteClient, userRole }) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [clientToDelete, setClientToDelete] = useState<Client | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(() => {
    const saved = localStorage.getItem('praetor_clients_rowsPerPage');
    return saved ? parseInt(saved, 10) : 5;
  });

  const handleRowsPerPageChange = (val: string) => {
    const value = parseInt(val, 10);
    setRowsPerPage(value);
    localStorage.setItem('praetor_clients_rowsPerPage', value.toString());
    setCurrentPage(1); // Reset to first page
  };


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
    paymentTerms: '',
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
      paymentTerms: '',
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
      paymentTerms: client.paymentTerms || '',
    });
    setErrors({});
    setIsModalOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Validation
    const trimmedName = formData.name?.trim() || '';
    const trimmedClientCode = formData.clientCode?.trim() || '';
    const trimmedVatNumber = formData.vatNumber?.trim() || '';
    const trimmedTaxCode = formData.taxCode?.trim() || '';
    const newErrors: Record<string, string> = {};
    if (!trimmedName) {
      newErrors.name = 'Name is required';
    }
    if (!trimmedClientCode) {
      newErrors.clientCode = 'Client ID is required';
    }
    if (!trimmedVatNumber && !trimmedTaxCode) {
      const msg = 'Either VAT Number or Fiscal Code is required';
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
      taxCode: trimmedTaxCode
    };

    if (editingClient) {
      onUpdateClient(editingClient.id, payload);
    } else {
      onAddClient(payload);
    }
    setIsModalOpen(false);
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

  const activeClientsTotal = clients.filter(c => !c.isDisabled);
  const disabledClients = clients.filter(c => c.isDisabled);

  // Pagination Logic
  const totalPages = Math.ceil(activeClientsTotal.length / rowsPerPage);
  const startIndex = (currentPage - 1) * rowsPerPage;
  const activeClients = activeClientsTotal.slice(startIndex, startIndex + rowsPerPage);


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
                {editingClient ? 'Edit Client' : 'Add New Client'}
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
                  Dati Identificativi
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 ml-1">Tipologia Soggetto</label>
                    <div className="relative flex p-1 bg-slate-100 rounded-xl">
                      <div
                        className={`absolute top-1 bottom-1 w-[calc(50%-4px)] bg-white rounded-lg shadow-sm transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] ${formData.type === 'company' ? 'translate-x-0' : 'translate-x-full'
                          }`}
                      ></div>
                      <button
                        type="button"
                        onClick={() => setFormData({ ...formData, type: 'company' })}
                        className={`relative z-10 flex-1 py-1.5 text-xs font-bold rounded-lg transition-all duration-300 ${formData.type === 'company' ? 'text-praetor' : 'text-slate-500 hover:text-slate-700'}`}
                      >
                        Azienda
                      </button>
                      <button
                        type="button"
                        onClick={() => setFormData({ ...formData, type: 'individual' })}
                        className={`relative z-10 flex-1 py-1.5 text-xs font-bold rounded-lg transition-all duration-300 ${formData.type === 'individual' ? 'text-praetor' : 'text-slate-500 hover:text-slate-700'}`}
                      >
                        Persona Fisica
                      </button>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 ml-1">Codice Cliente (ID Univoco)</label>
                    <input
                      type="text"
                      value={formData.clientCode}
                      onChange={(e) => {
                        setFormData({ ...formData, clientCode: e.target.value });
                        if (errors.clientCode) setErrors({ ...errors, clientCode: '' });
                      }}
                      placeholder="es. CL-001"
                      className={`w-full text-sm px-4 py-2.5 bg-slate-50 border rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all ${errors.clientCode ? 'border-red-500 bg-red-50' : 'border-slate-200'
                        }`}
                    />
                    {errors.clientCode && (
                      <p className="text-red-500 text-[10px] font-bold ml-1">{errors.clientCode}</p>
                    )}
                  </div>
                  <div className="col-span-full space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 ml-1">
                      {formData.type === 'company' ? 'Ragione Sociale' : 'Nome e Cognome'}
                    </label>
                    <input
                      type="text"
                      value={formData.name}
                      onChange={(e) => {
                        setFormData({ ...formData, name: e.target.value });
                        if (errors.name) setErrors({ ...errors, name: '' });
                      }}
                      placeholder={formData.type === 'company' ? 'es. Acme Corp S.r.l.' : 'es. Mario Rossi'}
                      className={`w-full text-sm px-4 py-2.5 bg-slate-50 border rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all ${errors.name ? 'border-red-500 bg-red-50' : 'border-slate-200'
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
                  Contatti e Indirizzi
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 ml-1">Email Principale</label>
                    <input
                      type="email"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      placeholder="email@esempio.com"
                      className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 ml-1">Telefono</label>
                    <input
                      type="text"
                      value={formData.phone}
                      onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                      placeholder="+39 000 0000000"
                      className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all"
                    />
                  </div>
                  <div className="col-span-full space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 ml-1">Referente / Ruolo</label>
                    <input
                      type="text"
                      value={formData.contactName}
                      onChange={(e) => setFormData({ ...formData, contactName: e.target.value })}
                      placeholder="es. Marco Bianchi (Ufficio Acquisti)"
                      className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all"
                    />
                  </div>
                  <div className="col-span-full space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 ml-1">Indirizzo (Sede Legale/Operativa)</label>
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

              {/* Section 3: Administrative */}
              <div className="space-y-4">
                <h4 className="text-xs font-black text-praetor uppercase tracking-widest flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-praetor"></span>
                  Dati Amministrativi e Fiscali
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 ml-1">Partita IVA</label>
                    <input
                      type="text"
                      value={formData.vatNumber}
                      onChange={(e) => {
                        setFormData({ ...formData, vatNumber: e.target.value });
                        if (errors.vatNumber) setErrors({ ...errors, vatNumber: '', taxCode: '' });
                      }}
                      placeholder="IT01234567890"
                      className={`w-full text-sm px-4 py-2.5 bg-slate-50 border rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all ${errors.vatNumber ? 'border-red-500 bg-red-50' : 'border-slate-200'
                        }`}
                    />
                    {errors.vatNumber && (
                      <p className="text-red-500 text-[10px] font-bold ml-1">{errors.vatNumber}</p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 ml-1">Codice Fiscale</label>
                    <input
                      type="text"
                      value={formData.taxCode}
                      onChange={(e) => {
                        setFormData({ ...formData, taxCode: e.target.value });
                        if (errors.taxCode) setErrors({ ...errors, taxCode: '', vatNumber: '' });
                      }}
                      className={`w-full text-sm px-4 py-2.5 bg-slate-50 border rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all ${errors.taxCode ? 'border-red-500 bg-red-50' : 'border-slate-200'
                        }`}
                    />
                    {errors.taxCode && (
                      <p className="text-red-500 text-[10px] font-bold ml-1">{errors.taxCode}</p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 ml-1">Codice Destinatario / SDI</label>
                    <input
                      type="text"
                      value={formData.billingCode}
                      onChange={(e) => setFormData({ ...formData, billingCode: e.target.value })}
                      placeholder="es. KRRH6B9"
                      className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all font-mono uppercase"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 ml-1">Condizioni Commerciali / Pagamento</label>
                    <input
                      type="text"
                      value={formData.paymentTerms}
                      onChange={(e) => setFormData({ ...formData, paymentTerms: e.target.value })}
                      placeholder="es. 30 gg D.F.F.M."
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
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-10 py-3 bg-praetor text-white text-sm font-bold rounded-xl shadow-lg shadow-slate-200 hover:bg-slate-700 transition-all active:scale-95"
                >
                  {editingClient ? 'Update Client' : 'Save Client'}
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
                <h3 className="text-lg font-black text-slate-800">Delete Client?</h3>
                <p className="text-sm text-slate-500 mt-2 leading-relaxed">
                  Are you sure you want to delete <span className="font-bold text-slate-800">{clientToDelete?.name}</span>?
                  This action cannot be undone and will delete all associated projects and tasks.
                </p>
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setIsDeleteConfirmOpen(false)}
                  className="flex-1 py-3 text-sm font-bold text-slate-500 hover:bg-slate-50 rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDelete}
                  className="flex-1 py-3 bg-red-600 text-white text-sm font-bold rounded-xl shadow-lg shadow-red-200 hover:bg-red-700 transition-all active:scale-95"
                >
                  Yes, Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-black text-slate-800">Clients</h2>
          <p className="text-slate-500 text-sm">Manage your business contacts and billing info</p>
        </div>
        <button
          onClick={openAddModal}
          className="bg-praetor text-white px-6 py-3 rounded-2xl font-black shadow-xl shadow-slate-200 transition-all hover:bg-slate-700 active:scale-95 flex items-center gap-2"
        >
          <i className="fa-solid fa-plus"></i> Add New Client
        </button>
      </div>

      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm">
        <div className="px-8 py-5 bg-slate-50 border-b border-slate-200 flex justify-between items-center rounded-t-3xl">
          <h4 className="font-black text-slate-400 uppercase text-[10px] tracking-widest">Active Clients</h4>
          <span className="bg-slate-100 text-praetor px-3 py-1 rounded-full text-[10px] font-black">{activeClientsTotal.length} TOTAL</span>
        </div>
        <div className="divide-y divide-slate-100">
          {activeClients.map(c => (
            <div key={c.id} onClick={() => openEditModal(c)} className="p-6 hover:bg-slate-50/50 active:bg-slate-100 active:scale-[0.98] transition-all group cursor-pointer select-none">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex gap-4 items-start">
                  <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-lg shadow-sm ${c.type === 'individual' ? 'bg-amber-100 text-amber-600' : 'bg-slate-100 text-praetor'}`}>
                    <i className={`fa-solid ${c.type === 'individual' ? 'fa-user' : 'fa-building'}`}></i>
                  </div>
                  <div>
                    <div className="flex items-center gap-3">
                      <h4 className="font-bold text-slate-800 leading-tight">{c.name}</h4>
                      {c.clientCode && (
                        <span className="text-[10px] font-black bg-slate-100 text-slate-500 px-2 py-0.5 rounded uppercase">{c.clientCode}</span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
                      {c.email && (
                        <span className="text-xs text-slate-500 flex items-center gap-1.5">
                          <i className="fa-solid fa-envelope text-[10px] text-slate-300"></i> {c.email}
                        </span>
                      )}
                      {c.phone && (
                        <span className="text-xs text-slate-500 flex items-center gap-1.5">
                          <i className="fa-solid fa-phone text-[10px] text-slate-300"></i> {c.phone}
                        </span>
                      )}
                      {c.vatNumber && (
                        <span className="text-xs text-slate-400 font-mono tracking-tighter">VAT: {c.vatNumber}</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      openEditModal(c);
                    }}
                    className="p-2.5 text-slate-400 hover:text-praetor hover:bg-slate-100 rounded-xl transition-all"
                    title="Edit Client"
                  >
                    <i className="fa-solid fa-pen-to-square"></i>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onUpdateClient(c.id, { isDisabled: true });
                    }}
                    className="p-2.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-xl transition-all"
                    title="Disable Client"
                  >
                    <i className="fa-solid fa-ban"></i>
                  </button>
                  {userRole === 'admin' && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        confirmDelete(c);
                      }}
                      className="p-2.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all"
                      title="Delete Client"
                    >
                      <i className="fa-solid fa-trash-can"></i>
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
          {activeClientsTotal.length === 0 && (
            <div className="p-12 text-center">
              <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto text-slate-300 mb-4">
                <i className="fa-solid fa-users text-2xl"></i>
              </div>
              <p className="text-slate-400 text-sm font-bold">No active clients found.</p>
              <button onClick={openAddModal} className="mt-4 text-praetor text-sm font-black hover:underline">Add your first client</button>
            </div>
          )}
        </div>

        {/* Pagination UI */}
        <div className="px-8 py-4 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row justify-between items-center gap-4 rounded-b-3xl">
          <div className="flex items-center gap-3">
            <span className="text-xs font-bold text-slate-500">Rows per page:</span>
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
              Showing {activeClients.length > 0 ? startIndex + 1 : 0}-{Math.min(startIndex + rowsPerPage, activeClientsTotal.length)} of {activeClientsTotal.length}
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

      {disabledClients.length > 0 && (
        <div className="bg-slate-50 rounded-3xl border border-slate-200 shadow-sm overflow-hidden border-dashed">
          <div className="px-8 py-4 bg-slate-100/50 border-b border-slate-200 flex justify-between items-center">
            <h4 className="font-black text-slate-400 uppercase text-[10px] tracking-widest">Disabled Clients</h4>
            <span className="bg-slate-200 text-slate-500 px-3 py-1 rounded-full text-[10px] font-black">{disabledClients.length} DISABLED</span>
          </div>
          <div className="divide-y divide-slate-100">
            {disabledClients.map(c => (
              <div key={c.id} onClick={() => openEditModal(c)} className="p-6 opacity-60 grayscale hover:grayscale-0 hover:opacity-100 active:bg-slate-100 active:scale-[0.98] transition-all flex items-center justify-between gap-4 cursor-pointer select-none">
                <div className="flex gap-4 items-center">
                  <div className="w-10 h-10 bg-slate-200 text-slate-400 rounded-xl flex items-center justify-center">
                    <i className={`fa-solid ${c.type === 'individual' ? 'fa-user' : 'fa-building'}`}></i>
                  </div>
                  <div>
                    <h5 className="font-bold text-slate-500 line-through">{c.name}</h5>
                    <span className="text-[10px] font-black text-amber-500 uppercase">Disabled</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onUpdateClient(c.id, { isDisabled: false });
                    }}
                    className="p-2 text-praetor hover:bg-slate-100 rounded-lg transition-colors"
                  >
                    <i className="fa-solid fa-rotate-left"></i>
                  </button>
                  {userRole === 'admin' && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        confirmDelete(c);
                      }}
                      className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    >
                      <i className="fa-solid fa-trash-can"></i>
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default ClientsView;
