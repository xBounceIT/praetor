import type React from 'react';
import { useCallback, useMemo, useReducer } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type {
  DurationUnit,
  Product,
  Supplier,
  SupplierInvoice,
  SupplierInvoiceItem,
} from '../../types';
import {
  addDaysToDateOnly,
  formatDateOnlyForLocale,
  getLocalDateString,
  normalizeDateOnlyString,
} from '../../utils/date';
import { createLineItemIndexResolver } from '../../utils/lineItemIndex';
import {
  durationValueToMonths,
  formatDecimal,
  getDurationInputValue,
  getEffectiveDurationMonths,
  isPositiveFiniteNumber,
  normalizeDurationForSubmit,
  normalizeDurationUnit,
  parseDurationValueToMonths,
} from '../../utils/numbers';
import CostSummaryPanel from '../shared/CostSummaryPanel';
import DateField from '../shared/DateField';
import DeleteConfirmModal from '../shared/DeleteConfirmModal';
import DurationUnitSelector from '../shared/DurationUnitSelector';
import Modal from '../shared/Modal';
import {
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '../shared/ModalLayout';
import SelectControl from '../shared/SelectControl';
import StandardTable, { type Column } from '../shared/StandardTable';
import StatusBadge, { type StatusType } from '../shared/StatusBadge';
import { TABLE_ROW_ACTION_BUTTON_CLASSNAME } from '../shared/tableControlStyles';
import ValidatedNumberInput from '../shared/ValidatedNumberInput';

const statusLabelMap: Record<string, string> = {
  draft: 'accounting:supplierInvoices.statusDraft',
  sent: 'accounting:supplierInvoices.statusSent',
  paid: 'accounting:supplierInvoices.statusPaid',
  overdue: 'accounting:supplierInvoices.statusOverdue',
  cancelled: 'accounting:supplierInvoices.statusCancelled',
};
const EMPTY_SUPPLIER_INVOICE_ITEMS: SupplierInvoiceItem[] = [];
const SUPPLIER_INVOICE_ITEM_NUMBER_INPUT_CLASSNAME =
  'h-9 max-w-[5rem] flex-none text-right font-medium';

const getSupplierInvoiceLineTotal = (item: SupplierInvoiceItem) => {
  const lineSubtotal =
    Number(item.quantity || 0) * Number(item.unitPrice || 0) * getEffectiveDurationMonths(item);
  const lineDiscount = (lineSubtotal * Number(item.discount ?? 0)) / 100;
  return lineSubtotal - lineDiscount;
};

const getStatusOptions = (t: (key: string, options?: Record<string, unknown>) => string) =>
  Object.entries(statusLabelMap).map(([id, key]) => ({ id, name: t(key) }));

const getStatusLabel = (
  status: SupplierInvoice['status'],
  t: (key: string, options?: Record<string, unknown>) => string,
) => t(statusLabelMap[status] ?? String(status));

const calculateTotals = (items: SupplierInvoiceItem[]) => {
  // Duration multiplies each line alongside quantity; 'na' lines use a neutral multiplier of 1.
  const subtotal = items.reduce((sum, item) => sum + getSupplierInvoiceLineTotal(item), 0);

  return { subtotal, total: subtotal };
};

const createDefaultSupplierInvoiceForm = (): Partial<SupplierInvoice> => {
  const issueDate = getLocalDateString();
  return {
    linkedSaleId: '',
    supplierId: '',
    supplierName: '',
    id: '',
    issueDate,
    dueDate: addDaysToDateOnly(issueDate, 30),
    status: 'draft',
    subtotal: 0,
    total: 0,
    amountPaid: 0,
    notes: '',
    items: [],
  };
};

const invoiceToFormData = (invoice: SupplierInvoice): Partial<SupplierInvoice> => ({
  ...invoice,
  issueDate: invoice.issueDate ? normalizeDateOnlyString(invoice.issueDate) : '',
  dueDate: invoice.dueDate ? normalizeDateOnlyString(invoice.dueDate) : '',
  items: invoice.items.map((item) => ({ ...item })),
});

type SupplierInvoicesState = {
  editingInvoice: SupplierInvoice | null;
  invoiceToDelete: SupplierInvoice | null;
  isModalOpen: boolean;
  isDeleteConfirmOpen: boolean;
  formData: Partial<SupplierInvoice>;
};

type SupplierInvoicesAction =
  | { type: 'openEdit'; invoice: SupplierInvoice }
  | { type: 'closeModal' }
  | { type: 'submitSuccess' }
  | { type: 'confirmDelete'; invoice: SupplierInvoice }
  | { type: 'deleteSuccess' }
  | { type: 'patchForm'; patch: Partial<SupplierInvoice> }
  | {
      type: 'updateItem';
      index: number;
      field: keyof SupplierInvoiceItem;
      value: string | number | undefined;
      products: Product[];
    }
  | { type: 'removeItem'; index: number };

const createSupplierInvoicesState = (): SupplierInvoicesState => ({
  editingInvoice: null,
  invoiceToDelete: null,
  isModalOpen: false,
  isDeleteConfirmOpen: false,
  formData: createDefaultSupplierInvoiceForm(),
});

const supplierInvoicesReducer = (
  state: SupplierInvoicesState,
  action: SupplierInvoicesAction,
): SupplierInvoicesState => {
  switch (action.type) {
    case 'openEdit':
      return {
        ...state,
        editingInvoice: action.invoice,
        formData: invoiceToFormData(action.invoice),
        isModalOpen: true,
      };
    case 'closeModal':
      return { ...state, isModalOpen: false };
    case 'submitSuccess':
      return { ...state, isModalOpen: false };
    case 'confirmDelete':
      return { ...state, invoiceToDelete: action.invoice, isDeleteConfirmOpen: true };
    case 'deleteSuccess':
      return { ...state, invoiceToDelete: null, isDeleteConfirmOpen: false };
    case 'patchForm':
      return { ...state, formData: { ...state.formData, ...action.patch } };
    case 'updateItem': {
      const items = [...(state.formData.items || [])];
      const nextItem = { ...items[action.index], [action.field]: action.value };

      if (action.field === 'productId') {
        const product = action.products.find((item) => item.id === action.value);
        if (product) {
          nextItem.description = product.name;
          nextItem.unitPrice = Number(product.costo);
        }
      }

      items[action.index] = nextItem;
      const totals = calculateTotals(items);
      return { ...state, formData: { ...state.formData, items, ...totals } };
    }
    case 'removeItem': {
      const items = (state.formData.items || []).filter((_, index) => index !== action.index);
      return { ...state, formData: { ...state.formData, items } };
    }
    default:
      return state;
  }
};

export interface SupplierInvoicesViewProps {
  invoices: SupplierInvoice[];
  suppliers: Supplier[];
  products: Product[];
  onUpdateInvoice: (id: string, updates: Partial<SupplierInvoice>) => void | Promise<void>;
  onDeleteInvoice: (id: string) => void | Promise<void>;
  currency: string;
}

const useSupplierInvoicesController = ({
  invoices,
  suppliers,
  products,
  onUpdateInvoice,
  onDeleteInvoice,
  currency,
}: SupplierInvoicesViewProps) => {
  const { t } = useTranslation(['accounting', 'sales', 'common', 'crm']);
  const statusOptions = useMemo(() => getStatusOptions(t), [t]);
  const activeSuppliers = useMemo(
    () => suppliers.filter((supplier) => !supplier.isDisabled),
    [suppliers],
  );
  const activeProducts = useMemo(
    () => products.filter((product) => !product.isDisabled),
    [products],
  );
  const productOptions = useMemo(
    () => activeProducts.map((product) => ({ id: product.id, name: product.name })),
    [activeProducts],
  );
  const supplierOptions = useMemo(
    () => activeSuppliers.map((supplier) => ({ id: supplier.id, name: supplier.name })),
    [activeSuppliers],
  );

  const [state, dispatch] = useReducer(
    supplierInvoicesReducer,
    undefined,
    createSupplierInvoicesState,
  );
  const { editingInvoice, invoiceToDelete, isModalOpen, isDeleteConfirmOpen, formData } = state;

  const closeModal = useCallback(() => {
    dispatch({ type: 'closeModal' });
  }, []);

  const closeDeleteConfirm = useCallback(() => {
    dispatch({ type: 'deleteSuccess' });
  }, []);

  const patchForm = useCallback((patch: Partial<SupplierInvoice>) => {
    dispatch({ type: 'patchForm', patch });
  }, []);

  const openEditModal = useCallback((invoice: SupplierInvoice) => {
    dispatch({ type: 'openEdit', invoice });
  }, []);

  const confirmDelete = useCallback((invoice: SupplierInvoice) => {
    dispatch({ type: 'confirmDelete', invoice });
  }, []);

  const handleDelete = useCallback(async () => {
    if (!invoiceToDelete) return;
    await onDeleteInvoice(invoiceToDelete.id);
    dispatch({ type: 'deleteSuccess' });
  }, [invoiceToDelete, onDeleteInvoice]);

  const updateItem = useCallback(
    (index: number, field: keyof SupplierInvoiceItem, value: string | number | undefined) => {
      dispatch({ type: 'updateItem', index, field, value, products });
    },
    [products],
  );

  const removeItem = useCallback((index: number) => {
    dispatch({ type: 'removeItem', index });
  }, []);

  // Duration value entered in the line's chosen unit (issue #776). Stored canonically as whole
  // months; the Mese/Anno selector only changes how that value is displayed/entered. Routing
  // through updateItem keeps the reducer's total recompute in one place.
  const handleDurationValueChange = useCallback(
    (index: number, value: string) => {
      const unit = normalizeDurationUnit(formData.items?.[index]?.durationUnit);
      updateItem(
        index,
        'durationMonths',
        value === '' ? undefined : parseDurationValueToMonths(value, unit),
      );
    },
    [formData.items, updateItem],
  );

  const handleDurationUnitChange = useCallback(
    (index: number, newUnit: DurationUnit) => {
      const items = formData.items || [];
      const item = items[index];
      if (!item || normalizeDurationUnit(item.durationUnit) === newUnit) return;
      // 'na' (N/A) drops the multiplier to a single month — the value input is disabled and the line
      // never multiplies (issue #775). Recompute totals atomically so the summary stays in sync.
      const durationValue = getDurationInputValue(item);
      const durationMonths =
        newUnit === 'na' || durationValue === undefined
          ? undefined
          : durationValueToMonths(durationValue, newUnit);
      const nextItems = items.map((current, i) =>
        i === index ? { ...current, durationUnit: newUnit, durationMonths } : current,
      );
      dispatch({ type: 'patchForm', patch: { items: nextItems, ...calculateTotals(nextItems) } });
    },
    [formData.items],
  );

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (!editingInvoice) return;

      const totals = calculateTotals(formData.items || []);
      await onUpdateInvoice(editingInvoice.id, {
        ...formData,
        ...totals,
        amountPaid: Number(formData.amountPaid ?? 0),
        items: (formData.items || []).map((item) => ({
          ...item,
          quantity: Number(item.quantity ?? 0),
          unitPrice: Number(item.unitPrice ?? 0),
          discount: Number(item.discount ?? 0),
          ...normalizeDurationForSubmit(item),
        })),
      });

      dispatch({ type: 'submitSuccess' });
    },
    [editingInvoice, formData, onUpdateInvoice],
  );

  const totals = useMemo(() => calculateTotals(formData.items || []), [formData.items]);
  const balanceDue = Number(totals.total) - Number(formData.amountPaid || 0);
  const totalDiscount = useMemo(
    () =>
      (formData.items || []).reduce((sum, item) => {
        const lineSubtotal =
          Number(item.quantity ?? 0) *
          Number(item.unitPrice ?? 0) *
          getEffectiveDurationMonths(item);
        return sum + (lineSubtotal * Number(item.discount ?? 0)) / 100;
      }, 0),
    [formData.items],
  );
  const grossSubtotal = totals.subtotal + totalDiscount;

  const columns = useMemo(
    () => [
      {
        header: t('accounting:supplierInvoices.invoiceNumber'),
        id: 'id',
        accessorFn: (row: SupplierInvoice) => row.id,
        cell: ({ row }: { row: SupplierInvoice }) => (
          <span className="font-bold text-foreground">{row.id}</span>
        ),
      },
      {
        header: t('accounting:supplierInvoices.supplier'),
        id: 'supplierName',
        accessorFn: (row: SupplierInvoice) => row.supplierName,
        cell: ({ row }: { row: SupplierInvoice }) => {
          const isMuted = row.status === 'paid' || row.status === 'cancelled';

          return (
            <span className={`font-bold ${isMuted ? 'text-muted-foreground' : 'text-foreground'}`}>
              {row.supplierName}
            </span>
          );
        },
      },
      {
        header: t('common:labels.date'),
        id: 'issueDate',
        accessorFn: (row: SupplierInvoice) => formatDateOnlyForLocale(row.issueDate),
        cell: ({ row }: { row: SupplierInvoice }) => (
          <span className="text-sm text-muted-foreground">
            {formatDateOnlyForLocale(row.issueDate)}
          </span>
        ),
      },
      {
        header: t('accounting:supplierInvoices.dueDate'),
        id: 'dueDate',
        accessorFn: (row: SupplierInvoice) => formatDateOnlyForLocale(row.dueDate),
        cell: ({ row }: { row: SupplierInvoice }) => (
          <span className="text-sm text-muted-foreground">
            {formatDateOnlyForLocale(row.dueDate)}
          </span>
        ),
      },
      {
        header: t('common:labels.amount'),
        id: 'invoiceTotal',
        accessorFn: (row: SupplierInvoice) => Number(row.total),
        cell: ({ row }: { row: SupplierInvoice }) => (
          <span className="font-bold text-foreground">
            {formatDecimal(Number(row.total))} {currency}
          </span>
        ),
        filterFormat: (value: unknown) => formatDecimal(Number(value)),
      },
      {
        header: t('accounting:supplierInvoices.amountPaid'),
        id: 'amountPaid',
        accessorFn: (row: SupplierInvoice) => Number(row.amountPaid),
        cell: ({ row }: { row: SupplierInvoice }) => (
          <span className="font-bold text-emerald-600">
            {formatDecimal(Number(row.amountPaid))} {currency}
          </span>
        ),
        filterFormat: (value: unknown) => formatDecimal(Number(value)),
      },
      {
        header: t('accounting:supplierInvoices.balance'),
        id: 'balance',
        accessorFn: (row: SupplierInvoice) => Number(row.total) - Number(row.amountPaid || 0),
        cell: ({ row }: { row: SupplierInvoice }) => {
          const balance = Number(row.total) - Number(row.amountPaid || 0);
          return (
            <span className={`font-bold ${balance > 0 ? 'text-red-500' : 'text-emerald-600'}`}>
              {formatDecimal(balance)} {currency}
            </span>
          );
        },
        filterFormat: (value: unknown) => formatDecimal(Number(value)),
      },
      {
        header: t('accounting:supplierInvoices.status'),
        id: 'invoiceStatus',
        accessorFn: (row: SupplierInvoice) => getStatusLabel(row.status, t),
        className: 'whitespace-nowrap',
        headerClassName: 'min-w-[9rem]',
        cell: ({ row }: { row: SupplierInvoice }) => (
          <div className={row.status === 'paid' || row.status === 'cancelled' ? 'opacity-60' : ''}>
            <StatusBadge type={row.status as StatusType} label={getStatusLabel(row.status, t)} />
          </div>
        ),
      },
      {
        header: t('accounting:supplierInvoices.actionsColumn'),
        id: 'actions',
        className: 'whitespace-nowrap',
        headerClassName: 'min-w-[8rem]',
        disableSorting: true,
        disableFiltering: true,
        align: 'right' as const,
        cell: ({ row }: { row: SupplierInvoice }) => (
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
    [confirmDelete, currency, openEditModal, t],
  );

  return {
    balanceDue,
    closeDeleteConfirm,
    closeModal,
    columns,
    currency,
    editingInvoice,
    formData,
    grossSubtotal,
    handleDelete,
    handleDurationUnitChange,
    handleDurationValueChange,
    handleSubmit,
    invoices,
    invoiceToDelete,
    isDeleteConfirmOpen,
    isModalOpen,
    openEditModal,
    patchForm,
    productOptions,
    removeItem,
    statusOptions,
    supplierOptions,
    suppliers,
    t,
    totalDiscount,
    totals,
    updateItem,
  };
};

type SupplierInvoicesController = ReturnType<typeof useSupplierInvoicesController>;

const SupplierInvoicesView: React.FC<SupplierInvoicesViewProps> = (props) => {
  const controller = useSupplierInvoicesController(props);
  return <SupplierInvoicesLayout controller={controller} />;
};

const SupplierInvoicesLayout: React.FC<{ controller: SupplierInvoicesController }> = ({
  controller,
}) => (
  <div className="space-y-8">
    <SupplierInvoiceModal controller={controller} />
    <SupplierInvoiceDeleteDialog controller={controller} />
    <SupplierInvoicesHeader controller={controller} />
    <StandardTable<SupplierInvoice>
      title={controller.t('accounting:supplierInvoices.title')}
      data={controller.invoices}
      columns={controller.columns}
      defaultRowsPerPage={10}
      containerClassName="overflow-visible"
      rowClassName={(row: SupplierInvoice) =>
        row.status === 'paid' || row.status === 'cancelled'
          ? 'bg-muted text-muted-foreground'
          : 'hover:bg-muted/50'
      }
      onRowClick={(row: SupplierInvoice) => controller.openEditModal(row)}
    />
  </div>
);

const SupplierInvoicesHeader: React.FC<{ controller: SupplierInvoicesController }> = ({
  controller,
}) => (
  <div className="space-y-4">
    <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
      <div>
        <h2 className="text-2xl font-semibold text-foreground">
          {controller.t('accounting:supplierInvoices.title')}
        </h2>
        <p className="text-sm text-muted-foreground">
          {controller.t('accounting:supplierInvoices.subtitle')}
        </p>
      </div>
    </div>
  </div>
);

const SupplierInvoiceModal: React.FC<{ controller: SupplierInvoicesController }> = ({
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
              ? controller.t('accounting:supplierInvoices.editInvoice')
              : controller.t('accounting:supplierInvoices.addInvoice')}
          </ModalTitle>
          <ModalCloseButton onClick={controller.closeModal} />
        </ModalHeader>
        <ModalBody className="flex-1 space-y-5">
          <SupplierInvoiceDetailsSection controller={controller} />
          <SupplierInvoiceItemsSection controller={controller} />
          <SupplierInvoiceNotesSummarySection controller={controller} />
        </ModalBody>
        <ModalFooter>
          <Button type="button" variant="outline" onClick={controller.closeModal}>
            {controller.t('common:buttons.cancel')}
          </Button>
          <Button type="submit">
            {controller.editingInvoice
              ? controller.t('common:buttons.update')
              : controller.t('common:buttons.save')}
          </Button>
        </ModalFooter>
      </form>
    </ModalContent>
  </Modal>
);

const SupplierInvoiceSectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-primary">
    <span className="size-1.5 rounded-full bg-primary"></span>
    {children}
  </h4>
);

const SupplierInvoiceDetailsSection: React.FC<{ controller: SupplierInvoicesController }> = ({
  controller,
}) => (
  <div className="space-y-2">
    <SupplierInvoiceSectionTitle>
      {controller.t('accounting:supplierInvoices.invoiceDetails')}
    </SupplierInvoiceSectionTitle>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Field>
        <SelectControl
          id="supplier-invoice-supplier"
          options={controller.supplierOptions}
          value={controller.formData.supplierId || ''}
          onChange={(value) => {
            const supplier = controller.suppliers.find((item) => item.id === value);
            controller.patchForm({
              supplierId: value as string,
              supplierName: supplier?.name || '',
            });
          }}
          searchable={true}
          label={controller.t('accounting:supplierInvoices.supplier')}
          placeholder={controller.t('accounting:supplierInvoices.selectSupplier')}
          buttonClassName="h-9"
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="supplier-invoice-number" required>
          {controller.t('accounting:supplierInvoices.invoiceNumber')}
        </FieldLabel>
        <Input
          id="supplier-invoice-number"
          type="text"
          required
          value={controller.formData.id || ''}
          onChange={(event) => controller.patchForm({ id: event.target.value })}
          className="font-medium"
          placeholder="INV-XXXX"
        />
      </Field>
      <SupplierInvoiceDateField controller={controller} field="issueDate" />
      <SupplierInvoiceDateField controller={controller} field="dueDate" />
    </div>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Field>
        <SelectControl
          id="supplier-invoice-status"
          options={controller.statusOptions}
          value={controller.formData.status || 'draft'}
          onChange={(value) => controller.patchForm({ status: value as SupplierInvoice['status'] })}
          label={controller.t('accounting:supplierInvoices.status')}
          searchable={false}
          buttonClassName="h-9"
        />
      </Field>
    </div>
  </div>
);

const SupplierInvoiceDateField: React.FC<{
  controller: SupplierInvoicesController;
  field: 'issueDate' | 'dueDate';
}> = ({ controller, field }) => {
  const id = field === 'issueDate' ? 'supplier-invoice-issue-date' : 'supplier-invoice-due-date';
  const label =
    field === 'issueDate'
      ? controller.t('accounting:supplierInvoices.issueDate')
      : controller.t('accounting:supplierInvoices.dueDate');

  return (
    <Field>
      <FieldLabel htmlFor={id} required>
        {label}
      </FieldLabel>
      <DateField
        id={id}
        required
        value={controller.formData[field] || ''}
        onChange={(value) => controller.patchForm({ [field]: value })}
      />
    </Field>
  );
};

const SupplierInvoiceItemsSection: React.FC<{ controller: SupplierInvoicesController }> = ({
  controller,
}) => {
  const items = controller.formData.items || EMPTY_SUPPLIER_INVOICE_ITEMS;
  const getIndex = useMemo(
    () => createLineItemIndexResolver(controller.formData.items),
    [controller.formData.items],
  );
  const columns: Column<SupplierInvoiceItem>[] = [
    {
      id: 'product',
      header: controller.t('crm:quotes.productsServices'),
      minWidth: 244,
      accessorFn: (item) =>
        controller.productOptions.find((product) => product.id === item.productId)?.name || '',
      cell: ({ row }) => (
        <SupplierInvoiceItemProductField
          controller={controller}
          item={row}
          index={getIndex(row)}
          className="min-w-[220px]"
        />
      ),
    },
    {
      id: 'description',
      header: controller.t('common:labels.description'),
      minWidth: 244,
      accessorKey: 'description',
      cell: ({ row }) => (
        <SupplierInvoiceItemDescriptionField
          controller={controller}
          item={row}
          index={getIndex(row)}
          className="min-w-[220px]"
        />
      ),
    },
    {
      id: 'quantity',
      header: controller.t('common:labels.quantity'),
      minWidth: 174,
      accessorKey: 'quantity',
      align: 'right',
      cell: ({ row }) => (
        <div className="min-w-[150px]">
          <SupplierInvoiceItemQuantityField
            controller={controller}
            item={row}
            index={getIndex(row)}
          />
        </div>
      ),
    },
    {
      id: 'unitPrice',
      header: controller.t('crm:internalListing.salePrice'),
      accessorKey: 'unitPrice',
      align: 'right',
      cell: ({ row }) => (
        <div className="min-w-[130px]">
          <SupplierInvoiceItemPriceField controller={controller} item={row} index={getIndex(row)} />
        </div>
      ),
    },
    {
      id: 'discount',
      header: controller.t('accounting:supplierOrders.discount'),
      accessorFn: (item) => item.discount || 0,
      align: 'right',
      cell: ({ row }) => (
        <div className="min-w-[110px]">
          <SupplierInvoiceItemDiscountField
            controller={controller}
            item={row}
            index={getIndex(row)}
          />
        </div>
      ),
    },
    {
      id: 'duration',
      header: controller.t('accounting:supplierInvoices.durationColumn', {
        defaultValue: 'Duration',
      }),
      minWidth: 174,
      accessorFn: (item) => getEffectiveDurationMonths(item),
      align: 'right',
      cell: ({ row }) => (
        <div className="min-w-[150px]">
          <SupplierInvoiceItemDurationField
            controller={controller}
            index={getIndex(row)}
            durationUnit={normalizeDurationUnit(row.durationUnit)}
            durationValue={getDurationInputValue(row)}
          />
        </div>
      ),
    },
    {
      id: 'total',
      header: controller.t('common:labels.total'),
      accessorFn: getSupplierInvoiceLineTotal,
      align: 'right',
      cell: ({ row }) => (
        <SupplierInvoiceItemTotalField
          controller={controller}
          lineTotal={getSupplierInvoiceLineTotal(row)}
          className="min-w-[120px]"
        />
      ),
    },
    {
      id: 'actions',
      header: controller.t('common:labels.actions'),
      align: 'right',
      cell: ({ row }) => (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => controller.removeItem(getIndex(row))}
          className="shrink-0 text-muted-foreground hover:text-destructive"
        >
          <i className="fa-solid fa-trash-can" aria-hidden="true"></i>
          <span className="sr-only">{controller.t('common:buttons.delete')}</span>
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-2">
      <SupplierInvoiceSectionTitle>
        {controller.t('accounting:supplierInvoices.items')}
      </SupplierInvoiceSectionTitle>
      <StandardTable<SupplierInvoiceItem>
        title={controller.t('accounting:supplierInvoices.items')}
        persistenceKey="accounting.supplierInvoices.items"
        allowColumnHiding={false}
        data={items}
        columns={columns}
        defaultRowsPerPage={5}
        minBodyRows={0}
        shouldBypassFilters={(item) => !isPositiveFiniteNumber(item.quantity)}
        tableContainerClassName="overflow-x-auto"
        emptyState={
          <div className="py-8 text-sm text-muted-foreground">
            {controller.t('accounting:supplierInvoices.noItems')}
          </div>
        }
      />
    </div>
  );
};

const SupplierInvoiceItemProductField: React.FC<{
  controller: SupplierInvoicesController;
  item: SupplierInvoiceItem;
  index: number;
  className?: string;
}> = ({ controller, item, index, className }) => (
  <div className={className}>
    <SelectControl
      options={controller.productOptions}
      value={item.productId || ''}
      onChange={(value) => controller.updateItem(index, 'productId', value as string)}
      searchable={true}
      buttonClassName="h-9"
    />
  </div>
);

const SupplierInvoiceItemDescriptionField: React.FC<{
  controller: SupplierInvoicesController;
  item: SupplierInvoiceItem;
  index: number;
  className?: string;
}> = ({ controller, item, index, className }) => (
  <div className={className}>
    <Input
      type="text"
      value={item.description}
      placeholder={controller.t('accounting:supplierInvoices.descriptionPlaceholder')}
      onChange={(event) => controller.updateItem(index, 'description', event.target.value)}
    />
  </div>
);

const SupplierInvoiceItemQuantityField: React.FC<{
  controller: SupplierInvoicesController;
  item: SupplierInvoiceItem;
  index: number;
  className?: string;
  inputClassName?: string;
}> = ({
  controller,
  item,
  index,
  className = 'space-y-1',
  inputClassName = SUPPLIER_INVOICE_ITEM_NUMBER_INPUT_CLASSNAME,
}) => (
  <div className={className}>
    <FieldLabel className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground lg:hidden">
      {controller.t('common:labels.quantity')}
    </FieldLabel>
    <div className="flex h-9 items-center justify-end gap-1">
      <ValidatedNumberInput
        value={item.quantity}
        placeholder="0,00"
        onValueChange={(value) =>
          controller.updateItem(index, 'quantity', value === '' ? undefined : Number(value))
        }
        className={inputClassName}
      />
      <span className="shrink-0 text-xs font-medium text-muted-foreground">/</span>
      <span className="shrink-0 text-xs font-medium text-muted-foreground">
        {controller.t('accounting:clientsInvoices.unit')}
      </span>
    </div>
  </div>
);

const SupplierInvoiceItemPriceField: React.FC<{
  controller: SupplierInvoicesController;
  item: SupplierInvoiceItem;
  index: number;
  className?: string;
  inputClassName?: string;
}> = ({
  controller,
  item,
  index,
  className = 'space-y-1',
  inputClassName = SUPPLIER_INVOICE_ITEM_NUMBER_INPUT_CLASSNAME,
}) => (
  <div className={className}>
    <FieldLabel className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground lg:hidden">
      {controller.t('crm:internalListing.salePrice')}
    </FieldLabel>
    <div className="flex h-9 items-center justify-end gap-1">
      <ValidatedNumberInput
        value={item.unitPrice}
        placeholder="0,00"
        formatDecimals={2}
        onValueChange={(value) =>
          controller.updateItem(index, 'unitPrice', value === '' ? undefined : Number(value))
        }
        className={inputClassName}
      />
      <span className="shrink-0 text-xs font-medium text-muted-foreground">
        {controller.currency}
      </span>
    </div>
  </div>
);

const SupplierInvoiceItemDiscountField: React.FC<{
  controller: SupplierInvoicesController;
  item: SupplierInvoiceItem;
  index: number;
  className?: string;
  inputClassName?: string;
}> = ({
  controller,
  item,
  index,
  className = 'space-y-1',
  inputClassName = SUPPLIER_INVOICE_ITEM_NUMBER_INPUT_CLASSNAME,
}) => (
  <div className={className}>
    <FieldLabel className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground lg:hidden">
      {controller.t('accounting:supplierOrders.discount')}
    </FieldLabel>
    <div className="flex h-9 items-center justify-end gap-1">
      <ValidatedNumberInput
        value={item.discount}
        placeholder="0,00"
        formatDecimals={2}
        onValueChange={(value) =>
          controller.updateItem(index, 'discount', value === '' ? undefined : Number(value))
        }
        className={inputClassName}
      />
      <span className="shrink-0 text-xs font-medium text-muted-foreground">%</span>
    </div>
  </div>
);

const SupplierInvoiceItemDurationField: React.FC<{
  controller: SupplierInvoicesController;
  index: number;
  durationUnit: DurationUnit;
  durationValue?: number;
  className?: string;
  inputClassName?: string;
}> = ({
  controller,
  index,
  durationUnit,
  durationValue,
  className = 'space-y-1',
  inputClassName = SUPPLIER_INVOICE_ITEM_NUMBER_INPUT_CLASSNAME,
}) => (
  <div className={className}>
    <FieldLabel className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground lg:hidden">
      {controller.t('accounting:supplierInvoices.durationColumn', {
        defaultValue: 'Duration',
      })}
    </FieldLabel>
    <div className="flex h-9 items-center justify-end gap-1">
      <ValidatedNumberInput
        step="1"
        min="1"
        placeholder="0"
        value={durationValue}
        disabled={durationUnit === 'na'}
        onValueChange={(value) => controller.handleDurationValueChange(index, value)}
        className={inputClassName}
      />
      <span className="shrink-0 text-xs font-medium text-muted-foreground">/</span>
      <DurationUnitSelector
        value={durationUnit}
        onChange={(value) => controller.handleDurationUnitChange(index, value)}
        count={durationValue ?? 0}
        i18nPrefix="accounting:supplierInvoices"
      />
    </div>
  </div>
);

const SupplierInvoiceItemTotalField: React.FC<{
  controller: SupplierInvoicesController;
  lineTotal: number;
  className: string;
}> = ({ controller, lineTotal, className }) => (
  <div className={className}>
    <FieldLabel className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground lg:hidden">
      {controller.t('common:labels.total')}
    </FieldLabel>
    <div className="flex items-center justify-end whitespace-nowrap px-3 py-2 text-sm font-semibold text-foreground">
      {formatDecimal(lineTotal)} {controller.currency}
    </div>
  </div>
);

const SupplierInvoiceNotesSummarySection: React.FC<{
  controller: SupplierInvoicesController;
}> = ({ controller }) => (
  <div className="flex flex-col gap-4 border-t border-border pt-4 md:flex-row">
    <Field className="md:w-2/3">
      <SupplierInvoiceSectionTitle>
        {controller.t('accounting:supplierInvoices.notes')}
      </SupplierInvoiceSectionTitle>
      <FieldLabel htmlFor="supplier-invoice-notes" className="sr-only">
        {controller.t('accounting:supplierInvoices.notes')}
      </FieldLabel>
      <Textarea
        id="supplier-invoice-notes"
        rows={4}
        value={controller.formData.notes || ''}
        onChange={(event) => controller.patchForm({ notes: event.target.value })}
        className="min-h-28 resize-none"
        placeholder={controller.t('accounting:supplierInvoices.notesPlaceholder')}
      />
    </Field>
    <div className="space-y-2 md:w-1/3">
      <SupplierInvoiceSectionTitle>
        {controller.t('accounting:supplierInvoices.summary', { defaultValue: 'Summary' })}
      </SupplierInvoiceSectionTitle>
      <CostSummaryPanel
        currency={controller.currency}
        subtotal={controller.grossSubtotal}
        total={controller.totals.total}
        subtotalLabel={controller.t('accounting:supplierInvoices.subtotal')}
        totalLabel={controller.t('accounting:supplierInvoices.total')}
        discountRow={
          controller.totalDiscount > 0
            ? {
                label: controller.t('accounting:supplierInvoices.totalDiscount'),
                amount: controller.totalDiscount,
              }
            : undefined
        }
        amountPaid={{
          label: controller.t('accounting:supplierInvoices.amountPaid'),
          value: controller.formData.amountPaid || 0,
          onChange: (value) =>
            controller.patchForm({ amountPaid: value === '' ? 0 : Number(value) }),
        }}
        balanceDue={{
          label: controller.t('accounting:supplierInvoices.balanceDue'),
          amount: controller.balanceDue,
          colorClass: controller.balanceDue > 0 ? 'text-red-500' : 'text-emerald-600',
        }}
      />
    </div>
  </div>
);

const SupplierInvoiceDeleteDialog: React.FC<{ controller: SupplierInvoicesController }> = ({
  controller,
}) => (
  <DeleteConfirmModal
    isOpen={controller.isDeleteConfirmOpen}
    onClose={controller.closeDeleteConfirm}
    onConfirm={() => {
      void controller.handleDelete();
    }}
    title={controller.t('accounting:supplierInvoices.deleteTitle')}
    description={`${controller.invoiceToDelete?.supplierName ?? ''} · ${
      controller.invoiceToDelete?.id ?? ''
    }`}
  />
);

export default SupplierInvoicesView;
