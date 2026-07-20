import { ChevronDown, FileSpreadsheet, Plus, Rows3 } from 'lucide-react';
import type React from 'react';
import { useCallback, useMemo, useReducer } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type {
  BulkSupplierCreateInput,
  BulkSupplierCreateResponse,
  Supplier,
  SupplierContact,
  SupplierSaleOrder,
} from '../../types';
import { formatInsertDate } from '../../utils/date';
import {
  formatDecimal,
  getDiscountedLineTotal,
  getDocumentDiscountAmount,
} from '../../utils/numbers';
import { hasScopedActionPermission } from '../../utils/permissions';
import { toastError } from '../../utils/toast';
import DeleteConfirmModal from '../shared/DeleteConfirmModal';
import Modal from '../shared/Modal';
import {
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '../shared/ModalLayout';
import StandardTable, { type Column } from '../shared/StandardTable';
import StatusBadge from '../shared/StatusBadge';
import {
  SupplierBulkCreateDialog,
  SupplierWorkbookImportDialog,
} from './SupplierBulkCreateDialogs';
import SupplierContactsSection, { type SupplierContactRow } from './SupplierContactsSection';

export interface SuppliersViewProps {
  suppliers: Supplier[];
  supplierOrders: SupplierSaleOrder[];
  currency: string;
  onAddSupplier: (supplierData: Partial<Supplier>) => Promise<void>;
  onAddSuppliersBulk: (suppliers: BulkSupplierCreateInput[]) => Promise<BulkSupplierCreateResponse>;
  onUpdateSupplier: (id: string, updates: Partial<Supplier>) => Promise<void>;
  onDeleteSupplier: (id: string) => Promise<void>;
  permissions: string[];
}

const calculateOrderTotal = (order: SupplierSaleOrder): number => {
  const subtotal = order.items.reduce((sum, item) => sum + getDiscountedLineTotal(item), 0);
  const discount = Number(order.discount) || 0;
  const discountAmount = getDocumentDiscountAmount(subtotal, discount, order.discountType);
  return subtotal - discountAmount;
};

const EMPTY_CONTACT: SupplierContact = {
  fullName: '',
  role: '',
  email: '',
  phone: '',
};

const normalizeContact = (contact?: SupplierContact | null): SupplierContact => ({
  fullName: contact?.fullName?.trim() || '',
  role: contact?.role?.trim() || '',
  email: contact?.email?.trim() || '',
  phone: contact?.phone?.trim() || '',
});

const normalizeContacts = (contacts?: SupplierContact[]) =>
  (contacts ?? []).map((contact) => normalizeContact(contact));

const buildLegacyPrimaryContact = (
  supplier: Pick<Supplier, 'contactName' | 'email' | 'phone'>,
): SupplierContact | null => {
  const fullName = supplier.contactName?.trim() || '';
  if (!fullName) return null;
  return {
    fullName,
    role: '',
    email: supplier.email?.trim() || '',
    phone: supplier.phone?.trim() || '',
  };
};

const hydrateContactsForEdit = (
  supplier: Pick<Supplier, 'contactName' | 'email' | 'phone'>,
  contacts: SupplierContact[],
): SupplierContact[] => {
  const legacyPrimary = buildLegacyPrimaryContact(supplier);
  if (!legacyPrimary) return contacts;
  if (contacts.length === 0) return [legacyPrimary];
  const [firstContact, ...otherContacts] = contacts;
  if (!firstContact) return [legacyPrimary];
  return [
    {
      ...firstContact,
      fullName: firstContact.fullName || legacyPrimary.fullName,
      email: firstContact.email || legacyPrimary.email,
      phone: firstContact.phone || legacyPrimary.phone,
    },
    ...otherContacts,
  ];
};

const createEmptySupplierForm = (): Partial<Supplier> => ({
  name: '',
  supplierCode: '',
  contacts: [],
  address: '',
  vatNumber: '',
  taxCode: '',
  paymentTerms: '',
  notes: '',
});

const createSupplierForm = (supplier: Supplier): Partial<Supplier> => ({
  name: supplier.name || '',
  supplierCode: supplier.supplierCode || '',
  contacts: hydrateContactsForEdit(supplier, normalizeContacts(supplier.contacts)),
  address: supplier.address || '',
  vatNumber: supplier.vatNumber || '',
  taxCode: supplier.taxCode || '',
  paymentTerms: supplier.paymentTerms || '',
  notes: supplier.notes || '',
});

type SuppliersViewState = {
  isModalOpen: boolean;
  editingSupplier: Supplier | null;
  contactsExpanded: boolean;
  contactDraft: SupplierContact | null;
  editingContactIndex: number | null;
  contactDraftError: string | null;
  contactsTouched: boolean;
  isDeleteConfirmOpen: boolean;
  isBulkCreateModalOpen: boolean;
  isWorkbookImportModalOpen: boolean;
  supplierToDelete: Supplier | null;
  errors: Record<string, string>;
  formData: Partial<Supplier>;
};

type SuppliersViewAction =
  | { type: 'openAdd' }
  | { type: 'openEdit'; supplier: Supplier }
  | { type: 'closeModal' }
  | { type: 'patchForm'; patch: Partial<Supplier> }
  | { type: 'toggleContactsExpanded' }
  | { type: 'addContact' }
  | { type: 'editContact'; contact: SupplierContact; index: number }
  | { type: 'patchContactDraft'; field: keyof SupplierContact; value: string }
  | { type: 'cancelContactDraft' }
  | { type: 'setContactDraftError'; error: string | null }
  | { type: 'setContacts'; contacts: SupplierContact[] }
  | { type: 'removeContact'; index: number }
  | { type: 'clearError'; field: string }
  | { type: 'setErrors'; errors: Record<string, string> }
  | { type: 'submitSuccess' }
  | { type: 'confirmDelete'; supplier: Supplier }
  | { type: 'deleteSuccess' }
  | { type: 'setBulkCreateModalOpen'; value: boolean }
  | { type: 'setWorkbookImportModalOpen'; value: boolean };

const createSuppliersViewState = (): SuppliersViewState => ({
  isModalOpen: false,
  editingSupplier: null,
  contactsExpanded: false,
  contactDraft: null,
  editingContactIndex: null,
  contactDraftError: null,
  contactsTouched: false,
  isDeleteConfirmOpen: false,
  isBulkCreateModalOpen: false,
  isWorkbookImportModalOpen: false,
  supplierToDelete: null,
  errors: {},
  formData: createEmptySupplierForm(),
});

const suppliersViewReducer = (
  state: SuppliersViewState,
  action: SuppliersViewAction,
): SuppliersViewState => {
  switch (action.type) {
    case 'openAdd':
      return {
        ...state,
        isModalOpen: true,
        editingSupplier: null,
        contactsExpanded: false,
        contactDraft: null,
        editingContactIndex: null,
        contactDraftError: null,
        contactsTouched: false,
        errors: {},
        formData: createEmptySupplierForm(),
      };
    case 'openEdit': {
      const formData = createSupplierForm(action.supplier);
      return {
        ...state,
        isModalOpen: true,
        editingSupplier: action.supplier,
        contactsExpanded: normalizeContacts(formData.contacts).length > 1,
        contactDraft: null,
        editingContactIndex: null,
        contactDraftError: null,
        contactsTouched: false,
        errors: {},
        formData,
      };
    }
    case 'closeModal':
      return {
        ...state,
        isModalOpen: false,
        contactsExpanded: false,
        contactDraft: null,
        editingContactIndex: null,
        contactDraftError: null,
        errors: {},
      };
    case 'patchForm':
      return { ...state, formData: { ...state.formData, ...action.patch } };
    case 'toggleContactsExpanded':
      return { ...state, contactsExpanded: !state.contactsExpanded };
    case 'addContact':
      return {
        ...state,
        contactDraft: { ...EMPTY_CONTACT },
        editingContactIndex: null,
        contactDraftError: null,
        contactsExpanded: true,
      };
    case 'editContact':
      return {
        ...state,
        contactDraft: { ...action.contact },
        editingContactIndex: action.index,
        contactDraftError: null,
        contactsExpanded: true,
      };
    case 'patchContactDraft':
      return {
        ...state,
        contactDraft: {
          ...(state.contactDraft ?? { ...EMPTY_CONTACT }),
          [action.field]: action.value,
        },
      };
    case 'cancelContactDraft':
      return {
        ...state,
        contactDraft: null,
        editingContactIndex: null,
        contactDraftError: null,
      };
    case 'setContactDraftError':
      return { ...state, contactDraftError: action.error };
    case 'setContacts':
      return {
        ...state,
        formData: { ...state.formData, contacts: action.contacts },
        contactsTouched: true,
      };
    case 'removeContact':
      return {
        ...state,
        formData: {
          ...state.formData,
          contacts: normalizeContacts(state.formData.contacts).filter(
            (_, index) => index !== action.index,
          ),
        },
        contactsTouched: true,
        contactDraft: null,
        editingContactIndex: null,
        contactDraftError: null,
      };
    case 'clearError':
      if (!state.errors[action.field]) return state;
      return { ...state, errors: { ...state.errors, [action.field]: '' } };
    case 'setErrors':
      return { ...state, errors: action.errors };
    case 'submitSuccess':
      return { ...state, isModalOpen: false };
    case 'confirmDelete':
      return { ...state, supplierToDelete: action.supplier, isDeleteConfirmOpen: true };
    case 'deleteSuccess':
      return { ...state, isDeleteConfirmOpen: false, supplierToDelete: null };
    case 'setBulkCreateModalOpen':
      return { ...state, isBulkCreateModalOpen: action.value };
    case 'setWorkbookImportModalOpen':
      return { ...state, isWorkbookImportModalOpen: action.value };
    default:
      return state;
  }
};

type SupplierFormModalProps = {
  modalState: Pick<
    SuppliersViewState,
    | 'isModalOpen'
    | 'editingSupplier'
    | 'errors'
    | 'formData'
    | 'contactsExpanded'
    | 'contactDraft'
    | 'editingContactIndex'
    | 'contactDraftError'
  >;
  canSubmit: boolean;
  onSubmit: (event: React.FormEvent) => void;
  onClose: () => void;
  dispatch: React.Dispatch<SuppliersViewAction>;
};

type SupplierIdentitySectionProps = {
  formData: Partial<Supplier>;
  errors: Record<string, string>;
  dispatch: React.Dispatch<SuppliersViewAction>;
};

const SupplierIdentitySection: React.FC<SupplierIdentitySectionProps> = ({
  formData,
  errors,
  dispatch,
}) => {
  const { t } = useTranslation(['crm', 'common']);

  return (
    <div className="space-y-4">
      <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-primary">
        <span className="size-1.5 rounded-full bg-primary"></span>
        {t('crm:suppliers.identifyingData')}
      </h4>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field data-invalid={Boolean(errors.supplierCode)}>
          <FieldLabel htmlFor="supplier-code" required>
            {t('crm:suppliers.code')}
          </FieldLabel>
          <Input
            id="supplier-code"
            type="text"
            value={formData.supplierCode}
            onChange={(event) => {
              dispatch({ type: 'patchForm', patch: { supplierCode: event.target.value } });
              dispatch({ type: 'clearError', field: 'supplierCode' });
            }}
            placeholder={t('crm:suppliers.codePlaceholder')}
            aria-invalid={Boolean(errors.supplierCode)}
          />
          <FieldError className="text-xs">{errors.supplierCode}</FieldError>
        </Field>
        <Field data-invalid={Boolean(errors.name)}>
          <FieldLabel htmlFor="supplier-name" required>
            {t('crm:suppliers.name')}
          </FieldLabel>
          <Input
            id="supplier-name"
            type="text"
            value={formData.name}
            onChange={(event) => {
              dispatch({ type: 'patchForm', patch: { name: event.target.value } });
              dispatch({ type: 'clearError', field: 'name' });
            }}
            placeholder={t('crm:suppliers.namePlaceholder')}
            aria-invalid={Boolean(errors.name)}
          />
          <FieldError className="text-xs">{errors.name}</FieldError>
        </Field>
      </div>
    </div>
  );
};

const SupplierFormModal: React.FC<SupplierFormModalProps> = ({
  modalState,
  canSubmit,
  onSubmit,
  onClose,
  dispatch,
}) => {
  const { t } = useTranslation(['crm', 'common']);
  const {
    isModalOpen,
    editingSupplier,
    errors,
    formData,
    contactsExpanded,
    contactDraft,
    editingContactIndex,
    contactDraftError,
  } = modalState;

  const updateContactDraft = useCallback(
    (field: keyof SupplierContact, value: string) => {
      dispatch({ type: 'patchContactDraft', field, value });
      if (contactDraftError) dispatch({ type: 'setContactDraftError', error: null });
    },
    [contactDraftError, dispatch],
  );

  const saveContactDraft = useCallback(() => {
    if (!contactDraft) return;
    const normalizedDraft = normalizeContact(contactDraft);
    if (!normalizedDraft.fullName) {
      dispatch({
        type: 'setContactDraftError',
        error: t('common:validation.required'),
      });
      return;
    }

    const contacts = normalizeContacts(formData.contacts);
    const nextContacts =
      editingContactIndex === null
        ? [...contacts, normalizedDraft]
        : contacts.map((contact, index) =>
            index === editingContactIndex ? normalizedDraft : contact,
          );
    dispatch({ type: 'setContacts', contacts: nextContacts });
    dispatch({ type: 'cancelContactDraft' });
  }, [contactDraft, dispatch, editingContactIndex, formData.contacts, t]);

  const editContact = useCallback(
    (index: number) => {
      const contact = normalizeContacts(formData.contacts)[index];
      if (contact) dispatch({ type: 'editContact', contact, index });
    },
    [dispatch, formData.contacts],
  );

  const removeContact = useCallback(
    (index: number) => dispatch({ type: 'removeContact', index }),
    [dispatch],
  );

  const contactRows = normalizeContacts(formData.contacts).map((contact, contactIndex) => ({
    ...contact,
    contactIndex,
  }));

  const contactColumns = useMemo<Column<SupplierContactRow>[]>(
    () => [
      {
        header: t('crm:suppliers.fullName'),
        accessorKey: 'fullName',
        disableFiltering: true,
        cell: ({ row }) => (
          <span className="font-semibold text-foreground">{row.fullName || '-'}</span>
        ),
      },
      {
        header: t('crm:suppliers.role'),
        accessorKey: 'role',
        disableFiltering: true,
        cell: ({ row }) => <span className="text-xs text-muted-foreground">{row.role || '-'}</span>,
      },
      {
        header: t('crm:suppliers.email'),
        accessorKey: 'email',
        disableFiltering: true,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">{row.email || '-'}</span>
        ),
      },
      {
        header: t('crm:suppliers.phone'),
        accessorKey: 'phone',
        disableFiltering: true,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">{row.phone || '-'}</span>
        ),
      },
      {
        header: t('common:labels.actions'),
        id: 'actions',
        disableSorting: true,
        disableFiltering: true,
        sticky: 'right',
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={(event) => {
                    event.stopPropagation();
                    editContact(row.contactIndex);
                  }}
                  aria-label={t('common:buttons.edit')}
                  className="text-muted-foreground hover:text-primary"
                >
                  <i className="fa-solid fa-pen" aria-hidden="true"></i>
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('common:buttons.edit')}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={(event) => {
                    event.stopPropagation();
                    removeContact(row.contactIndex);
                  }}
                  aria-label={t('common:buttons.delete')}
                  className="text-destructive hover:text-destructive"
                >
                  <i className="fa-solid fa-trash" aria-hidden="true"></i>
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('common:buttons.delete')}</TooltipContent>
            </Tooltip>
          </div>
        ),
      },
    ],
    [editContact, removeContact, t],
  );

  return (
    <Modal isOpen={isModalOpen} onClose={onClose}>
      <ModalContent size="2xl" className="max-h-[90vh]">
        <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col" noValidate>
          <ModalHeader>
            <ModalTitle className="gap-3">
              <span className="flex size-10 items-center justify-center rounded-md bg-muted text-primary">
                <i
                  className={`fa-solid ${editingSupplier ? 'fa-pen-to-square' : 'fa-plus'}`}
                  aria-hidden="true"
                ></i>
              </span>
              {editingSupplier ? t('crm:suppliers.editSupplier') : t('crm:suppliers.addSupplier')}
            </ModalTitle>
            <ModalCloseButton onClick={onClose} />
          </ModalHeader>

          <ModalBody className="flex-1 space-y-8">
            <SupplierIdentitySection formData={formData} errors={errors} dispatch={dispatch} />

            <SupplierContactsSection
              address={formData.address}
              contactsExpanded={contactsExpanded}
              contactDraft={contactDraft}
              editingContactIndex={editingContactIndex}
              contactDraftError={contactDraftError}
              contactRows={contactRows}
              contactColumns={contactColumns}
              onAddressChange={(address) => dispatch({ type: 'patchForm', patch: { address } })}
              onToggleContacts={() => dispatch({ type: 'toggleContactsExpanded' })}
              onAddContact={() => dispatch({ type: 'addContact' })}
              onUpdateContactDraft={updateContactDraft}
              onCancelContactDraft={() => dispatch({ type: 'cancelContactDraft' })}
              onSaveContactDraft={saveContactDraft}
            />

            <div className="space-y-4">
              <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-primary">
                <span className="size-1.5 rounded-full bg-primary"></span>
                {t('crm:suppliers.adminFiscal')}
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field data-invalid={Boolean(errors.vatNumber)}>
                  <FieldLabel htmlFor="supplier-vat-number" required={!editingSupplier}>
                    {t('crm:suppliers.vatNumber')}
                  </FieldLabel>
                  <Input
                    id="supplier-vat-number"
                    type="text"
                    value={formData.vatNumber}
                    onChange={(e) => {
                      dispatch({ type: 'patchForm', patch: { vatNumber: e.target.value } });
                      dispatch({ type: 'clearError', field: 'vatNumber' });
                    }}
                    placeholder={t('crm:suppliers.vatPlaceholder')}
                    aria-invalid={Boolean(errors.vatNumber)}
                  />
                  <FieldError className="text-xs">{errors.vatNumber}</FieldError>
                </Field>
                <Field>
                  <FieldLabel htmlFor="supplier-tax-code">{t('crm:suppliers.taxCode')}</FieldLabel>
                  <Input
                    id="supplier-tax-code"
                    type="text"
                    value={formData.taxCode}
                    onChange={(e) =>
                      dispatch({ type: 'patchForm', patch: { taxCode: e.target.value } })
                    }
                    placeholder={t('crm:suppliers.taxCodePlaceholder')}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="supplier-payment-terms">
                    {t('crm:suppliers.paymentTerms')}
                  </FieldLabel>
                  <Input
                    id="supplier-payment-terms"
                    type="text"
                    value={formData.paymentTerms}
                    onChange={(e) =>
                      dispatch({ type: 'patchForm', patch: { paymentTerms: e.target.value } })
                    }
                    placeholder={t('crm:suppliers.paymentTermsPlaceholder')}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="supplier-notes">{t('crm:suppliers.notes')}</FieldLabel>
                  <Input
                    id="supplier-notes"
                    type="text"
                    value={formData.notes}
                    onChange={(e) =>
                      dispatch({ type: 'patchForm', patch: { notes: e.target.value } })
                    }
                    placeholder={t('crm:suppliers.notesPlaceholder')}
                  />
                </Field>
              </div>
            </div>

            {errors.general && (
              <div className="flex items-center gap-3 rounded-md border border-destructive/30 bg-destructive/10 p-4 text-destructive">
                <i className="fa-solid fa-circle-exclamation text-lg" aria-hidden="true"></i>
                <p className="text-sm font-bold">{errors.general}</p>
              </div>
            )}
          </ModalBody>

          <ModalFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('common:buttons.cancel')}
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {editingSupplier ? t('common:buttons.update') : t('common:buttons.save')}
            </Button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  );
};

type SuppliersTableProps = {
  suppliers: Supplier[];
  supplierOrders: SupplierSaleOrder[];
  currency: string;
  canUpdateSuppliers: boolean;
  canDeleteSuppliers: boolean;
  onEditSupplier: (supplier: Supplier) => void;
  onConfirmDelete: (supplier: Supplier) => void;
  onStatusUpdate: (id: string, updates: Partial<Supplier>) => Promise<void>;
};

const SuppliersTable: React.FC<SuppliersTableProps> = ({
  suppliers,
  supplierOrders,
  currency,
  canUpdateSuppliers,
  canDeleteSuppliers,
  onEditSupplier,
  onConfirmDelete,
  onStatusUpdate,
}) => {
  const { t, i18n } = useTranslation(['crm', 'common']);
  const columns = useMemo<Column<Supplier>[]>(
    () => [
      {
        header: t('crm:suppliers.tableHeaders.name'),
        accessorKey: 'name',
        cell: ({ row }) => (
          <span
            className={`font-semibold whitespace-nowrap ${row.isDisabled ? 'line-through text-zinc-400' : 'text-zinc-800'}`}
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
            <span className="text-[10px] font-black bg-zinc-100 text-zinc-500 px-2 py-0.5 rounded uppercase">
              {row.supplierCode}
            </span>
          ) : null,
      },
      {
        header: t('crm:suppliers.tableHeaders.insertDate'),
        id: 'createdAt',
        accessorFn: (row) => row.createdAt ?? 0,
        cell: ({ row }) =>
          row.createdAt ? (
            <span className="text-xs text-slate-500 whitespace-nowrap">
              {formatInsertDate(row.createdAt, i18n.language)}
            </span>
          ) : (
            <span className="text-xs text-zinc-400">-</span>
          ),
        filterFormat: (value) => {
          const timestamp = typeof value === 'number' ? value : Number(value);
          return Number.isFinite(timestamp) && timestamp > 0
            ? formatInsertDate(timestamp, i18n.language)
            : '-';
        },
      },
      {
        header: t('crm:suppliers.tableHeaders.contactName'),
        accessorKey: 'contactName',
        cell: ({ row }) => <span className="text-xs text-zinc-600">{row.contactName || '-'}</span>,
      },
      {
        header: t('crm:suppliers.tableHeaders.email'),
        accessorKey: 'email',
        cell: ({ row }) => <span className="text-xs text-zinc-600">{row.email || '-'}</span>,
      },
      {
        header: t('crm:suppliers.tableHeaders.phone'),
        accessorKey: 'phone',
        cell: ({ row }) => <span className="text-xs text-zinc-600">{row.phone || '-'}</span>,
      },
      {
        header: t('crm:suppliers.tableHeaders.vat'),
        accessorKey: 'vatNumber',
        cell: ({ row }) => (
          <span className="font-mono text-xs text-zinc-400">{row.vatNumber || '-'}</span>
        ),
      },
      {
        header: t('crm:suppliers.tableHeaders.taxCode'),
        accessorKey: 'taxCode',
        cell: ({ row }) => (
          <span className="font-mono text-xs text-zinc-400">{row.taxCode || '-'}</span>
        ),
      },
      {
        header: t('crm:suppliers.tableHeaders.totalOrders'),
        id: 'totalOrders',
        accessorFn: (row: Supplier) =>
          supplierOrders
            .filter((order) => order.supplierId === row.id && order.status === 'sent')
            .reduce((total, order) => total + calculateOrderTotal(order), 0),
        align: 'right',
        cell: (info) => {
          const totalValue = info.value as number;
          return (
            <span
              className={`text-xs font-semibold whitespace-nowrap ${
                totalValue > 0 ? 'text-emerald-700' : 'text-zinc-400'
              }`}
            >
              {formatDecimal(totalValue)} {currency}
            </span>
          );
        },
        filterFormat: (value: unknown) => formatDecimal(value as number),
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
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!canUpdateSuppliers) return;
                      void onStatusUpdate(row.id, { isDisabled: !row.isDisabled });
                    }}
                    disabled={!canUpdateSuppliers}
                    aria-label={
                      row.isDisabled ? t('common:buttons.enable') : t('crm:suppliers.disable')
                    }
                    className={`p-2 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                      row.isDisabled
                        ? 'text-praetor hover:bg-zinc-100'
                        : 'text-amber-700 hover:text-amber-600 hover:bg-amber-50'
                    }`}
                  >
                    <i className={`fa-solid ${row.isDisabled ? 'fa-rotate-left' : 'fa-ban'}`}></i>
                  </button>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {row.isDisabled ? t('common:buttons.enable') : t('crm:suppliers.disable')}
              </TooltipContent>
            </Tooltip>
            {canDeleteSuppliers && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onConfirmDelete(row);
                      }}
                      aria-label={t('common:buttons.delete')}
                      className="p-2 text-red-600 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                    >
                      <i className="fa-solid fa-trash-can"></i>
                    </button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>{t('common:buttons.delete')}</TooltipContent>
              </Tooltip>
            )}
          </div>
        ),
      },
    ],
    [
      t,
      canUpdateSuppliers,
      canDeleteSuppliers,
      onStatusUpdate,
      onConfirmDelete,
      supplierOrders,
      currency,
      i18n.language,
    ],
  );

  return (
    <StandardTable<Supplier>
      title={t('crm:suppliers.suppliersDirectory')}
      viewKey="suppliers.directory"
      data={suppliers}
      columns={columns}
      defaultRowsPerPage={10}
      onRowClick={canUpdateSuppliers ? onEditSupplier : undefined}
      rowClassName={(row) => (row.isDisabled ? 'opacity-70 grayscale hover:grayscale-0' : '')}
    />
  );
};

const SuppliersView: React.FC<SuppliersViewProps> = ({
  suppliers,
  supplierOrders,
  currency,
  onAddSupplier,
  onAddSuppliersBulk,
  onUpdateSupplier,
  onDeleteSupplier,
  permissions,
}) => {
  const { t } = useTranslation(['crm', 'common']);
  const canCreateSuppliers = hasScopedActionPermission(permissions, 'crm.suppliers', 'create');
  const canUpdateSuppliers = hasScopedActionPermission(permissions, 'crm.suppliers', 'update');
  const canDeleteSuppliers = hasScopedActionPermission(permissions, 'crm.suppliers', 'delete');
  const [state, dispatch] = useReducer(suppliersViewReducer, undefined, createSuppliersViewState);
  const {
    isModalOpen,
    editingSupplier,
    contactsExpanded,
    contactDraft,
    editingContactIndex,
    contactDraftError,
    contactsTouched,
    isDeleteConfirmOpen,
    isBulkCreateModalOpen,
    isWorkbookImportModalOpen,
    supplierToDelete,
    errors,
    formData,
  } = state;

  const openAddModal = () => {
    if (!canCreateSuppliers) return;
    dispatch({ type: 'openAdd' });
  };

  const openEditModal = (supplier: Supplier) => {
    if (!canUpdateSuppliers) return;
    dispatch({ type: 'openEdit', supplier });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (editingSupplier && !canUpdateSuppliers) return;
    if (!editingSupplier && !canCreateSuppliers) return;

    const normalizedDraft = contactDraft ? normalizeContact(contactDraft) : null;
    const hasDraftValues = normalizedDraft
      ? Boolean(
          normalizedDraft.fullName ||
            normalizedDraft.role ||
            normalizedDraft.email ||
            normalizedDraft.phone,
        )
      : false;
    let contactsForSubmit = normalizeContacts(formData.contacts);

    if (normalizedDraft && (editingContactIndex !== null || hasDraftValues)) {
      if (!normalizedDraft.fullName) {
        dispatch({
          type: 'setContactDraftError',
          error: t('common:validation.required'),
        });
        return;
      }
      contactsForSubmit =
        editingContactIndex === null
          ? [...contactsForSubmit, normalizedDraft]
          : contactsForSubmit.map((contact, index) =>
              index === editingContactIndex ? normalizedDraft : contact,
            );
    }

    const normalizedContacts = contactsForSubmit.filter((contact) => contact.fullName.length > 0);
    // Validation
    const trimmedName = formData.name?.trim() || '';
    const trimmedSupplierCode = formData.supplierCode?.trim() || '';
    const trimmedVatNumber = formData.vatNumber?.trim() || '';
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

    if (!editingSupplier && !trimmedVatNumber) {
      newErrors.vatNumber = t('crm:suppliers.vatRequired');
    }

    if (Object.keys(newErrors).length > 0) {
      dispatch({ type: 'setErrors', errors: newErrors });
      return;
    }

    const payload: Partial<Supplier> = {
      ...formData,
      name: trimmedName,
      supplierCode: trimmedSupplierCode,
      vatNumber: trimmedVatNumber,
    };
    delete payload.contacts;
    delete payload.contactName;
    delete payload.email;
    delete payload.phone;

    if (normalizedContacts.length > 0 || contactsTouched) {
      const primaryContact = normalizedContacts[0];
      payload.contacts = normalizedContacts;
      payload.contactName = primaryContact?.fullName || '';
      payload.email = primaryContact?.email || '';
      payload.phone = primaryContact?.phone || '';
    }

    try {
      if (editingSupplier) {
        await onUpdateSupplier(editingSupplier.id, payload);
      } else {
        await onAddSupplier(payload);
      }
      dispatch({ type: 'submitSuccess' });
    } catch (err) {
      const message = (err as Error).message;
      const fallback = t('crm:suppliers.failedToSave');
      if (message.toLowerCase().includes('supplier code')) {
        dispatch({
          type: 'setErrors',
          errors: { ...newErrors, supplierCode: t('crm:suppliers.codeUnique') },
        });
      } else {
        dispatch({
          type: 'setErrors',
          errors: { ...newErrors, general: message || fallback },
        });
      }
      toastError(message || fallback);
    }
  };

  const confirmDelete = useCallback((supplier: Supplier) => {
    dispatch({ type: 'confirmDelete', supplier });
  }, []);

  const handleDelete = async () => {
    if (!supplierToDelete) return;
    try {
      await onDeleteSupplier(supplierToDelete.id);
      dispatch({ type: 'deleteSuccess' });
    } catch (err) {
      toastError((err as Error).message || t('crm:suppliers.failedToDelete'));
    }
  };

  const handleStatusUpdate = useCallback(
    async (id: string, updates: Partial<Supplier>) => {
      try {
        await onUpdateSupplier(id, updates);
      } catch (err) {
        toastError((err as Error).message || t('crm:suppliers.failedToUpdateStatus'));
      }
    },
    [onUpdateSupplier, t],
  );

  const canSubmit = editingSupplier ? canUpdateSuppliers : canCreateSuppliers;

  return (
    <div className="space-y-8">
      <SupplierFormModal
        modalState={{
          isModalOpen,
          editingSupplier,
          errors,
          formData,
          contactsExpanded,
          contactDraft,
          editingContactIndex,
          contactDraftError,
        }}
        canSubmit={canSubmit}
        onSubmit={handleSubmit}
        onClose={() => dispatch({ type: 'closeModal' })}
        dispatch={dispatch}
      />

      {isBulkCreateModalOpen && (
        <SupplierBulkCreateDialog
          onCreateBulk={onAddSuppliersBulk}
          onClose={() => dispatch({ type: 'setBulkCreateModalOpen', value: false })}
        />
      )}
      {isWorkbookImportModalOpen && (
        <SupplierWorkbookImportDialog
          onCreateBulk={onAddSuppliersBulk}
          onClose={() => dispatch({ type: 'setWorkbookImportModalOpen', value: false })}
        />
      )}

      {/* Delete Confirmation Modal */}
      <DeleteConfirmModal
        isOpen={isDeleteConfirmOpen}
        onClose={() => dispatch({ type: 'deleteSuccess' })}
        onConfirm={handleDelete}
        title={t('crm:suppliers.deleteSupplier')}
        description={`${t('common:messages.deleteConfirmNamed', {
          name: supplierToDelete?.name,
        })}${t('crm:suppliers.deleteConfirm')}`}
      />

      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h2 className="text-2xl font-semibold text-zinc-800">{t('crm:suppliers.title')}</h2>
            <p className="text-zinc-500 text-sm">{t('crm:suppliers.subtitle')}</p>
          </div>
          {canCreateSuppliers && (
            <ButtonGroup>
              <Button
                type="button"
                onClick={openAddModal}
                className="h-auto rounded-lg px-5 py-2.5 has-[>svg]:px-5"
              >
                <Plus data-icon="inline-start" />
                {t('crm:suppliers.addSupplier')}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    size="icon"
                    aria-label={t('crm:suppliers.bulk.addOptions')}
                    className="h-auto rounded-lg px-3 py-2.5"
                  >
                    <ChevronDown aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-64">
                  <DropdownMenuItem
                    onSelect={() => dispatch({ type: 'setBulkCreateModalOpen', value: true })}
                  >
                    <Rows3 aria-hidden="true" />
                    {t('crm:suppliers.bulk.addMultiple')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => dispatch({ type: 'setWorkbookImportModalOpen', value: true })}
                  >
                    <FileSpreadsheet aria-hidden="true" />
                    {t('crm:suppliers.bulk.importExcel')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </ButtonGroup>
          )}
        </div>
      </div>

      <SuppliersTable
        suppliers={suppliers}
        supplierOrders={supplierOrders}
        currency={currency}
        canUpdateSuppliers={canUpdateSuppliers}
        canDeleteSuppliers={canDeleteSuppliers}
        onEditSupplier={openEditModal}
        onConfirmDelete={confirmDelete}
        onStatusUpdate={handleStatusUpdate}
      />
    </div>
  );
};

export default SuppliersView;
