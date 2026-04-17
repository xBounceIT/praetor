import type React from 'react';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Client, ClientsOrder, Invoice, InvoiceItem, Product, SpecialBid } from '../../types';
import {
  addDaysToDateOnly,
  formatDateOnlyForLocale,
  getLocalDateString,
  isDateOnlyWithinInclusiveRange,
} from '../../utils/date';

import CustomSelect from '../shared/CustomSelect';
import Modal from '../shared/Modal';
import StandardTable from '../shared/StandardTable';
import StatusBadge, { type StatusType } from '../shared/StatusBadge';
import Tooltip from '../shared/Tooltip';
import ValidatedNumberInput from '../shared/ValidatedNumberInput';

export interface ClientsInvoicesViewProps {
  invoices: Invoice[];
  clients: Client[];
  products: Product[];
  specialBids: SpecialBid[];
  clientsOrders: ClientsOrder[];
  onAddInvoice: (invoiceData: Partial<Invoice>) => void;
  onUpdateInvoice: (id: string, updates: Partial<Invoice>) => void;
  onDeleteInvoice: (id: string) => void;
  currency: string;
}

const calcProductSalePrice = (costo: number, molPercentage: number) => {
  if (molPercentage >= 100) return costo;
  return costo / (1 - molPercentage / 100);
};

const getLineTotal = (item: InvoiceItem) =>
  item.quantity * item.unitPrice * (1 - Number(item.discount || 0) / 100);

const normalizeUnitOfMeasure = (
  unitOfMeasure?: InvoiceItem['unitOfMeasure'],
): InvoiceItem['unitOfMeasure'] => (unitOfMeasure === 'hours' ? 'hours' : 'unit');

const ClientsInvoicesView: React.FC<ClientsInvoicesViewProps> = ({
  invoices,
  clients,
  products,
  specialBids,
  clientsOrders: _clientsOrders,
  onAddInvoice,
  onUpdateInvoice,
  onDeleteInvoice,
  currency,
}) => {
  const { t } = useTranslation(['accounting', 'sales', 'common']);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState<Invoice | null>(null);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [invoiceToDelete, setInvoiceToDelete] = useState<Invoice | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

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

  const unitOptions = useMemo(
    () => [
      { id: 'unit', name: t('accounting:clientsInvoices.unit') },
      { id: 'hours', name: t('accounting:clientsInvoices.hours') },
    ],
    [t],
  );

  const defaultInvoice = useMemo(() => {
    const issueDate = getLocalDateString();
    return {
      clientId: '',
      clientName: '',
      id: '',
      items: [],
      issueDate,
      dueDate: addDaysToDateOnly(issueDate, 30),
      status: 'draft' as const,
      notes: '',
      amountPaid: 0,
      subtotal: 0,
      total: 0,
    };
  }, []);

  const [formData, setFormData] = useState<Partial<Invoice>>(defaultInvoice);

  const activeClients = useMemo(() => clients.filter((client) => !client.isDisabled), [clients]);
  const activeProducts = useMemo(
    () => products.filter((product) => !product.isDisabled),
    [products],
  );
  const activeSpecialBids = useMemo(() => {
    const today = getLocalDateString();
    return specialBids.filter((bid) =>
      isDateOnlyWithinInclusiveRange(today, bid.startDate, bid.endDate),
    );
  }, [specialBids]);
  const clientSpecialBids = useMemo(
    () =>
      formData.clientId
        ? activeSpecialBids.filter((bid) => bid.clientId === formData.clientId)
        : activeSpecialBids,
    [activeSpecialBids, formData.clientId],
  );

  const generateInvoiceId = () => {
    const year = new Date().getFullYear();
    const count = invoices.length + 1;
    return `INV-${year}-${count.toString().padStart(4, '0')}`;
  };

  const clearItemsError = useCallback(() => {
    if (errors.items) {
      setErrors((prev) => {
        const nextErrors = { ...prev };
        delete nextErrors.items;
        return nextErrors;
      });
    }
  }, [errors.items]);

  const findApplicableBid = useCallback(
    (clientId: string, productId: string) =>
      activeSpecialBids.find((bid) => bid.clientId === clientId && bid.productId === productId),
    [activeSpecialBids],
  );

  const applyProductPricing = useCallback(
    (
      item: InvoiceItem,
      product: Product,
      specialBid?: SpecialBid,
      options?: { preserveDescription?: boolean },
    ): InvoiceItem => {
      const molSource = specialBid?.molPercentage ?? product.molPercentage;
      const mol = molSource ? Number(molSource) : 0;
      const cost = specialBid ? Number(specialBid.unitPrice) : Number(product.costo);

      return {
        ...item,
        productId: product.id,
        specialBidId: specialBid?.id || undefined,
        description: options?.preserveDescription ? item.description : product.name,
        unitOfMeasure: normalizeUnitOfMeasure(product.costUnit),
        unitPrice: calcProductSalePrice(cost, mol),
      };
    },
    [],
  );

  const getBidDisplayValue = useCallback(
    (bidId?: string) => {
      if (!bidId) return t('accounting:clientsInvoices.noSpecialBid');
      const bid =
        activeSpecialBids.find((item) => item.id === bidId) ||
        specialBids.find((item) => item.id === bidId);
      return bid
        ? `${bid.clientName} · ${bid.productName}`
        : t('accounting:clientsInvoices.noSpecialBid');
    },
    [activeSpecialBids, specialBids, t],
  );

  const openAddModal = () => {
    const issueDate = getLocalDateString();
    setEditingInvoice(null);
    setFormData({
      clientId: '',
      clientName: '',
      id: generateInvoiceId(),
      items: [],
      issueDate,
      dueDate: addDaysToDateOnly(issueDate, 30),
      status: 'draft',
      notes: '',
      amountPaid: 0,
      subtotal: 0,
      total: 0,
    });
    setErrors({});
    setIsModalOpen(true);
  };

  const openEditModal = useCallback((invoice: Invoice) => {
    setEditingInvoice(invoice);
    setFormData({
      ...invoice,
      items: invoice.items.map((item) => ({
        ...item,
        specialBidId: item.specialBidId || undefined,
        unitOfMeasure: normalizeUnitOfMeasure(item.unitOfMeasure),
      })),
    });
    setErrors({});
    setIsModalOpen(true);
  }, []);

  const calculateTotals = useCallback((items: InvoiceItem[]) => {
    let subtotal = 0;

    items.forEach((item) => {
      const lineNet = getLineTotal(item);
      subtotal += lineNet;
    });

    const total = subtotal;

    return { subtotal, total };
  }, []);

  const handleClientChange = (clientId: string) => {
    const client = clients.find((item) => item.id === clientId);
    setFormData((prev) => {
      const updatedItems = (prev.items || []).map((item) => {
        if (!item.productId) {
          return item.specialBidId ? { ...item, specialBidId: undefined } : item;
        }

        const product = products.find((candidate) => candidate.id === item.productId);
        if (!product) {
          return { ...item, specialBidId: undefined };
        }

        const applicableBid = findApplicableBid(clientId, item.productId);
        return applyProductPricing(item, product, applicableBid, { preserveDescription: true });
      });

      return {
        ...prev,
        clientId,
        clientName: client?.name || '',
        items: updatedItems,
      };
    });

    if (errors.clientId) {
      setErrors((prev) => {
        const nextErrors = { ...prev };
        delete nextErrors.clientId;
        return nextErrors;
      });
    }
  };

  const addItemRow = () => {
    const newItem: Partial<InvoiceItem> = {
      id: `temp-${Date.now()}`,
      productId: undefined,
      specialBidId: undefined,
      description: '',
      unitOfMeasure: 'unit',
      quantity: 1,
      unitPrice: 0,
      discount: 0,
    };

    setFormData((prev) => ({
      ...prev,
      items: [...(prev.items || []), newItem as InvoiceItem],
    }));
    clearItemsError();
  };

  const removeItemRow = (index: number) => {
    const nextItems = [...(formData.items || [])];
    nextItems.splice(index, 1);
    setFormData({ ...formData, items: nextItems });
  };

  const updateItemRow = (
    index: number,
    field: keyof InvoiceItem,
    value: string | number | undefined,
  ) => {
    setFormData((prev) => {
      const nextItems = [...(prev.items || [])];
      const currentItem = { ...nextItems[index], [field]: value } as InvoiceItem;
      let nextItem = currentItem;

      if (field === 'productId') {
        if (!value) {
          nextItem = {
            ...currentItem,
            productId: undefined,
            specialBidId: undefined,
          };
        } else {
          const product = products.find((item) => item.id === value);
          if (product) {
            const applicableBid = prev.clientId
              ? findApplicableBid(prev.clientId, product.id)
              : undefined;
            nextItem = applyProductPricing(currentItem, product, applicableBid);
          }
        }
      }

      if (field === 'specialBidId') {
        if (!value) {
          const product = products.find((item) => item.id === currentItem.productId);
          nextItem = product
            ? applyProductPricing(currentItem, product)
            : { ...currentItem, specialBidId: undefined };
        } else {
          const bid = specialBids.find((item) => item.id === value);
          if (bid) {
            const product = products.find((item) => item.id === bid.productId);
            if (product) {
              nextItem = applyProductPricing(currentItem, product, bid);
            }
          }
        }
      }

      if (field === 'unitOfMeasure') {
        nextItem = {
          ...currentItem,
          unitOfMeasure: normalizeUnitOfMeasure(value as InvoiceItem['unitOfMeasure']),
        };
      }

      nextItems[index] = nextItem;
      return { ...prev, items: nextItems };
    });

    clearItemsError();
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();

    const nextErrors: Record<string, string> = {};
    if (!formData.clientId) nextErrors.clientId = t('accounting:clientsInvoices.clientRequired');
    if (!formData.id) {
      nextErrors.id = t('accounting:clientsInvoices.invoiceNumberRequired');
    }
    if (!formData.issueDate) {
      nextErrors.issueDate = t('accounting:clientsInvoices.issueDateRequired');
    }
    if (!formData.dueDate) nextErrors.dueDate = t('accounting:clientsInvoices.dueDateRequired');
    if (!formData.items || formData.items.length === 0) {
      nextErrors.items = t('accounting:clientsInvoices.itemsRequired');
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    const roundedItems = (formData.items || []).map((item) => ({
      ...item,
      specialBidId: item.specialBidId || undefined,
      unitOfMeasure: normalizeUnitOfMeasure(item.unitOfMeasure),
      quantity: Number(item.quantity ?? 0),
      unitPrice: Number(item.unitPrice ?? 0),
      discount: Number(item.discount || 0),
    }));

    const { subtotal, total } = calculateTotals(roundedItems);
    const payload = {
      ...formData,
      items: roundedItems,
      amountPaid: Number(formData.amountPaid || 0),
      subtotal,
      total,
    };

    if (editingInvoice) {
      onUpdateInvoice(editingInvoice.id, payload);
    } else {
      onAddInvoice(payload);
    }
    setIsModalOpen(false);
  };

  const confirmDelete = useCallback((invoice: Invoice) => {
    setInvoiceToDelete(invoice);
    setIsDeleteConfirmOpen(true);
  }, []);

  const handleDelete = () => {
    if (invoiceToDelete) {
      onDeleteInvoice(invoiceToDelete.id);
      setIsDeleteConfirmOpen(false);
      setInvoiceToDelete(null);
    }
  };

  const { subtotal, total } = calculateTotals(formData.items || []);
  const totalDiscount = (formData.items || []).reduce(
    (sum, item) => sum + item.quantity * item.unitPrice * (Number(item.discount || 0) / 100),
    0,
  );
  const grossSubtotal = subtotal + totalDiscount;

  const columns = useMemo(
    () => [
      {
        header: t('accounting:clientsInvoices.invoiceNumber'),
        id: 'id',
        accessorFn: (row: Invoice) => row.id,
        className: 'whitespace-nowrap',
        headerClassName: 'min-w-[8rem]',
        cell: ({ row }: { row: Invoice }) => (
          <span className="font-bold text-slate-700">{row.id}</span>
        ),
      },
      {
        header: t('accounting:clientsInvoices.client'),
        id: 'clientName',
        accessorFn: (row: Invoice) => row.clientName,
        cell: ({ row }: { row: Invoice }) => (
          <span className="font-bold text-slate-800">{row.clientName}</span>
        ),
      },
      {
        header: t('common:labels.date'),
        id: 'issueDate',
        accessorFn: (row: Invoice) => formatDateOnlyForLocale(row.issueDate),
        className: 'whitespace-nowrap',
        headerClassName: 'min-w-[8rem]',
        cell: ({ row }: { row: Invoice }) => (
          <span className="text-sm text-slate-600">{formatDateOnlyForLocale(row.issueDate)}</span>
        ),
      },
      {
        header: t('accounting:clientsInvoices.dueDate'),
        id: 'dueDate',
        accessorFn: (row: Invoice) => formatDateOnlyForLocale(row.dueDate),
        className: 'whitespace-nowrap',
        headerClassName: 'min-w-[8rem]',
        cell: ({ row }: { row: Invoice }) => (
          <span className="text-sm text-slate-600">{formatDateOnlyForLocale(row.dueDate)}</span>
        ),
      },
      {
        header: t('common:labels.amount'),
        id: 'invoiceTotal',
        accessorFn: (row: Invoice) => row.total,
        className: 'whitespace-nowrap',
        headerClassName: 'min-w-[8rem]',
        cell: ({ row }: { row: Invoice }) => (
          <span className="font-bold text-slate-700">
            {(row.total ?? 0).toFixed(2)} {currency}
          </span>
        ),
        filterFormat: (value: unknown) => (value as number).toFixed(2),
      },
      {
        header: t('accounting:clientsInvoices.amountPaid'),
        id: 'amountPaid',
        accessorFn: (row: Invoice) => row.amountPaid,
        cell: ({ row }: { row: Invoice }) => (
          <span className="font-bold text-emerald-600">
            {(row.amountPaid ?? 0).toFixed(2)} {currency}
          </span>
        ),
        filterFormat: (value: unknown) => (value as number).toFixed(2),
      },
      {
        header: t('accounting:clientsInvoices.balance'),
        id: 'balance',
        accessorFn: (row: Invoice) => row.total - row.amountPaid,
        cell: ({ row }: { row: Invoice }) => {
          const balance = row.total - row.amountPaid;
          return (
            <span className={`font-bold ${balance > 0 ? 'text-red-500' : 'text-emerald-600'}`}>
              {balance.toFixed(2)} {currency}
            </span>
          );
        },
        filterFormat: (value: unknown) => (value as number).toFixed(2),
      },
      {
        header: t('accounting:clientsInvoices.status'),
        id: 'invoiceStatus',
        accessorFn: (row: Invoice) =>
          statusOptions.find((opt) => opt.id === row.status)?.name || row.status,
        className: 'whitespace-nowrap',
        headerClassName: 'min-w-[9rem]',
        cell: ({ row }: { row: Invoice }) => (
          <StatusBadge
            type={row.status as StatusType}
            label={statusOptions.find((option) => option.id === row.status)?.name || row.status}
          />
        ),
      },
      {
        header: t('common:common.more'),
        id: 'actions',
        className: 'whitespace-nowrap',
        headerClassName: 'min-w-[8rem]',
        disableSorting: true,
        disableFiltering: true,
        align: 'right' as const,
        cell: ({ row }: { row: Invoice }) => (
          <div className="flex justify-end gap-2">
            <Tooltip label={t('common:buttons.edit')}>
              {() => (
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    openEditModal(row);
                  }}
                  className="rounded-lg p-2 text-slate-400 transition-all hover:bg-slate-100 hover:text-praetor"
                >
                  <i className="fa-solid fa-pen-to-square"></i>
                </button>
              )}
            </Tooltip>
            <Tooltip label={t('common:buttons.delete')}>
              {() => (
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    confirmDelete(row);
                  }}
                  className="rounded-lg p-2 text-slate-400 transition-all hover:bg-red-50 hover:text-red-600"
                >
                  <i className="fa-solid fa-trash-can"></i>
                </button>
              )}
            </Tooltip>
          </div>
        ),
      },
    ],
    [currency, statusOptions, t, confirmDelete, openEditModal],
  );

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)}>
        <div className="flex max-h-[90vh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl animate-in zoom-in duration-200">
          <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/50 p-6">
            <h3 className="flex items-center gap-3 text-xl font-black text-slate-800">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-praetor">
                <i className={`fa-solid ${editingInvoice ? 'fa-pen-to-square' : 'fa-plus'}`}></i>
              </div>
              {editingInvoice
                ? t('accounting:clientsInvoices.editInvoice')
                : t('accounting:clientsInvoices.addInvoice')}
            </h3>
            <button
              onClick={() => setIsModalOpen(false)}
              className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-400 transition-colors hover:bg-slate-100"
            >
              <i className="fa-solid fa-xmark text-lg"></i>
            </button>
          </div>

          <form onSubmit={handleSubmit} className="flex-1 space-y-4 overflow-y-auto p-8">
            <div className="space-y-2">
              <h4 className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-praetor">
                <span className="h-1.5 w-1.5 rounded-full bg-praetor"></span>
                {t('accounting:clientsInvoices.invoiceDetails')}
              </h4>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="space-y-1.5">
                  <label className="ml-1 text-xs font-bold text-slate-500">
                    {t('accounting:clientsInvoices.client')}
                  </label>
                  <CustomSelect
                    options={activeClients.map((client) => ({
                      id: client.id,
                      name: client.name,
                    }))}
                    value={formData.clientId || ''}
                    onChange={(value) => handleClientChange(value as string)}
                    placeholder={t('accounting:clientsInvoices.allClients')}
                    searchable={true}
                    className={errors.clientId ? 'border-red-300' : ''}
                  />
                  {errors.clientId && (
                    <p className="ml-1 text-[10px] font-bold text-red-500">{errors.clientId}</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <label className="ml-1 text-xs font-bold text-slate-500">
                    {t('accounting:clientsInvoices.invoiceNumber')}
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.id || ''}
                    onChange={(event) => setFormData({ ...formData, id: event.target.value })}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-praetor"
                    placeholder="INV-YYYY-XXXX"
                  />
                  {errors.id && (
                    <p className="ml-1 text-[10px] font-bold text-red-500">{errors.id}</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <label className="ml-1 text-xs font-bold text-slate-500">
                    {t('accounting:clientsInvoices.issueDate')}
                  </label>
                  <input
                    type="date"
                    required
                    value={formData.issueDate}
                    onChange={(event) =>
                      setFormData({ ...formData, issueDate: event.target.value })
                    }
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-praetor"
                  />
                  {errors.issueDate && (
                    <p className="ml-1 text-[10px] font-bold text-red-500">{errors.issueDate}</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <label className="ml-1 text-xs font-bold text-slate-500">
                    {t('accounting:clientsInvoices.dueDate')}
                  </label>
                  <input
                    type="date"
                    required
                    value={formData.dueDate}
                    onChange={(event) => setFormData({ ...formData, dueDate: event.target.value })}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-praetor"
                  />
                  {errors.dueDate && (
                    <p className="ml-1 text-[10px] font-bold text-red-500">{errors.dueDate}</p>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="space-y-1.5">
                  <label className="ml-1 text-xs font-bold text-slate-500">
                    {t('accounting:clientsInvoices.status')}
                  </label>
                  <CustomSelect
                    options={statusOptions}
                    value={formData.status || 'draft'}
                    onChange={(value) =>
                      setFormData({ ...formData, status: value as Invoice['status'] })
                    }
                    searchable={false}
                  />
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-praetor">
                  <span className="h-1.5 w-1.5 rounded-full bg-praetor"></span>
                  {t('accounting:clientsInvoices.items')}
                </h4>
                <button
                  type="button"
                  onClick={addItemRow}
                  className="flex items-center gap-1 text-xs font-bold text-praetor hover:text-slate-700"
                >
                  <i className="fa-solid fa-plus"></i> {t('accounting:clientsInvoices.addItem')}
                </button>
              </div>
              {errors.items && (
                <p className="ml-1 -mt-2 text-[10px] font-bold text-red-500">{errors.items}</p>
              )}

              {formData.items && formData.items.length > 0 && (
                <div className="hidden lg:flex gap-2 px-3 mb-1 items-center">
                  <div className="grid flex-1 grid-cols-12 gap-2 text-[10px] font-black uppercase tracking-wider text-slate-400">
                    <div className="col-span-2 ml-1">
                      {t('accounting:clientsInvoices.specialBid')}
                    </div>
                    <div className="col-span-2">{t('common:labels.product')}</div>
                    <div className="col-span-1">{t('common:labels.quantity')}</div>
                    <div className="col-span-2">
                      {t('common:labels.price')} ({currency})
                    </div>
                    <div className="col-span-1">{t('common:labels.discount')}%</div>
                    <div className="col-span-3 pr-2 text-right">{t('common:labels.total')}</div>
                  </div>
                  <div className="w-8 shrink-0"></div>
                </div>
              )}

              <div className="space-y-3">
                {formData.items?.map((item, index) => {
                  const lineTotal = getLineTotal(item);

                  return (
                    <div
                      key={item.id}
                      className="space-y-3 rounded-xl border border-slate-100 bg-slate-50 p-3"
                    >
                      <div className="flex items-start gap-2">
                        <div className="grid flex-1 grid-cols-1 gap-2 lg:grid-cols-12">
                          <div className="space-y-1 lg:col-span-2 min-w-0">
                            <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 lg:hidden">
                              {t('accounting:clientsInvoices.specialBid')}
                            </label>
                            <CustomSelect
                              options={[
                                {
                                  id: 'none',
                                  name: t('accounting:clientsInvoices.noSpecialBid'),
                                },
                                ...clientSpecialBids.map((bid) => ({
                                  id: bid.id,
                                  name: `${bid.clientName} · ${bid.productName}`,
                                })),
                              ]}
                              value={item.specialBidId || 'none'}
                              onChange={(value) =>
                                updateItemRow(
                                  index,
                                  'specialBidId',
                                  value === 'none' ? undefined : (value as string),
                                )
                              }
                              placeholder={t('accounting:clientsInvoices.selectSpecialBid')}
                              displayValue={getBidDisplayValue(item.specialBidId)}
                              searchable={true}
                              buttonClassName="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                            />
                          </div>
                          <div className="space-y-1 lg:col-span-2 min-w-0">
                            <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 lg:hidden">
                              {t('common:labels.product')}
                            </label>
                            <CustomSelect
                              options={[
                                { id: '', name: t('accounting:clientsInvoices.customItem') },
                                ...activeProducts.map((product) => ({
                                  id: product.id,
                                  name: product.name,
                                })),
                              ]}
                              value={item.productId || ''}
                              onChange={(value) =>
                                updateItemRow(index, 'productId', (value as string) || undefined)
                              }
                              placeholder={t('accounting:clientsInvoices.selectProductPlaceholder')}
                              searchable={true}
                              buttonClassName="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                            />
                          </div>
                          <div className="space-y-1 lg:col-span-1">
                            <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 lg:hidden">
                              {t('common:labels.quantity')}
                            </label>
                            <div className="flex items-center gap-1">
                              <ValidatedNumberInput
                                min="0"
                                step="0.01"
                                required
                                value={item.quantity}
                                onValueChange={(value) => {
                                  const parsed = parseFloat(value);
                                  updateItemRow(
                                    index,
                                    'quantity',
                                    value === '' || Number.isNaN(parsed) ? 0 : parsed,
                                  );
                                }}
                                className="w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none"
                              />
                              <span className="shrink-0 text-xs font-semibold text-slate-400">
                                {unitOptions.find((u) => u.id === (item.unitOfMeasure || 'unit'))
                                  ?.name || t('accounting:clientsInvoices.unit')}
                              </span>
                            </div>
                          </div>
                          <div className="space-y-1 lg:col-span-2">
                            <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 lg:hidden">
                              {t('common:labels.price')} ({currency})
                            </label>
                            <ValidatedNumberInput
                              min="0"
                              step="0.01"
                              required
                              value={item.unitPrice}
                              onValueChange={(value) => {
                                const parsed = parseFloat(value);
                                updateItemRow(
                                  index,
                                  'unitPrice',
                                  value === '' || Number.isNaN(parsed) ? 0 : parsed,
                                );
                              }}
                              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none"
                            />
                          </div>
                          <div className="space-y-1 lg:col-span-1">
                            <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 lg:hidden">
                              {t('common:labels.discount')}%
                            </label>
                            <ValidatedNumberInput
                              min="0"
                              max="100"
                              value={item.discount || 0}
                              onValueChange={(value) => {
                                const parsed = parseFloat(value);
                                updateItemRow(
                                  index,
                                  'discount',
                                  value === '' || Number.isNaN(parsed) ? 0 : parsed,
                                );
                              }}
                              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none"
                            />
                          </div>
                          <div className="space-y-1 lg:col-span-3">
                            <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 lg:hidden">
                              {t('common:labels.total')}
                            </label>
                            <div className="flex min-h-[42px] items-center justify-end whitespace-nowrap px-3 py-2 text-sm font-bold text-slate-700">
                              {lineTotal.toFixed(2)} {currency}
                            </div>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeItemRow(index)}
                          className="rounded-lg p-2 text-slate-400 transition-colors hover:text-red-600"
                        >
                          <i className="fa-solid fa-trash-can"></i>
                        </button>
                      </div>

                      <div className="space-y-1">
                        <label className="ml-1 text-[10px] font-black uppercase tracking-wider text-slate-400">
                          {t('common:labels.description')}
                        </label>
                        <input
                          type="text"
                          required
                          placeholder={t('accounting:clientsInvoices.descriptionPlaceholder')}
                          value={item.description}
                          onChange={(event) =>
                            updateItemRow(index, 'description', event.target.value)
                          }
                          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none"
                        />
                      </div>
                    </div>
                  );
                })}

                {(!formData.items || formData.items.length === 0) && (
                  <div className="rounded-xl border-2 border-dashed border-slate-200 py-8 text-center text-sm text-slate-400">
                    {t('accounting:clientsInvoices.noItems')}
                  </div>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-4 border-t border-slate-100 pt-4 md:flex-row">
              <div className="md:w-2/3 space-y-1.5">
                <label className="ml-1 text-xs font-bold text-slate-500">
                  {t('accounting:clientsInvoices.notes')}
                </label>
                <textarea
                  rows={4}
                  value={formData.notes || ''}
                  onChange={(event) => setFormData({ ...formData, notes: event.target.value })}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none resize-none focus:ring-2 focus:ring-praetor transition-all"
                  placeholder={t('accounting:clientsInvoices.notesPlaceholder')}
                />
              </div>

              <div className="md:w-1/3">
                <div className="bg-slate-50 rounded-xl p-4 space-y-2">
                  <div className="flex justify-between">
                    <span className="text-sm font-bold text-slate-500">
                      {t('accounting:clientsInvoices.subtotal')}
                    </span>
                    <span className="text-sm font-black text-slate-800">
                      {grossSubtotal.toFixed(2)} {currency}
                    </span>
                  </div>
                  {totalDiscount > 0 && (
                    <div className="flex justify-between">
                      <span className="text-sm font-bold text-slate-500">
                        {t('accounting:clientsInvoices.totalDiscount')}
                      </span>
                      <span className="text-sm font-black text-amber-600">
                        -{totalDiscount.toFixed(2)} {currency}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between border-t border-slate-200 pt-2">
                    <span className="text-sm font-black text-slate-700 uppercase tracking-widest">
                      {t('accounting:clientsInvoices.total')}
                    </span>
                    <span className="text-lg font-black text-praetor">
                      {total.toFixed(2)}{' '}
                      <span className="text-sm text-slate-400 font-bold">{currency}</span>
                    </span>
                  </div>
                  <div className="flex justify-between items-center border-t border-slate-200 pt-2">
                    <span className="text-sm font-bold text-slate-500">
                      {t('accounting:clientsInvoices.amountPaid')}
                    </span>
                    <div className="flex items-center gap-2">
                      <ValidatedNumberInput
                        value={formData.amountPaid || 0}
                        onValueChange={(value) =>
                          setFormData((prev) => ({
                            ...prev,
                            amountPaid: value === '' ? 0 : Number(value),
                          }))
                        }
                        className="w-24 rounded-lg border border-slate-200 bg-white px-2 py-1 text-right text-sm font-bold text-emerald-600 outline-none focus:ring-2 focus:ring-praetor"
                      />
                      <span className="text-xs font-bold text-slate-400">{currency}</span>
                    </div>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="font-bold text-slate-500">
                      {t('accounting:clientsInvoices.balanceDue')}
                    </span>
                    <span className="font-black text-red-500">
                      {(total - Number(formData.amountPaid || 0)).toFixed(2)} {currency}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-4">
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="rounded-xl px-6 py-3 font-bold text-slate-500 hover:bg-slate-50"
              >
                {t('common:buttons.cancel')}
              </button>
              <button
                type="submit"
                className="rounded-xl bg-praetor px-8 py-3 font-bold text-white shadow-lg shadow-slate-200 hover:bg-slate-700"
              >
                {t('common:buttons.save')}
              </button>
            </div>
          </form>
        </div>
      </Modal>

      <Modal isOpen={isDeleteConfirmOpen} onClose={() => setIsDeleteConfirmOpen(false)}>
        <div className="w-full max-w-sm space-y-4 overflow-hidden rounded-2xl bg-white p-6 text-center shadow-2xl">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600">
            <i className="fa-solid fa-triangle-exclamation text-xl"></i>
          </div>
          <h3 className="text-lg font-black text-slate-800">
            {t('accounting:clientsInvoices.deleteTitle')}
          </h3>
          <p className="text-sm text-slate-500">
            {t('accounting:clientsInvoices.deleteMessage', {
              invoiceNumber: invoiceToDelete?.id || '',
            })}
          </p>
          <div className="flex gap-3 pt-2">
            <button
              onClick={() => setIsDeleteConfirmOpen(false)}
              className="flex-1 rounded-xl py-3 font-bold text-slate-500 hover:bg-slate-50"
            >
              {t('common:buttons.cancel')}
            </button>
            <button
              onClick={handleDelete}
              className="flex-1 rounded-xl bg-red-600 py-3 font-bold text-white hover:bg-red-700"
            >
              {t('common:buttons.delete')}
            </button>
          </div>
        </div>
      </Modal>

      <div className="space-y-4">
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-2xl font-black text-slate-800">
              {t('accounting:clientsInvoices.title')}
            </h2>
            <p className="text-sm text-slate-500">{t('accounting:clientsInvoices.subtitle')}</p>
          </div>
          <button
            onClick={openAddModal}
            className="flex items-center gap-2 rounded-xl bg-praetor px-5 py-2.5 text-sm font-black text-white shadow-xl shadow-slate-200 transition-all hover:bg-slate-700 active:scale-95"
          >
            <i className="fa-solid fa-plus"></i> {t('accounting:clientsInvoices.addInvoice')}
          </button>
        </div>
      </div>

      <StandardTable<Invoice>
        title={t('accounting:clientsInvoices.allInvoices')}
        data={invoices}
        columns={columns}
        defaultRowsPerPage={10}
        containerClassName="overflow-visible"
        onRowClick={(row: Invoice) => openEditModal(row)}
      />
    </div>
  );
};

export default ClientsInvoicesView;
