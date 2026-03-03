import type React from 'react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Product, Supplier, SupplierSaleOrder, SupplierSaleOrderItem } from '../../types';
import { roundToTwoDecimals } from '../../utils/numbers';
import CustomSelect from '../shared/CustomSelect';
import Modal from '../shared/Modal';
import StatusBadge, { type StatusType } from '../shared/StatusBadge';
import ValidatedNumberInput from '../shared/ValidatedNumberInput';

const getPaymentTermsOptions = (t: (key: string, options?: Record<string, unknown>) => string) => [
  { id: 'immediate', name: t('crm:paymentTerms.immediate') },
  { id: '15gg', name: t('crm:paymentTerms.15gg') },
  { id: '21gg', name: t('crm:paymentTerms.21gg') },
  { id: '30gg', name: t('crm:paymentTerms.30gg') },
  { id: '45gg', name: t('crm:paymentTerms.45gg') },
  { id: '60gg', name: t('crm:paymentTerms.60gg') },
  { id: '90gg', name: t('crm:paymentTerms.90gg') },
  { id: '120gg', name: t('crm:paymentTerms.120gg') },
  { id: '180gg', name: t('crm:paymentTerms.180gg') },
  { id: '240gg', name: t('crm:paymentTerms.240gg') },
  { id: '365gg', name: t('crm:paymentTerms.365gg') },
];

const calculateTotal = (items: SupplierSaleOrderItem[], globalDiscount: number) => {
  let subtotal = 0;
  let totalTax = 0;
  items.forEach((item) => {
    const lineSubtotal = item.quantity * item.unitPrice;
    const lineDiscount = (lineSubtotal * Number(item.discount ?? 0)) / 100;
    const lineNet = lineSubtotal - lineDiscount;
    subtotal += lineNet;
    totalTax += lineNet * (1 - globalDiscount / 100) * (Number(item.productTaxRate ?? 0) / 100);
  });
  return subtotal - subtotal * (globalDiscount / 100) + totalTax;
};

export interface SupplierOrdersViewProps {
  orders: SupplierSaleOrder[];
  suppliers: Supplier[];
  products: Product[];
  orderIdsWithInvoices: ReadonlySet<string>;
  onUpdateOrder: (id: string, updates: Partial<SupplierSaleOrder>) => void | Promise<void>;
  onDeleteOrder: (id: string) => void | Promise<void>;
  onCreateInvoice?: (order: SupplierSaleOrder) => void | Promise<void>;
  currency: string;
}

const SupplierOrdersView: React.FC<SupplierOrdersViewProps> = ({
  orders,
  suppliers,
  products,
  orderIdsWithInvoices,
  onUpdateOrder,
  onDeleteOrder,
  onCreateInvoice,
  currency,
}) => {
  const { t } = useTranslation(['accounting', 'common', 'crm']);
  const paymentTermsOptions = useMemo(() => getPaymentTermsOptions(t), [t]);
  const statusOptions = useMemo(
    () => [
      { id: 'draft', name: t('accounting:clientsOrders.statusDraft') },
      { id: 'sent', name: t('accounting:clientsOrders.statusSent') },
      { id: 'confirmed', name: t('accounting:clientsOrders.statusConfirmed') },
      { id: 'denied', name: t('accounting:clientsOrders.statusDenied') },
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

  const [editingOrder, setEditingOrder] = useState<SupplierSaleOrder | null>(null);
  const [orderToDelete, setOrderToDelete] = useState<SupplierSaleOrder | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [formData, setFormData] = useState<Partial<SupplierSaleOrder>>({
    linkedOfferId: '',
    linkedQuoteId: '',
    supplierId: '',
    supplierName: '',
    items: [],
    paymentTerms: 'immediate',
    discount: 0,
    status: 'draft',
    notes: '',
  });

  const isReadOnly = Boolean(editingOrder && editingOrder.status !== 'draft');

  const filteredOrders = useMemo(() => {
    return orders.filter((order) => {
      const matchesSearch =
        searchTerm.trim() === '' ||
        order.supplierName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        order.linkedOfferId.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesStatus = filterStatus === 'all' || order.status === filterStatus;
      return matchesSearch && matchesStatus;
    });
  }, [orders, searchTerm, filterStatus]);

  const openEditModal = (order: SupplierSaleOrder) => {
    setEditingOrder(order);
    setFormData(order);
    setIsModalOpen(true);
  };

  const updateItem = (
    index: number,
    field: keyof SupplierSaleOrderItem,
    value: string | number,
  ) => {
    if (isReadOnly) return;
    setFormData((prev) => {
      const items = [...(prev.items || [])];
      const nextItem = { ...items[index], [field]: value };
      if (field === 'productId') {
        const product = products.find((item) => item.id === value);
        if (product) {
          nextItem.productName = product.name;
          nextItem.unitPrice = Number(product.costo);
          nextItem.productTaxRate = Number(product.taxRate ?? 0);
        }
      }
      items[index] = nextItem;
      return { ...prev, items };
    });
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl overflow-hidden">
          <div className="flex items-center justify-between p-6 border-b border-slate-100 bg-slate-50/50">
            <h3 className="text-xl font-black text-slate-800">
              {t('accounting:supplierOrders.editOrder', { defaultValue: 'Supplier Order' })}
            </h3>
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
              if (!editingOrder) return;
              await onUpdateOrder(editingOrder.id, {
                ...formData,
                discount: roundToTwoDecimals(Number(formData.discount ?? 0)),
                items: (formData.items || []).map((item) => ({
                  ...item,
                  unitPrice: roundToTwoDecimals(Number(item.unitPrice ?? 0)),
                  productTaxRate: roundToTwoDecimals(Number(item.productTaxRate ?? 0)),
                  discount: roundToTwoDecimals(Number(item.discount ?? 0)),
                })),
              });
              setIsModalOpen(false);
            }}
            className="p-6 space-y-6 max-h-[85vh] overflow-y-auto"
          >
            {isReadOnly && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-700">
                {t('accounting:supplierOrders.readOnlyStatus', {
                  defaultValue:
                    'Non-draft orders are read-only. Change status from the list actions.',
                })}
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-bold text-slate-500 ml-1">
                  {t('accounting:supplierOrders.supplier')}
                </label>
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
                  disabled={isReadOnly}
                />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-500 ml-1">
                  {t('accounting:supplierOrders.paymentTerms')}
                </label>
                <CustomSelect
                  options={paymentTermsOptions}
                  value={formData.paymentTerms || 'immediate'}
                  onChange={(value) =>
                    setFormData((prev) => ({
                      ...prev,
                      paymentTerms: value as SupplierSaleOrder['paymentTerms'],
                    }))
                  }
                  searchable={false}
                  disabled={isReadOnly}
                />
              </div>
            </div>
            <div className="space-y-3">
              {(formData.items || []).map((item, index) => (
                <div
                  key={item.id}
                  className="grid grid-cols-12 gap-2 items-start bg-slate-50 p-3 rounded-xl"
                >
                  <div className="col-span-12 md:col-span-4">
                    <CustomSelect
                      options={activeProducts.map((product) => ({
                        id: product.id,
                        name: product.name,
                      }))}
                      value={item.productId}
                      onChange={(value) => updateItem(index, 'productId', value as string)}
                      searchable={true}
                      disabled={isReadOnly}
                    />
                  </div>
                  <div className="col-span-6 md:col-span-2">
                    <ValidatedNumberInput
                      value={item.quantity}
                      onValueChange={(value) =>
                        updateItem(index, 'quantity', value === '' ? 0 : Number(value))
                      }
                      className="w-full text-sm px-3 py-2 bg-white border border-slate-200 rounded-xl"
                    />
                  </div>
                  <div className="col-span-6 md:col-span-2">
                    <ValidatedNumberInput
                      value={item.unitPrice}
                      onValueChange={(value) =>
                        updateItem(index, 'unitPrice', value === '' ? 0 : Number(value))
                      }
                      className="w-full text-sm px-3 py-2 bg-white border border-slate-200 rounded-xl"
                    />
                  </div>
                  <div className="col-span-6 md:col-span-2">
                    <ValidatedNumberInput
                      value={item.discount || 0}
                      onValueChange={(value) =>
                        updateItem(index, 'discount', value === '' ? 0 : Number(value))
                      }
                      className="w-full text-sm px-3 py-2 bg-white border border-slate-200 rounded-xl"
                    />
                  </div>
                  <div className="col-span-6 md:col-span-2">
                    <input
                      type="text"
                      value={item.note || ''}
                      disabled={isReadOnly}
                      onChange={(event) => updateItem(index, 'note', event.target.value)}
                      className="w-full text-sm px-3 py-2 bg-white border border-slate-200 rounded-xl"
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="text-xs font-bold text-slate-500 ml-1">
                  {t('accounting:supplierOrders.discount')}
                </label>
                <ValidatedNumberInput
                  value={formData.discount || 0}
                  onValueChange={(value) =>
                    setFormData((prev) => ({ ...prev, discount: value === '' ? 0 : Number(value) }))
                  }
                  className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-500 ml-1">
                  {t('accounting:supplierOrders.status')}
                </label>
                <CustomSelect
                  options={statusOptions}
                  value={formData.status || 'draft'}
                  onChange={(value) =>
                    setFormData((prev) => ({
                      ...prev,
                      status: value as SupplierSaleOrder['status'],
                    }))
                  }
                  searchable={false}
                  disabled={isReadOnly}
                />
              </div>
              <div className="flex items-end justify-end text-right">
                <div>
                  <div className="text-xs font-black uppercase tracking-widest text-slate-400">
                    {t('accounting:supplierOrders.total')}
                  </div>
                  <div className="text-2xl font-black text-praetor">
                    {calculateTotal(formData.items || [], Number(formData.discount || 0)).toFixed(
                      2,
                    )}{' '}
                    {currency}
                  </div>
                </div>
              </div>
            </div>
            <div>
              <label className="text-xs font-bold text-slate-500 ml-1">
                {t('accounting:supplierOrders.notes')}
              </label>
              <textarea
                rows={3}
                value={formData.notes || ''}
                disabled={isReadOnly}
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
              {!isReadOnly && (
                <button
                  type="submit"
                  className="px-6 py-2.5 rounded-xl bg-praetor text-white text-sm font-bold"
                >
                  {t('common.update')}
                </button>
              )}
            </div>
          </form>
        </div>
      </Modal>

      <Modal isOpen={isDeleteConfirmOpen} onClose={() => setIsDeleteConfirmOpen(false)}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
          <h3 className="text-lg font-black text-slate-800">
            {t('accounting:supplierOrders.deleteTitle', { defaultValue: 'Delete supplier order?' })}
          </h3>
          <p className="text-sm text-slate-500">{orderToDelete?.linkedOfferId}</p>
          <div className="flex gap-3">
            <button
              onClick={() => setIsDeleteConfirmOpen(false)}
              className="flex-1 py-2.5 rounded-xl border border-slate-200 text-sm font-bold text-slate-600"
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={async () => {
                if (!orderToDelete) return;
                await onDeleteOrder(orderToDelete.id);
                setIsDeleteConfirmOpen(false);
                setOrderToDelete(null);
              }}
              className="flex-1 py-2.5 rounded-xl bg-red-600 text-white text-sm font-bold"
            >
              {t('common.yesDelete')}
            </button>
          </div>
        </div>
      </Modal>

      <div className="space-y-1">
        <h2 className="text-2xl font-black text-slate-800">
          {t('accounting:supplierOrders.title', { defaultValue: 'Supplier Orders' })}
        </h2>
        <p className="text-sm text-slate-500">
          {t('accounting:supplierOrders.subtitle', {
            defaultValue: 'Orders created from supplier offers.',
          })}
        </p>
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
                {t('accounting:supplierOrders.supplier')}
              </th>
              <th className="px-4 py-3 text-left text-xs font-black uppercase tracking-widest text-slate-400">
                {t('accounting:supplierOrders.linkedOffer')}
              </th>
              <th className="px-4 py-3 text-left text-xs font-black uppercase tracking-widest text-slate-400">
                {t('accounting:supplierOrders.status')}
              </th>
              <th className="px-4 py-3 text-left text-xs font-black uppercase tracking-widest text-slate-400">
                {t('accounting:supplierOrders.total')}
              </th>
              <th className="px-4 py-3 text-right text-xs font-black uppercase tracking-widest text-slate-400">
                {t('common.actions')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredOrders.map((order) => {
              const hasInvoice = orderIdsWithInvoices.has(order.id);
              return (
                <tr key={order.id} className="hover:bg-slate-50/70">
                  <td className="px-4 py-4">
                    <div className="font-bold text-slate-800">{order.supplierName}</div>
                    <div className="text-xs text-slate-400">
                      {order.linkedQuoteId ||
                        t('accounting:supplierOrders.noQuoteLink', {
                          defaultValue: 'No quote link',
                        })}
                    </div>
                  </td>
                  <td className="px-4 py-4 font-mono text-sm font-bold text-slate-600">
                    {order.linkedOfferId}
                  </td>
                  <td className="px-4 py-4">
                    <StatusBadge
                      type={order.status as StatusType}
                      label={
                        statusOptions.find((option) => option.id === order.status)?.name ||
                        order.status
                      }
                    />
                  </td>
                  <td className="px-4 py-4 text-sm font-bold text-slate-700">
                    {calculateTotal(order.items, order.discount).toFixed(2)} {currency}
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => openEditModal(order)}
                        className="w-10 h-10 rounded-xl text-slate-400 hover:text-praetor hover:bg-slate-100"
                        title={t('common.edit')}
                      >
                        <i className="fa-solid fa-pen-to-square"></i>
                      </button>
                      {order.status === 'draft' && (
                        <button
                          onClick={() => onUpdateOrder(order.id, { status: 'sent' })}
                          className="w-10 h-10 rounded-xl text-slate-400 hover:text-blue-600 hover:bg-blue-50"
                          title={t('accounting:supplierOrders.markSent')}
                        >
                          <i className="fa-solid fa-paper-plane"></i>
                        </button>
                      )}
                      {order.status === 'sent' && (
                        <>
                          <button
                            onClick={() => onUpdateOrder(order.id, { status: 'confirmed' })}
                            className="w-10 h-10 rounded-xl text-slate-400 hover:text-emerald-600 hover:bg-emerald-50"
                            title={t('accounting:supplierOrders.markConfirmed')}
                          >
                            <i className="fa-solid fa-check"></i>
                          </button>
                          <button
                            onClick={() => onUpdateOrder(order.id, { status: 'denied' })}
                            className="w-10 h-10 rounded-xl text-slate-400 hover:text-red-600 hover:bg-red-50"
                            title={t('accounting:supplierOrders.markDenied')}
                          >
                            <i className="fa-solid fa-xmark"></i>
                          </button>
                        </>
                      )}
                      {order.status === 'confirmed' && !hasInvoice && onCreateInvoice && (
                        <button
                          onClick={() => onCreateInvoice(order)}
                          className="w-10 h-10 rounded-xl text-slate-400 hover:text-praetor hover:bg-slate-100"
                          title={t('accounting:supplierOrders.createInvoice')}
                        >
                          <i className="fa-solid fa-file-invoice-dollar"></i>
                        </button>
                      )}
                      {order.status === 'draft' && (
                        <button
                          onClick={() => {
                            setOrderToDelete(order);
                            setIsDeleteConfirmOpen(true);
                          }}
                          className="w-10 h-10 rounded-xl text-slate-400 hover:text-red-600 hover:bg-red-50"
                          title={t('common.delete')}
                        >
                          <i className="fa-solid fa-trash-can"></i>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default SupplierOrdersView;
