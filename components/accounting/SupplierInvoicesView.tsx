import type React from 'react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Product, Supplier, SupplierInvoice, SupplierInvoiceItem } from '../../types';
import { roundToTwoDecimals } from '../../utils/numbers';
import CustomSelect from '../shared/CustomSelect';
import Modal from '../shared/Modal';
import StatusBadge, { type StatusType } from '../shared/StatusBadge';
import ValidatedNumberInput from '../shared/ValidatedNumberInput';

const calculateTotals = (items: SupplierInvoiceItem[]) => {
  let subtotal = 0;
  let taxAmount = 0;
  items.forEach((item) => {
    const lineSubtotal = item.quantity * item.unitPrice;
    const lineDiscount = (lineSubtotal * Number(item.discount ?? 0)) / 100;
    const lineNet = lineSubtotal - lineDiscount;
    subtotal += lineNet;
    taxAmount += lineNet * (Number(item.taxRate ?? 0) / 100);
  });
  return { subtotal, taxAmount, total: subtotal + taxAmount };
};

export interface SupplierInvoicesViewProps {
  invoices: SupplierInvoice[];
  suppliers: Supplier[];
  products: Product[];
  onUpdateInvoice: (id: string, updates: Partial<SupplierInvoice>) => void | Promise<void>;
  onDeleteInvoice: (id: string) => void | Promise<void>;
  currency: string;
}

const SupplierInvoicesView: React.FC<SupplierInvoicesViewProps> = ({
  invoices,
  suppliers,
  products,
  onUpdateInvoice,
  onDeleteInvoice,
  currency,
}) => {
  const { t } = useTranslation(['accounting', 'common']);
  const statusOptions = useMemo(
    () => [
      { id: 'draft', name: t('accounting:clientsInvoices.statusDraft') },
      { id: 'sent', name: t('accounting:clientsInvoices.statusSent') },
      { id: 'paid', name: t('accounting:clientsInvoices.statusPaid') },
      { id: 'overdue', name: t('accounting:clientsInvoices.statusOverdue') },
      { id: 'cancelled', name: t('accounting:clientsInvoices.statusCancelled') },
    ],
    [t],
  );

  const activeSuppliers = useMemo(
    () => suppliers.filter((supplier) => !supplier.isDisabled),
    [suppliers],
  );
  const activeProducts = useMemo(
    () => products.filter((product) => !product.isDisabled),
    [products],
  );

  const [editingInvoice, setEditingInvoice] = useState<SupplierInvoice | null>(null);
  const [invoiceToDelete, setInvoiceToDelete] = useState<SupplierInvoice | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [formData, setFormData] = useState<Partial<SupplierInvoice>>({
    linkedSaleId: '',
    supplierId: '',
    supplierName: '',
    invoiceNumber: '',
    issueDate: new Date().toISOString().split('T')[0],
    dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    status: 'draft',
    subtotal: 0,
    taxAmount: 0,
    total: 0,
    amountPaid: 0,
    notes: '',
    items: [],
  });

  const filteredInvoices = useMemo(() => {
    return invoices.filter((invoice) => {
      const matchesSearch =
        searchTerm.trim() === '' ||
        invoice.supplierName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        invoice.invoiceNumber.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesStatus = filterStatus === 'all' || invoice.status === filterStatus;
      return matchesSearch && matchesStatus;
    });
  }, [invoices, searchTerm, filterStatus]);

  const openEditModal = (invoice: SupplierInvoice) => {
    setEditingInvoice(invoice);
    setFormData({
      ...invoice,
      issueDate: invoice.issueDate?.split('T')[0] || '',
      dueDate: invoice.dueDate?.split('T')[0] || '',
    });
    setIsModalOpen(true);
  };

  const updateItem = (index: number, field: keyof SupplierInvoiceItem, value: string | number) => {
    setFormData((prev) => {
      const items = [...(prev.items || [])];
      const nextItem = { ...items[index], [field]: value };
      if (field === 'productId') {
        const product = products.find((item) => item.id === value);
        if (product) {
          nextItem.description = product.name;
          nextItem.unitPrice = Number(product.costo);
          nextItem.taxRate = Number(product.taxRate ?? 0);
        }
      }
      items[index] = nextItem;
      const totals = calculateTotals(items);
      return { ...prev, items, ...totals };
    });
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl overflow-hidden">
          <div className="flex items-center justify-between p-6 border-b border-slate-100 bg-slate-50/50">
            <h3 className="text-xl font-black text-slate-800">Supplier Invoice</h3>
            <button
              onClick={() => setIsModalOpen(false)}
              className="w-10 h-10 rounded-xl text-slate-400 hover:bg-slate-100"
            >
              <i className="fa-solid fa-xmark"></i>
            </button>
          </div>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              if (!editingInvoice) return;
              const totals = calculateTotals(formData.items || []);
              await onUpdateInvoice(editingInvoice.id, {
                ...formData,
                ...totals,
                amountPaid: roundToTwoDecimals(Number(formData.amountPaid ?? 0)),
                items: (formData.items || []).map((item) => ({
                  ...item,
                  quantity: roundToTwoDecimals(Number(item.quantity ?? 0)),
                  unitPrice: roundToTwoDecimals(Number(item.unitPrice ?? 0)),
                  taxRate: roundToTwoDecimals(Number(item.taxRate ?? 0)),
                  discount: roundToTwoDecimals(Number(item.discount ?? 0)),
                })),
              });
              setIsModalOpen(false);
            }}
            className="p-6 space-y-6 max-h-[85vh] overflow-y-auto"
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-bold text-slate-500 ml-1">Supplier</label>
                <CustomSelect
                  options={activeSuppliers.map((supplier) => ({
                    id: supplier.id,
                    name: supplier.name,
                  }))}
                  value={formData.supplierId || ''}
                  onChange={(value) => {
                    const supplier = suppliers.find((item) => item.id === value);
                    setFormData((prev) => ({
                      ...prev,
                      supplierId: value as string,
                      supplierName: supplier?.name || '',
                    }));
                  }}
                  searchable={true}
                />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-500 ml-1">Invoice Number</label>
                <input
                  type="text"
                  value={formData.invoiceNumber || ''}
                  onChange={(event) =>
                    setFormData((prev) => ({ ...prev, invoiceNumber: event.target.value }))
                  }
                  className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-500 ml-1">Issue Date</label>
                <input
                  type="date"
                  value={formData.issueDate || ''}
                  onChange={(event) =>
                    setFormData((prev) => ({ ...prev, issueDate: event.target.value }))
                  }
                  className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-500 ml-1">Due Date</label>
                <input
                  type="date"
                  value={formData.dueDate || ''}
                  onChange={(event) =>
                    setFormData((prev) => ({ ...prev, dueDate: event.target.value }))
                  }
                  className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>
            </div>
            <div className="space-y-3">
              {(formData.items || []).map((item, index) => (
                <div
                  key={item.id}
                  className="grid grid-cols-12 gap-2 items-start bg-slate-50 p-3 rounded-xl"
                >
                  <div className="col-span-12 md:col-span-3">
                    <CustomSelect
                      options={activeProducts.map((product) => ({
                        id: product.id,
                        name: product.name,
                      }))}
                      value={item.productId || ''}
                      onChange={(value) => updateItem(index, 'productId', value as string)}
                      searchable={true}
                    />
                  </div>
                  <div className="col-span-12 md:col-span-3">
                    <input
                      type="text"
                      value={item.description}
                      onChange={(event) => updateItem(index, 'description', event.target.value)}
                      className="w-full text-sm px-3 py-2 bg-white border border-slate-200 rounded-xl"
                    />
                  </div>
                  <div className="col-span-4 md:col-span-2">
                    <ValidatedNumberInput
                      value={item.quantity}
                      onValueChange={(value) =>
                        updateItem(index, 'quantity', value === '' ? 0 : Number(value))
                      }
                      className="w-full text-sm px-3 py-2 bg-white border border-slate-200 rounded-xl"
                    />
                  </div>
                  <div className="col-span-4 md:col-span-2">
                    <ValidatedNumberInput
                      value={item.unitPrice}
                      onValueChange={(value) =>
                        updateItem(index, 'unitPrice', value === '' ? 0 : Number(value))
                      }
                      className="w-full text-sm px-3 py-2 bg-white border border-slate-200 rounded-xl"
                    />
                  </div>
                  <div className="col-span-4 md:col-span-2">
                    <ValidatedNumberInput
                      value={item.taxRate}
                      onValueChange={(value) =>
                        updateItem(index, 'taxRate', value === '' ? 0 : Number(value))
                      }
                      className="w-full text-sm px-3 py-2 bg-white border border-slate-200 rounded-xl"
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="text-xs font-bold text-slate-500 ml-1">Status</label>
                <CustomSelect
                  options={statusOptions}
                  value={formData.status || 'draft'}
                  onChange={(value) =>
                    setFormData((prev) => ({
                      ...prev,
                      status: value as SupplierInvoice['status'],
                    }))
                  }
                  searchable={false}
                />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-500 ml-1">Amount Paid</label>
                <ValidatedNumberInput
                  value={formData.amountPaid || 0}
                  onValueChange={(value) =>
                    setFormData((prev) => ({
                      ...prev,
                      amountPaid: value === '' ? 0 : Number(value),
                    }))
                  }
                  className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>
              <div className="md:col-span-2 flex items-end justify-end text-right">
                <div>
                  <div className="text-xs font-black uppercase tracking-widest text-slate-400">
                    Total
                  </div>
                  <div className="text-2xl font-black text-praetor">
                    {calculateTotals(formData.items || []).total.toFixed(2)} {currency}
                  </div>
                </div>
              </div>
            </div>
            <div>
              <label className="text-xs font-bold text-slate-500 ml-1">Notes</label>
              <textarea
                rows={3}
                value={formData.notes || ''}
                onChange={(event) =>
                  setFormData((prev) => ({ ...prev, notes: event.target.value }))
                }
                className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl"
              />
            </div>
            <div className="flex justify-between border-t border-slate-100 pt-4">
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="px-6 py-2.5 rounded-xl border border-slate-200 text-sm font-bold text-slate-600"
              >
                {t('common.cancel')}
              </button>
              <button
                type="submit"
                className="px-6 py-2.5 rounded-xl bg-praetor text-white text-sm font-bold"
              >
                {t('common.update')}
              </button>
            </div>
          </form>
        </div>
      </Modal>

      <Modal isOpen={isDeleteConfirmOpen} onClose={() => setIsDeleteConfirmOpen(false)}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
          <h3 className="text-lg font-black text-slate-800">Delete supplier invoice?</h3>
          <p className="text-sm text-slate-500">{invoiceToDelete?.invoiceNumber}</p>
          <div className="flex gap-3">
            <button
              onClick={() => setIsDeleteConfirmOpen(false)}
              className="flex-1 py-2.5 rounded-xl border border-slate-200 text-sm font-bold text-slate-600"
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={async () => {
                if (!invoiceToDelete) return;
                await onDeleteInvoice(invoiceToDelete.id);
                setIsDeleteConfirmOpen(false);
                setInvoiceToDelete(null);
              }}
              className="flex-1 py-2.5 rounded-xl bg-red-600 text-white text-sm font-bold"
            >
              {t('common.yesDelete')}
            </button>
          </div>
        </div>
      </Modal>

      <div className="space-y-1">
        <h2 className="text-2xl font-black text-slate-800">Supplier Invoices</h2>
        <p className="text-sm text-slate-500">Invoices created from supplier sale orders.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <input
          type="text"
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
          placeholder={t('common.search')}
          className="w-full px-4 py-3 bg-white border border-slate-200 rounded-2xl text-sm"
        />
        <CustomSelect
          options={[
            { id: 'all', name: t('common.all', { defaultValue: 'All' }) },
            ...statusOptions,
          ]}
          value={filterStatus}
          onChange={(value) => setFilterStatus(value as string)}
          searchable={false}
          buttonClassName="w-full px-4 py-3 bg-white border border-slate-200 rounded-2xl text-sm font-semibold text-slate-700"
        />
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full">
          <thead className="bg-slate-50 border-b border-slate-100">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-black uppercase tracking-widest text-slate-400">
                Supplier
              </th>
              <th className="px-4 py-3 text-left text-xs font-black uppercase tracking-widest text-slate-400">
                Invoice Number
              </th>
              <th className="px-4 py-3 text-left text-xs font-black uppercase tracking-widest text-slate-400">
                Status
              </th>
              <th className="px-4 py-3 text-left text-xs font-black uppercase tracking-widest text-slate-400">
                Total
              </th>
              <th className="px-4 py-3 text-right text-xs font-black uppercase tracking-widest text-slate-400">
                {t('common.actions')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredInvoices.map((invoice) => (
              <tr key={invoice.id} className="hover:bg-slate-50/70">
                <td className="px-4 py-4">
                  <div className="font-bold text-slate-800">{invoice.supplierName}</div>
                  <div className="text-xs text-slate-400">
                    {invoice.linkedExpenseId
                      ? `Expense ${invoice.linkedExpenseId}`
                      : 'No linked expense'}
                  </div>
                </td>
                <td className="px-4 py-4 font-mono text-sm font-bold text-slate-600">
                  {invoice.invoiceNumber}
                </td>
                <td className="px-4 py-4">
                  <StatusBadge
                    type={invoice.status as StatusType}
                    label={
                      statusOptions.find((option) => option.id === invoice.status)?.name ||
                      invoice.status
                    }
                  />
                </td>
                <td className="px-4 py-4 text-sm font-bold text-slate-700">
                  {Number(invoice.total).toFixed(2)} {currency}
                </td>
                <td className="px-4 py-4">
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => openEditModal(invoice)}
                      className="w-10 h-10 rounded-xl text-slate-400 hover:text-praetor hover:bg-slate-100"
                      title={t('common.edit')}
                    >
                      <i className="fa-solid fa-pen-to-square"></i>
                    </button>
                    <button
                      onClick={() => {
                        setInvoiceToDelete(invoice);
                        setIsDeleteConfirmOpen(true);
                      }}
                      className="w-10 h-10 rounded-xl text-slate-400 hover:text-red-600 hover:bg-red-50"
                      title={t('common.delete')}
                    >
                      <i className="fa-solid fa-trash-can"></i>
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default SupplierInvoicesView;
