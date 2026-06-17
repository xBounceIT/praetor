import type React from 'react';
import { useCallback, useMemo, useReducer } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useDocumentCodePreview } from '../../hooks/useDocumentCodePreview';
import type { Client, DurationUnit, Invoice, InvoiceItem, Product } from '../../types';
import { addDaysToDateOnly, formatDateOnlyForLocale, getLocalDateString } from '../../utils/date';
import {
  calcProductSalePrice,
  durationValueToMonths,
  getDurationDisplayValue,
  getEffectiveDurationMonths,
  normalizeDurationUnit,
  parseDurationValueToMonths,
} from '../../utils/numbers';
import { buildProductQuickViewHref } from '../../utils/quickViewLinks';
import CostSummaryPanel from '../shared/CostSummaryPanel';
import DateField from '../shared/DateField';
import DeleteConfirmModal from '../shared/DeleteConfirmModal';
import DurationUnitSelector from '../shared/DurationUnitSelector';
import HeaderAddButton from '../shared/HeaderAddButton';
import Modal from '../shared/Modal';
import {
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '../shared/ModalLayout';
import QuickViewLinkButton from '../shared/QuickViewLinkButton';
import SelectControl from '../shared/SelectControl';
import StandardTable from '../shared/StandardTable';
import StatusBadge, { type StatusType } from '../shared/StatusBadge';
import { TABLE_ROW_ACTION_BUTTON_CLASSNAME } from '../shared/tableControlStyles';
import ValidatedNumberInput from '../shared/ValidatedNumberInput';

export interface ClientsInvoicesViewProps {
  invoices: Invoice[];
  clients: Client[];
  products: Product[];
  onAddInvoice: (invoiceData: Partial<Invoice>) => void;
  onUpdateInvoice: (id: string, updates: Partial<Invoice>) => void;
  onDeleteInvoice: (id: string) => void;
  currency: string;
  canViewInternalListing?: boolean;
}

// Italian standard VAT rate, used as the per-line default.
const DEFAULT_TAX_RATE = 22;

// Months the line's service runs (issue #757); multiplies the taxable amount. The shared
// `getEffectiveDurationMonths` clamps absent/invalid values to 1, so pre-duration invoices keep
// their totals — matching the backend `computeInvoiceTotals`.
const getLineTaxable = (item: InvoiceItem) =>
  item.quantity *
  item.unitPrice *
  getEffectiveDurationMonths(item) *
  (1 - Number(item.discount || 0) / 100);

const getLineTotal = (item: InvoiceItem) =>
  getLineTaxable(item) * (1 + Number(item.taxRate || 0) / 100);

const normalizeUnitOfMeasure = (
  unitOfMeasure?: InvoiceItem['unitOfMeasure'],
): InvoiceItem['unitOfMeasure'] => (unitOfMeasure === 'hours' ? 'hours' : 'unit');

const buildDefaultInvoice = (): Partial<Invoice> => {
  const issueDate = getLocalDateString();
  return {
    clientId: '',
    clientName: '',
    id: '',
    items: [],
    issueDate,
    dueDate: addDaysToDateOnly(issueDate, 30),
    status: 'draft',
    notes: '',
    amountPaid: 0,
    subtotal: 0,
    taxTotal: 0,
    total: 0,
  };
};

type ClientsInvoicesState = {
  isModalOpen: boolean;
  editingInvoice: Invoice | null;
  isDeleteConfirmOpen: boolean;
  invoiceToDelete: Invoice | null;
  productRowToDelete: number | null;
  errors: Record<string, string>;
  formData: Partial<Invoice>;
};

type StateUpdate<T> = T | ((prev: T) => T);

type ClientsInvoicesAction =
  | { type: 'openAdd'; formData: Partial<Invoice> }
  | { type: 'openEdit'; invoice: Invoice; formData: Partial<Invoice> }
  | { type: 'closeModal' }
  | { type: 'requestDelete'; invoice: Invoice }
  | { type: 'closeDeleteConfirm' }
  | { type: 'setProductRowToDelete'; update: StateUpdate<number | null> }
  | { type: 'setFormData'; update: StateUpdate<Partial<Invoice>> }
  | { type: 'setErrors'; update: StateUpdate<Record<string, string>> };

const resolveStateUpdate = <T,>(current: T, update: StateUpdate<T>): T =>
  typeof update === 'function' ? (update as (prev: T) => T)(current) : update;

const clientsInvoicesReducer = (
  state: ClientsInvoicesState,
  action: ClientsInvoicesAction,
): ClientsInvoicesState => {
  switch (action.type) {
    case 'openAdd':
      return {
        ...state,
        isModalOpen: true,
        editingInvoice: null,
        formData: action.formData,
        errors: {},
      };
    case 'openEdit':
      return {
        ...state,
        isModalOpen: true,
        editingInvoice: action.invoice,
        formData: action.formData,
        errors: {},
      };
    case 'closeModal':
      return { ...state, isModalOpen: false, productRowToDelete: null };
    case 'requestDelete':
      return { ...state, isDeleteConfirmOpen: true, invoiceToDelete: action.invoice };
    case 'closeDeleteConfirm':
      return { ...state, isDeleteConfirmOpen: false, invoiceToDelete: null };
    case 'setProductRowToDelete':
      return {
        ...state,
        productRowToDelete: resolveStateUpdate(state.productRowToDelete, action.update),
      };
    case 'setFormData':
      return { ...state, formData: resolveStateUpdate(state.formData, action.update) };
    case 'setErrors':
      return { ...state, errors: resolveStateUpdate(state.errors, action.update) };
  }
};

const useClientsInvoicesController = ({
  invoices,
  clients,
  products,
  onAddInvoice,
  onUpdateInvoice,
  onDeleteInvoice,
  currency,
  canViewInternalListing = true,
}: ClientsInvoicesViewProps) => {
  const { t } = useTranslation(['accounting', 'sales', 'common']);
  const [invoiceState, dispatchInvoiceState] = useReducer(
    clientsInvoicesReducer,
    undefined,
    () => ({
      isModalOpen: false,
      editingInvoice: null,
      isDeleteConfirmOpen: false,
      invoiceToDelete: null,
      productRowToDelete: null,
      errors: {},
      formData: buildDefaultInvoice(),
    }),
  );
  const {
    isModalOpen,
    editingInvoice,
    isDeleteConfirmOpen,
    invoiceToDelete,
    productRowToDelete,
    errors,
    formData,
  } = invoiceState;
  const { preview: clientInvoiceCodePreview } = useDocumentCodePreview('client_invoice', {
    date: formData.issueDate,
    enabled: isModalOpen && !editingInvoice,
  });
  const setFormData = useCallback((update: StateUpdate<Partial<Invoice>>) => {
    dispatchInvoiceState({ type: 'setFormData', update });
  }, []);
  const setErrors = useCallback((update: StateUpdate<Record<string, string>>) => {
    dispatchInvoiceState({ type: 'setErrors', update });
  }, []);
  const setProductRowToDelete = useCallback((update: StateUpdate<number | null>) => {
    dispatchInvoiceState({ type: 'setProductRowToDelete', update });
  }, []);
  const closeModal = useCallback(() => {
    dispatchInvoiceState({ type: 'closeModal' });
  }, []);
  const closeDeleteConfirm = useCallback(() => {
    dispatchInvoiceState({ type: 'closeDeleteConfirm' });
  }, []);

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

  const activeClients = useMemo(() => clients.filter((client) => !client.isDisabled), [clients]);
  const activeProducts = useMemo(
    () => products.filter((product) => !product.isDisabled),
    [products],
  );
  // All product ids (incl. archived) so the quick-view shortcut on a line that
  // references a now-disabled product still deep-links to that record.
  const allProductIds = useMemo(() => new Set(products.map((p) => p.id)), [products]);

  const clearItemsError = useCallback(() => {
    if (errors.items) {
      setErrors((prev) => {
        const nextErrors = { ...prev };
        delete nextErrors.items;
        return nextErrors;
      });
    }
  }, [errors.items, setErrors]);

  const applyProductPricing = useCallback(
    (
      item: InvoiceItem,
      product: Product,
      options?: { preserveDescription?: boolean },
    ): InvoiceItem => {
      const mol = product.molPercentage ? Number(product.molPercentage) : 0;
      const cost = Number(product.costo);

      return {
        ...item,
        productId: product.id,
        description: options?.preserveDescription ? item.description : product.name,
        unitOfMeasure: normalizeUnitOfMeasure(product.costUnit),
        unitPrice: calcProductSalePrice(cost, mol),
      };
    },
    [],
  );

  const openAddModal = () => {
    const issueDate = getLocalDateString();
    dispatchInvoiceState({
      type: 'openAdd',
      formData: {
        clientId: '',
        clientName: '',
        id: '',
        items: [],
        issueDate,
        dueDate: addDaysToDateOnly(issueDate, 30),
        status: 'draft',
        notes: '',
        amountPaid: 0,
        subtotal: 0,
        taxTotal: 0,
        total: 0,
      },
    });
  };

  const openEditModal = useCallback((invoice: Invoice) => {
    dispatchInvoiceState({
      type: 'openEdit',
      invoice,
      formData: {
        ...invoice,
        items: invoice.items.map((item) => ({
          ...item,
          unitOfMeasure: normalizeUnitOfMeasure(item.unitOfMeasure),
        })),
      },
    });
  }, []);

  const calculateTotals = useCallback((items: InvoiceItem[]) => {
    let subtotal = 0;
    let taxTotal = 0;

    items.forEach((item) => {
      const taxable = getLineTaxable(item);
      subtotal += taxable;
      taxTotal += (taxable * Number(item.taxRate || 0)) / 100;
    });

    const total = subtotal + taxTotal;

    return { subtotal, taxTotal, total };
  }, []);

  const handleClientChange = (clientId: string) => {
    const client = clients.find((item) => item.id === clientId);
    setFormData((prev) => ({
      ...prev,
      clientId,
      clientName: client?.name || '',
    }));

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
      description: '',
      unitOfMeasure: 'unit',
      quantity: 1,
      durationMonths: 1,
      durationUnit: 'months',
      unitPrice: 0,
      discount: 0,
      taxRate: DEFAULT_TAX_RATE,
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
    setFormData((prev) => ({ ...prev, items: nextItems }));
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
          };
        } else {
          const product = products.find((item) => item.id === value);
          if (product) {
            nextItem = applyProductPricing(currentItem, product);
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

  // Duration value entered in the item's chosen unit (issue #757). Stored canonically as whole
  // months; 'years' multiplies by 12. Empty/invalid input falls back to 1 of the chosen unit.
  const handleDurationValueChange = (index: number, value: string) => {
    const unit = normalizeDurationUnit(formData.items?.[index]?.durationUnit);
    updateItemRow(index, 'durationMonths', parseDurationValueToMonths(value, unit));
  };

  // Switching months↔years keeps the displayed number and reinterprets it under the new unit
  // (e.g. "2" months → "2" years = 24 months), mirroring how the quantity unit selector behaves.
  const handleDurationUnitChange = (index: number, newUnit: DurationUnit) => {
    const item = formData.items?.[index];
    if (!item || normalizeDurationUnit(item.durationUnit) === newUnit) return;
    // 'N/A' marks the line as duration-less: reset to the neutral 1 month so it never multiplies
    // (issue #775). Months/years instead keeps the displayed number under the new unit.
    const durationMonths =
      newUnit === 'na' ? 1 : durationValueToMonths(getDurationDisplayValue(item), newUnit);
    const nextItems = [...(formData.items || [])];
    nextItems[index] = {
      ...nextItems[index],
      durationUnit: newUnit,
      durationMonths,
    };
    setFormData((prev) => ({ ...prev, items: nextItems }));
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();

    const nextErrors: Record<string, string> = {};
    if (!formData.clientId) nextErrors.clientId = t('accounting:clientsInvoices.clientRequired');
    if (editingInvoice && !formData.id) {
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

    const roundedItems = (formData.items || []).map((item) => {
      const unitOfMeasure = normalizeUnitOfMeasure(item.unitOfMeasure);
      return {
        ...item,
        unitOfMeasure,
        quantity: Number(item.quantity ?? 0),
        unitPrice: Number(item.unitPrice ?? 0),
        discount: Number(item.discount || 0),
        taxRate: Number(item.taxRate || 0),
        durationMonths: Number(item.durationMonths ?? 1) || 1,
        durationUnit: normalizeDurationUnit(item.durationUnit),
      };
    });

    const { subtotal, taxTotal, total } = calculateTotals(roundedItems);
    const payload = {
      ...formData,
      id: formData.id?.trim() || undefined,
      items: roundedItems,
      amountPaid: Number(formData.amountPaid || 0),
      subtotal,
      taxTotal,
      total,
    };

    if (editingInvoice) {
      onUpdateInvoice(editingInvoice.id, payload);
    } else {
      onAddInvoice(payload);
    }
    closeModal();
  };

  const confirmDelete = useCallback((invoice: Invoice) => {
    dispatchInvoiceState({ type: 'requestDelete', invoice });
  }, []);

  const handleDelete = () => {
    if (invoiceToDelete) {
      onDeleteInvoice(invoiceToDelete.id);
      closeDeleteConfirm();
    }
  };

  const { subtotal, taxTotal, total } = calculateTotals(formData.items || []);
  const totalDiscount = (formData.items || []).reduce(
    (sum, item) =>
      sum +
      item.quantity *
        item.unitPrice *
        getEffectiveDurationMonths(item) *
        (Number(item.discount || 0) / 100),
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
          <span className="font-bold text-foreground">{row.id}</span>
        ),
      },
      {
        header: t('accounting:clientsInvoices.client'),
        id: 'clientName',
        accessorFn: (row: Invoice) => row.clientName,
        cell: ({ row }: { row: Invoice }) => (
          <span className="font-bold text-foreground">{row.clientName}</span>
        ),
      },
      {
        header: t('common:labels.date'),
        id: 'issueDate',
        accessorFn: (row: Invoice) => formatDateOnlyForLocale(row.issueDate),
        className: 'whitespace-nowrap',
        headerClassName: 'min-w-[8rem]',
        cell: ({ row }: { row: Invoice }) => (
          <span className="text-sm text-muted-foreground">
            {formatDateOnlyForLocale(row.issueDate)}
          </span>
        ),
      },
      {
        header: t('accounting:clientsInvoices.dueDate'),
        id: 'dueDate',
        accessorFn: (row: Invoice) => formatDateOnlyForLocale(row.dueDate),
        className: 'whitespace-nowrap',
        headerClassName: 'min-w-[8rem]',
        cell: ({ row }: { row: Invoice }) => (
          <span className="text-sm text-muted-foreground">
            {formatDateOnlyForLocale(row.dueDate)}
          </span>
        ),
      },
      {
        header: t('common:labels.amount'),
        id: 'invoiceTotal',
        accessorFn: (row: Invoice) => row.total,
        className: 'whitespace-nowrap',
        headerClassName: 'min-w-[8rem]',
        cell: ({ row }: { row: Invoice }) => (
          <span className="font-bold text-foreground">
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
        header: t('accounting:clientsInvoices.actionsColumn'),
        id: 'actions',
        className: 'whitespace-nowrap',
        headerClassName: 'min-w-[8rem]',
        disableSorting: true,
        disableFiltering: true,
        align: 'right' as const,
        cell: ({ row }: { row: Invoice }) => (
          <div className="flex justify-end gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      openEditModal(row);
                    }}
                    aria-label={t('common:buttons.edit')}
                    className={TABLE_ROW_ACTION_BUTTON_CLASSNAME}
                  >
                    <i className="fa-solid fa-pen-to-square"></i>
                  </button>
                </span>
              </TooltipTrigger>
              <TooltipContent>{t('common:buttons.edit')}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      confirmDelete(row);
                    }}
                    aria-label={t('common:buttons.delete')}
                    className="rounded-lg p-2 text-red-600 transition-all hover:bg-red-50 hover:text-red-600"
                  >
                    <i className="fa-solid fa-trash-can"></i>
                  </button>
                </span>
              </TooltipTrigger>
              <TooltipContent>{t('common:buttons.delete')}</TooltipContent>
            </Tooltip>
          </div>
        ),
      },
    ],
    [currency, statusOptions, t, confirmDelete, openEditModal],
  );

  return {
    activeClients,
    activeProducts,
    addItemRow,
    allProductIds,
    canViewInternalListing,
    clientInvoiceCodePreview,
    closeDeleteConfirm,
    closeModal,
    columns,
    currency,
    editingInvoice,
    errors,
    formData,
    grossSubtotal,
    handleClientChange,
    handleDelete,
    handleDurationUnitChange,
    handleDurationValueChange,
    handleSubmit,
    invoices,
    invoiceToDelete,
    isDeleteConfirmOpen,
    isModalOpen,
    openAddModal,
    openEditModal,
    productRowToDelete,
    removeItemRow,
    setFormData,
    setProductRowToDelete,
    statusOptions,
    t,
    taxTotal,
    total,
    totalDiscount,
    unitOptions,
    updateItemRow,
  };
};

type ClientsInvoicesController = ReturnType<typeof useClientsInvoicesController>;

const ClientsInvoicesView: React.FC<ClientsInvoicesViewProps> = (props) => {
  const controller = useClientsInvoicesController(props);
  return <ClientsInvoicesLayout controller={controller} />;
};

const ClientsInvoicesLayout: React.FC<{ controller: ClientsInvoicesController }> = ({
  controller,
}) => (
  <div className="space-y-8 animate-in fade-in duration-500">
    <ClientsInvoiceModal controller={controller} />
    <ClientsInvoiceDeleteDialogs controller={controller} />
    <ClientsInvoicesHeader controller={controller} />
    <StandardTable<Invoice>
      title={controller.t('accounting:clientsInvoices.allInvoices')}
      viewKey="invoices.clients"
      data={controller.invoices}
      columns={controller.columns}
      defaultRowsPerPage={10}
      containerClassName="overflow-visible"
      onRowClick={(row: Invoice) => controller.openEditModal(row)}
    />
  </div>
);

const ClientsInvoicesHeader: React.FC<{ controller: ClientsInvoicesController }> = ({
  controller,
}) => (
  <div className="space-y-4">
    <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
      <div>
        <h2 className="text-2xl font-semibold text-foreground">
          {controller.t('accounting:clientsInvoices.title')}
        </h2>
        <p className="text-sm text-muted-foreground">
          {controller.t('accounting:clientsInvoices.subtitle')}
        </p>
      </div>
      <HeaderAddButton onClick={controller.openAddModal}>
        {controller.t('accounting:clientsInvoices.addInvoice')}
      </HeaderAddButton>
    </div>
  </div>
);

const ClientsInvoiceModal: React.FC<{ controller: ClientsInvoicesController }> = ({
  controller,
}) => (
  <Modal isOpen={controller.isModalOpen} onClose={controller.closeModal}>
    <ModalContent size="full" className="max-h-[90vh]">
      <form onSubmit={controller.handleSubmit} className="flex min-h-0 flex-1 flex-col">
        <ModalHeader>
          <ModalTitle className="gap-3">
            <span className="flex size-10 items-center justify-center rounded-md bg-muted text-primary">
              <i
                className={`fa-solid ${controller.editingInvoice ? 'fa-pen-to-square' : 'fa-plus'}`}
                aria-hidden="true"
              ></i>
            </span>
            {controller.editingInvoice
              ? controller.t('accounting:clientsInvoices.editInvoice')
              : controller.t('accounting:clientsInvoices.addInvoice')}
          </ModalTitle>
          <ModalCloseButton onClick={controller.closeModal} />
        </ModalHeader>
        <ModalBody className="flex-1 space-y-5">
          <InvoiceDetailsSection controller={controller} />
          <InvoiceItemsSection controller={controller} />
          <InvoiceNotesSummarySection controller={controller} />
        </ModalBody>
        <ModalFooter>
          <Button type="button" variant="outline" onClick={controller.closeModal}>
            {controller.t('common:buttons.cancel')}
          </Button>
          <Button type="submit">{controller.t('common:buttons.save')}</Button>
        </ModalFooter>
      </form>
    </ModalContent>
  </Modal>
);

const InvoiceDetailsSection: React.FC<{ controller: ClientsInvoicesController }> = ({
  controller,
}) => (
  <div className="space-y-2">
    <SectionTitle>{controller.t('accounting:clientsInvoices.invoiceDetails')}</SectionTitle>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Field data-invalid={Boolean(controller.errors.clientId)}>
        <SelectControl
          id="client-invoice-client"
          options={controller.activeClients.map((client) => ({ id: client.id, name: client.name }))}
          value={controller.formData.clientId || ''}
          onChange={(value) => controller.handleClientChange(value as string)}
          label={controller.t('accounting:clientsInvoices.client')}
          required
          placeholder={controller.t('accounting:clientsInvoices.allClients')}
          searchable={true}
          buttonClassName={controller.errors.clientId ? 'h-9 border-destructive' : 'h-9'}
        />
        <FieldError className="text-xs">{controller.errors.clientId}</FieldError>
      </Field>
      <InvoiceNumberField controller={controller} />
      <InvoiceDateField controller={controller} field="issueDate" />
      <InvoiceDateField controller={controller} field="dueDate" />
    </div>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Field>
        <SelectControl
          id="client-invoice-status"
          options={controller.statusOptions}
          value={controller.formData.status || 'draft'}
          onChange={(value) =>
            controller.setFormData((prev) => ({ ...prev, status: value as Invoice['status'] }))
          }
          label={controller.t('accounting:clientsInvoices.status')}
          searchable={false}
          buttonClassName="h-9"
        />
      </Field>
    </div>
  </div>
);

const SectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-primary">
    <span className="size-1.5 rounded-full bg-primary"></span>
    {children}
  </h4>
);

const InvoiceNumberField: React.FC<{ controller: ClientsInvoicesController }> = ({
  controller,
}) => (
  <Field data-invalid={Boolean(controller.errors.id)}>
    <FieldLabel htmlFor="client-invoice-number" required={Boolean(controller.editingInvoice)}>
      {controller.t('accounting:clientsInvoices.invoiceNumber')}
    </FieldLabel>
    <Input
      id="client-invoice-number"
      type="text"
      value={controller.formData.id || ''}
      onChange={(event) => controller.setFormData((prev) => ({ ...prev, id: event.target.value }))}
      aria-invalid={Boolean(controller.errors.id)}
      className="font-medium"
      placeholder={
        controller.clientInvoiceCodePreview ??
        controller.t('accounting:clientsInvoices.autoCodePlaceholder', {
          defaultValue: 'Auto-generated',
        })
      }
    />
    <FieldError className="text-xs">{controller.errors.id}</FieldError>
    {!controller.editingInvoice && (
      <FieldDescription className="text-xs">
        {controller.clientInvoiceCodePreview
          ? controller.t('accounting:clientsInvoices.autoCodePreviewDescription', {
              preview: controller.clientInvoiceCodePreview,
              defaultValue: 'Leave blank to generate {{preview}} from the document code template.',
            })
          : controller.t('accounting:clientsInvoices.autoCodeDescription', {
              defaultValue: 'Leave blank to generate the next number automatically.',
            })}
      </FieldDescription>
    )}
  </Field>
);

const InvoiceDateField: React.FC<{
  controller: ClientsInvoicesController;
  field: 'issueDate' | 'dueDate';
}> = ({ controller, field }) => {
  const id = field === 'issueDate' ? 'client-invoice-issue-date' : 'client-invoice-due-date';
  const label =
    field === 'issueDate'
      ? controller.t('accounting:clientsInvoices.issueDate')
      : controller.t('accounting:clientsInvoices.dueDate');
  return (
    <Field data-invalid={Boolean(controller.errors[field])}>
      <FieldLabel htmlFor={id} required>
        {label}
      </FieldLabel>
      <DateField
        id={id}
        required
        value={controller.formData[field]}
        onChange={(value) => controller.setFormData((prev) => ({ ...prev, [field]: value }))}
        aria-invalid={Boolean(controller.errors[field])}
      />
      <FieldError className="text-xs">{controller.errors[field]}</FieldError>
    </Field>
  );
};

const InvoiceItemsSection: React.FC<{ controller: ClientsInvoicesController }> = ({
  controller,
}) => (
  <div className="space-y-4">
    <div className="flex items-center justify-between">
      <SectionTitle>{controller.t('accounting:clientsInvoices.items')}</SectionTitle>
      <Button type="button" size="sm" onClick={controller.addItemRow}>
        <i className="fa-solid fa-plus text-[10px]" aria-hidden="true"></i>
        {controller.t('accounting:clientsInvoices.addItem')}
      </Button>
    </div>
    <FieldError className="-mt-2 text-xs">{controller.errors.items}</FieldError>
    <InvoiceItemsHeader controller={controller} />
    <div className="space-y-3">
      {controller.formData.items?.map((item, index) => (
        <InvoiceItemRow key={item.id} controller={controller} item={item} index={index} />
      ))}
      {(!controller.formData.items || controller.formData.items.length === 0) && (
        <div className="rounded-md border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
          {controller.t('accounting:clientsInvoices.noItems')}
        </div>
      )}
    </div>
  </div>
);

const InvoiceItemsHeader: React.FC<{ controller: ClientsInvoicesController }> = ({
  controller,
}) => {
  if (!controller.formData.items || controller.formData.items.length === 0) return null;
  return (
    <div className="mb-1 hidden items-center gap-2 px-3 lg:flex">
      <div className="grid flex-1 grid-cols-14 gap-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        <div className="col-span-3">{controller.t('common:labels.product')}</div>
        <div className="col-span-2">{controller.t('common:labels.quantity')}</div>
        <div className="col-span-2 whitespace-nowrap">
          {controller.t('sales:clientQuotes.durationColumn', { defaultValue: 'Duration' })}
        </div>
        <div className="col-span-2">{controller.t('common:labels.price')}</div>
        <div className="col-span-1">{controller.t('common:labels.discount')}</div>
        <div className="col-span-2">
          {controller.t('accounting:clientsInvoices.taxRate', { defaultValue: 'IVA %' })}
        </div>
        <div className="col-span-2 pr-2 text-right">{controller.t('common:labels.total')}</div>
      </div>
      <div className="w-8 shrink-0"></div>
    </div>
  );
};

const InvoiceItemRow: React.FC<{
  controller: ClientsInvoicesController;
  item: InvoiceItem;
  index: number;
}> = ({ controller, item, index }) => (
  <div className="space-y-3 rounded-md border border-border bg-muted/30 p-3">
    <div className="flex items-start gap-2 lg:items-center lg:pt-5">
      <div className="grid flex-1 grid-cols-1 gap-2 lg:grid-cols-14">
        <InvoiceItemProductField controller={controller} item={item} index={index} />
        <InvoiceItemQuantityField controller={controller} item={item} index={index} />
        <InvoiceItemDurationField controller={controller} item={item} index={index} />
        <InvoiceItemPriceField controller={controller} item={item} index={index} />
        <InvoiceItemDiscountField controller={controller} item={item} index={index} />
        <InvoiceItemTaxField controller={controller} item={item} index={index} />
        <InvoiceItemTotalField controller={controller} item={item} />
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={() => controller.setProductRowToDelete(index)}
        className="text-muted-foreground hover:text-destructive"
      >
        <i className="fa-solid fa-trash-can" aria-hidden="true"></i>
        <span className="sr-only">{controller.t('common:buttons.delete')}</span>
      </Button>
    </div>
    <Field>
      <FieldLabel
        htmlFor={`client-invoice-item-description-${index}`}
        className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground"
        required
      >
        {controller.t('common:labels.description')}
      </FieldLabel>
      <Input
        id={`client-invoice-item-description-${index}`}
        type="text"
        required
        placeholder={controller.t('accounting:clientsInvoices.descriptionPlaceholder')}
        value={item.description}
        onChange={(event) => controller.updateItemRow(index, 'description', event.target.value)}
      />
    </Field>
  </div>
);

const InvoiceItemProductField: React.FC<{
  controller: ClientsInvoicesController;
  item: InvoiceItem;
  index: number;
}> = ({ controller, item, index }) => {
  const productHref = buildProductQuickViewHref(item.productId, controller.allProductIds);
  return (
    <div className="space-y-1 lg:col-span-3 min-w-0">
      <FieldLabel className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground lg:hidden">
        {controller.t('common:labels.product')}
      </FieldLabel>
      <div className="relative flex items-center gap-1">
        <SelectControl
          options={[
            { id: '', name: controller.t('accounting:clientsInvoices.customItem') },
            ...controller.activeProducts.map((product) => ({ id: product.id, name: product.name })),
          ]}
          value={item.productId || ''}
          onChange={(value) =>
            controller.updateItemRow(index, 'productId', (value as string) || undefined)
          }
          placeholder={controller.t('accounting:clientsInvoices.selectProductPlaceholder')}
          searchable={true}
          className="min-w-0 flex-1"
          buttonClassName="h-9"
        />
        {controller.canViewInternalListing && (
          <QuickViewLinkButton
            href={productHref}
            label={controller.t('sales:clientQuotes.openProductInNewTab')}
            disabledLabel={controller.t('sales:clientQuotes.productShortcutUnavailable')}
            floating
          />
        )}
      </div>
    </div>
  );
};

const InvoiceItemQuantityField: React.FC<{
  controller: ClientsInvoicesController;
  item: InvoiceItem;
  index: number;
}> = ({ controller, item, index }) => (
  <div className="space-y-1 lg:col-span-2">
    <FieldLabel
      className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground lg:hidden"
      required
    >
      {controller.t('common:labels.quantity')}
    </FieldLabel>
    <div className="flex items-center justify-center gap-1">
      <ValidatedNumberInput
        min="0"
        step="0.01"
        required
        value={item.quantity}
        onValueChange={(value) => {
          const parsed = parseFloat(value);
          controller.updateItemRow(
            index,
            'quantity',
            value === '' || Number.isNaN(parsed) ? 0 : parsed,
          );
        }}
        className="min-w-0 max-w-[5rem]"
      />
      <span className="shrink-0 text-xs font-medium text-muted-foreground">/</span>
      <span className="shrink-0 text-xs font-medium text-muted-foreground">
        {controller.unitOptions.find((unit) => unit.id === (item.unitOfMeasure || 'unit'))?.name ||
          controller.t('accounting:clientsInvoices.unit')}
      </span>
    </div>
  </div>
);

const InvoiceItemDurationField: React.FC<{
  controller: ClientsInvoicesController;
  item: InvoiceItem;
  index: number;
}> = ({ controller, item, index }) => {
  const durationUnit = normalizeDurationUnit(item.durationUnit);
  const durationValue = getDurationDisplayValue(item);
  return (
    <div className="space-y-1 lg:col-span-2">
      <FieldLabel className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground lg:hidden">
        {controller.t('sales:clientQuotes.durationColumn', { defaultValue: 'Duration' })}
      </FieldLabel>
      <div className="flex items-center justify-center gap-1">
        <ValidatedNumberInput
          min="1"
          step="1"
          value={durationValue}
          onValueChange={(value) => controller.handleDurationValueChange(index, value)}
          disabled={durationUnit === 'na'}
          className="min-w-0 max-w-[5rem]"
        />
        <span className="shrink-0 text-xs font-medium text-muted-foreground">/</span>
        <DurationUnitSelector
          value={durationUnit}
          onChange={(value) => controller.handleDurationUnitChange(index, value)}
          count={durationValue}
        />
      </div>
    </div>
  );
};

const InvoiceItemPriceField: React.FC<{
  controller: ClientsInvoicesController;
  item: InvoiceItem;
  index: number;
}> = ({ controller, item, index }) => (
  <InvoiceItemNumberField
    label={controller.t('common:labels.price')}
    suffix={controller.currency}
    value={item.unitPrice}
    required
    className="lg:col-span-2"
    onValueChange={(value) => {
      const parsed = parseFloat(value);
      controller.updateItemRow(
        index,
        'unitPrice',
        value === '' || Number.isNaN(parsed) ? 0 : parsed,
      );
    }}
  />
);

const InvoiceItemDiscountField: React.FC<{
  controller: ClientsInvoicesController;
  item: InvoiceItem;
  index: number;
}> = ({ controller, item, index }) => (
  <InvoiceItemNumberField
    label={controller.t('common:labels.discount')}
    suffix="%"
    value={item.discount || 0}
    max="100"
    className="lg:col-span-1"
    onValueChange={(value) => {
      const parsed = parseFloat(value);
      controller.updateItemRow(
        index,
        'discount',
        value === '' || Number.isNaN(parsed) ? 0 : parsed,
      );
    }}
  />
);

const InvoiceItemTaxField: React.FC<{
  controller: ClientsInvoicesController;
  item: InvoiceItem;
  index: number;
}> = ({ controller, item, index }) => (
  <InvoiceItemNumberField
    label={controller.t('accounting:clientsInvoices.taxRate', { defaultValue: 'IVA %' })}
    suffix="%"
    value={item.taxRate ?? DEFAULT_TAX_RATE}
    max="100"
    className="lg:col-span-2"
    onValueChange={(value) => {
      const parsed = parseFloat(value);
      controller.updateItemRow(index, 'taxRate', value === '' || Number.isNaN(parsed) ? 0 : parsed);
    }}
  />
);

const InvoiceItemNumberField: React.FC<{
  label: string;
  suffix: string;
  value: number | string;
  onValueChange: (value: string) => void;
  className: string;
  required?: boolean;
  max?: string;
}> = ({ label, suffix, value, onValueChange, className, required, max }) => (
  <div className={`space-y-1 ${className}`}>
    <FieldLabel
      className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground lg:hidden"
      required={required}
    >
      {label}
    </FieldLabel>
    <div className="flex items-center gap-1">
      <ValidatedNumberInput
        min="0"
        max={max}
        step="0.01"
        required={required}
        value={value}
        formatDecimals={2}
        onValueChange={onValueChange}
        className="min-w-0 font-medium"
      />
      <span className="shrink-0 text-xs font-medium text-muted-foreground">{suffix}</span>
    </div>
  </div>
);

const InvoiceItemTotalField: React.FC<{
  controller: ClientsInvoicesController;
  item: InvoiceItem;
}> = ({ controller, item }) => (
  <div className="space-y-1 lg:col-span-2">
    <FieldLabel className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground lg:hidden">
      {controller.t('common:labels.total')}
    </FieldLabel>
    <div className="flex min-h-[42px] items-center justify-end whitespace-nowrap px-3 py-2 text-sm font-semibold text-foreground">
      {getLineTotal(item).toFixed(2)} {controller.currency}
    </div>
  </div>
);

const InvoiceNotesSummarySection: React.FC<{ controller: ClientsInvoicesController }> = ({
  controller,
}) => (
  <div className="flex flex-col gap-4 border-t border-border pt-4 md:flex-row">
    <Field className="md:w-2/3">
      <SectionTitle>{controller.t('accounting:clientsInvoices.notes')}</SectionTitle>
      <FieldLabel htmlFor="client-invoice-notes" className="sr-only">
        {controller.t('accounting:clientsInvoices.notes')}
      </FieldLabel>
      <Textarea
        id="client-invoice-notes"
        rows={4}
        value={controller.formData.notes || ''}
        onChange={(event) =>
          controller.setFormData((prev) => ({ ...prev, notes: event.target.value }))
        }
        className="min-h-28 resize-none"
        placeholder={controller.t('accounting:clientsInvoices.notesPlaceholder')}
      />
    </Field>
    <div className="space-y-2 md:w-1/3">
      <SectionTitle>
        {controller.t('accounting:clientsInvoices.summary', { defaultValue: 'Summary' })}
      </SectionTitle>
      <CostSummaryPanel
        currency={controller.currency}
        subtotal={controller.grossSubtotal}
        total={controller.total}
        subtotalLabel={controller.t('accounting:clientsInvoices.subtotal')}
        totalLabel={controller.t('accounting:clientsInvoices.total')}
        discountRow={
          controller.totalDiscount > 0
            ? {
                label: controller.t('accounting:clientsInvoices.totalDiscount'),
                amount: controller.totalDiscount,
              }
            : undefined
        }
        taxRow={{
          label: controller.t('accounting:clientsInvoices.taxTotal'),
          amount: controller.taxTotal,
        }}
        amountPaid={{
          label: controller.t('accounting:clientsInvoices.amountPaid'),
          value: controller.formData.amountPaid || 0,
          onChange: (value) =>
            controller.setFormData((prev) => ({
              ...prev,
              amountPaid: value === '' ? 0 : Number(value),
            })),
        }}
        balanceDue={{
          label: controller.t('accounting:clientsInvoices.balanceDue'),
          amount: controller.total - Number(controller.formData.amountPaid || 0),
        }}
      />
    </div>
  </div>
);

const ClientsInvoiceDeleteDialogs: React.FC<{ controller: ClientsInvoicesController }> = ({
  controller,
}) => (
  <>
    <DeleteConfirmModal
      isOpen={controller.isDeleteConfirmOpen}
      onClose={controller.closeDeleteConfirm}
      onConfirm={controller.handleDelete}
      title={controller.t('accounting:clientsInvoices.deleteTitle')}
      description={controller.t('accounting:clientsInvoices.deleteMessage', {
        invoiceNumber: controller.invoiceToDelete?.id || '',
      })}
    />
    <DeleteConfirmModal
      isOpen={controller.productRowToDelete !== null}
      onClose={() => controller.setProductRowToDelete(null)}
      onConfirm={() => {
        if (controller.productRowToDelete !== null) {
          controller.removeItemRow(controller.productRowToDelete);
        }
        controller.setProductRowToDelete(null);
      }}
      title={controller.t('accounting:clientsInvoices.removeProductTitle')}
      description={controller.t('accounting:clientsInvoices.removeProductConfirm')}
      zIndex={70}
    />
  </>
);

export default ClientsInvoicesView;
