import React, { useMemo, useState } from 'react';
import { Client, Product, SpecialBid } from '../types';
import CustomSelect from './CustomSelect';

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
  currency
}) => {
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

  const [searchTerm, setSearchTerm] = useState('');
  const [filterClientId, setFilterClientId] = useState('all');

  const filteredBids = useMemo(() => {
    return bids.filter(bid => {
      const matchesSearch = searchTerm === '' ||
        bid.clientName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        bid.productName.toLowerCase().includes(searchTerm.toLowerCase());

      const matchesClient = filterClientId === 'all' || bid.clientId === filterClientId;

      return matchesSearch && matchesClient;
    });
  }, [bids, searchTerm, filterClientId]);

  React.useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, filterClientId]);

  const [formData, setFormData] = useState<Partial<SpecialBid>>({
    clientId: '',
    clientName: '',
    productId: '',
    productName: '',
    unitPrice: 0,
    expirationDate: new Date().toISOString().split('T')[0]
  });

  const openAddModal = () => {
    setEditingBid(null);
    setFormData({
      clientId: '',
      clientName: '',
      productId: '',
      productName: '',
      unitPrice: 0,
      expirationDate: new Date().toISOString().split('T')[0]
    });
    setErrors({});
    setIsModalOpen(true);
  };

  const openEditModal = (bid: SpecialBid) => {
    setEditingBid(bid);
    const formattedDate = bid.expirationDate ? new Date(bid.expirationDate).toISOString().split('T')[0] : '';
    setFormData({
      clientId: bid.clientId,
      clientName: bid.clientName,
      productId: bid.productId,
      productName: bid.productName,
      unitPrice: bid.unitPrice,
      expirationDate: formattedDate
    });
    setErrors({});
    setIsModalOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const newErrors: Record<string, string> = {};
    if (!formData.clientId) {
      newErrors.clientId = 'Client is required';
    }
    if (!formData.productId) {
      newErrors.productId = 'Product is required';
    }
    if (!formData.expirationDate) {
      newErrors.expirationDate = 'Expiration date is required';
    }

    if (formData.clientId && formData.productId) {
      const duplicate = bids.some(b => b.clientId === formData.clientId && b.productId === formData.productId && b.id !== editingBid?.id);
      if (duplicate) {
        newErrors.productId = 'Special bid already exists for this client and product';
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
    const client = clients.find(c => c.id === clientId);
    setFormData({
      ...formData,
      clientId,
      clientName: client?.name || ''
    });
    if (errors.clientId || errors.productId) {
      setErrors(prev => {
        const next = { ...prev };
        delete next.clientId;
        delete next.productId;
        return next;
      });
    }
  };

  const handleProductChange = (productId: string) => {
    const product = products.find(p => p.id === productId);
    setFormData({
      ...formData,
      productId,
      productName: product?.name || ''
    });
    if (errors.productId) {
      setErrors(prev => {
        const next = { ...prev };
        delete next.productId;
        return next;
      });
    }
  };

  const activeClients = clients.filter(c => !c.isDisabled);
  const activeProducts = products.filter(p => !p.isDisabled && p.type === 'item');

  const totalPages = Math.ceil(filteredBids.length / rowsPerPage);
  const startIndex = (currentPage - 1) * rowsPerPage;
  const paginatedBids = filteredBids.slice(startIndex, startIndex + rowsPerPage);

  const isExpired = (expirationDate: string) => new Date(expirationDate) < new Date();

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
                {editingBid ? 'Edit Special Bid' : 'Create Special Bid'}
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
                  Special Bid Details
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 ml-1">Dedicated Client</label>
                    <CustomSelect
                      options={activeClients.map(c => ({ id: c.id, name: c.name }))}
                      value={formData.clientId || ''}
                      onChange={handleClientChange}
                      placeholder="Select a client..."
                      searchable={true}
                      className={errors.clientId ? 'border-red-300' : ''}
                    />
                    {errors.clientId && (
                      <p className="text-red-500 text-[10px] font-bold ml-1">{errors.clientId}</p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 ml-1">Product (Item)</label>
                    <CustomSelect
                      options={activeProducts.map(p => ({ id: p.id, name: p.name }))}
                      value={formData.productId || ''}
                      onChange={handleProductChange}
                      placeholder="Select a product..."
                      searchable={true}
                      className={errors.productId ? 'border-red-300' : ''}
                    />
                    {errors.productId && (
                      <p className="text-red-500 text-[10px] font-bold ml-1">{errors.productId}</p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 ml-1">Special Price ({currency})</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      required
                      value={formData.unitPrice ?? ''}
                      onChange={(e) => setFormData({ ...formData, unitPrice: e.target.value === '' ? 0 : parseFloat(e.target.value) })}
                      className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 ml-1">Expiration Date</label>
                    <input
                      type="date"
                      required
                      value={formData.expirationDate}
                      onChange={(e) => setFormData({ ...formData, expirationDate: e.target.value })}
                      className={`w-full text-sm px-4 py-2.5 bg-slate-50 border rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all ${errors.expirationDate ? 'border-red-500 bg-red-50' : 'border-slate-200'}`}
                    />
                    {errors.expirationDate && (
                      <p className="text-red-500 text-[10px] font-bold ml-1">{errors.expirationDate}</p>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex justify-between items-center pt-6 border-t border-slate-100">
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
                  {editingBid ? 'Update Bid' : 'Create Bid'}
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
                <h3 className="text-lg font-black text-slate-800">Delete Special Bid?</h3>
                <p className="text-sm text-slate-500 mt-2 leading-relaxed">
                  Are you sure you want to delete the bid for <span className="font-bold text-slate-800">{bidToDelete?.clientName}</span>?
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
          <h2 className="text-2xl font-black text-slate-800">Special Bids</h2>
          <p className="text-slate-500 text-sm">Define special prices for dedicated clients</p>
        </div>
        <button
          onClick={openAddModal}
          className="bg-praetor text-white px-6 py-3 rounded-2xl font-black shadow-xl shadow-slate-200 transition-all hover:bg-slate-700 active:scale-95 flex items-center gap-2"
        >
          <i className="fa-solid fa-plus"></i> Create Special Bid
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="md:col-span-2 relative">
          <i className="fa-solid fa-search absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"></i>
          <input
            type="text"
            placeholder="Search clients or products..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-semibold focus:ring-2 focus:ring-praetor outline-none shadow-sm placeholder:font-normal"
          />
        </div>
        <div>
          <CustomSelect
            options={[{ id: 'all', name: 'All Clients' }, ...activeClients.map(c => ({ id: c.id, name: c.name }))]}
            value={filterClientId}
            onChange={setFilterClientId}
            placeholder="Filter by Client"
            searchable={true}
            buttonClassName="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 shadow-sm"
          />
        </div>
      </div>

      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm">
        <div className="px-8 py-5 bg-slate-50 border-b border-slate-200 flex justify-between items-center rounded-t-3xl">
          <h4 className="font-black text-slate-400 uppercase text-[10px] tracking-widest">All Special Bids</h4>
          <span className="bg-slate-100 text-praetor px-3 py-1 rounded-full text-[10px] font-black">{filteredBids.length} TOTAL</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Client</th>
                <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Product</th>
                <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Price</th>
                <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Expiration</th>
                <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {paginatedBids.map(bid => {
                const expired = isExpired(bid.expirationDate);
                return (
                  <tr
                    key={bid.id}
                    onClick={() => openEditModal(bid)}
                    className={`hover:bg-slate-50/50 transition-colors group cursor-pointer ${expired ? 'bg-red-50/30' : ''}`}
                  >
                    <td className="px-8 py-5">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-slate-100 text-praetor rounded-xl flex items-center justify-center text-sm">
                          <i className="fa-solid fa-handshake"></i>
                        </div>
                        <div>
                          <div className="font-bold text-slate-800">{bid.clientName}</div>
                          <div className="text-[10px] font-black text-slate-400 uppercase">Dedicated</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-8 py-5 text-sm font-bold text-slate-700">{bid.productName}</td>
                    <td className="px-8 py-5 text-sm font-bold text-slate-700">{Number(bid.unitPrice).toFixed(2)} {currency}</td>
                    <td className="px-8 py-5">
                      <div className={`text-sm ${expired ? 'text-red-600 font-bold' : 'text-slate-600'}`}>
                        {new Date(bid.expirationDate).toLocaleDateString()}
                        {expired && <span className="ml-2 text-[10px] font-black">(EXPIRED)</span>}
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
                          title="Edit Special Bid"
                        >
                          <i className="fa-solid fa-pen-to-square"></i>
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            confirmDelete(bid);
                          }}
                          className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                          title="Delete Special Bid"
                        >
                          <i className="fa-solid fa-trash-can"></i>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filteredBids.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-12 text-center">
                    <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto text-slate-300 mb-4">
                      <i className="fa-solid fa-tags text-2xl"></i>
                    </div>
                    <p className="text-slate-400 text-sm font-bold">No special bids found.</p>
                    <button onClick={openAddModal} className="mt-4 text-praetor text-sm font-black hover:underline">Create your first special bid</button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

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
              Showing {paginatedBids.length > 0 ? startIndex + 1 : 0}-{Math.min(startIndex + rowsPerPage, filteredBids.length)} of {filteredBids.length}
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
    </div>
  );
};

export default SpecialBidsView;
