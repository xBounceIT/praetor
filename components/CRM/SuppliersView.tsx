import type React from 'react';
import { useCallback, useMemo, useReducer } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { Supplier, SupplierSaleOrder, SupplierSaleOrderItem } from '../../types';
import { formatInsertDate } from '../../utils/date';
import { hasScopedActionPermission } from '../../utils/permissions';
import { toastError } from '../../utils/toast';
import DeleteConfirmModal from '../shared/DeleteConfirmModal';
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
import StandardTable, { type Column } from '../shared/StandardTable';
import StatusBadge from '../shared/StatusBadge';

export interface SuppliersViewProps {
  suppliers: Supplier[];
  supplierOrders: SupplierSaleOrder[];
  currency: string;
  onAddSupplier: (supplierData: Partial<Supplier>) => Promise<void>;
  onUpdateSupplier: (id: string, updates: Partial<Supplier>) => Promise<void>;
  onDeleteSupplier: (id: string) => Promise<void>;
  permissions: string[];
}

const calculateOrderTotal = (items: SupplierSaleOrderItem[], discount: number): number => {
  let subtotal = 0;
  items.forEach((item) => {
    const lineSubtotal = Number(item.quantity ?? 0) * Number(item.unitPrice ?? 0);
    const lineDiscount = (lineSubtotal * Number(item.discount ?? 0)) / 100;
    const lineNet = lineSubtotal - lineDiscount;
    subtotal += lineNet;
  });
  const discountAmount = subtotal * (discount / 100);
  return subtotal - discountAmount;
};

const createEmptySupplierForm = (): Partial<Supplier> => ({
  name: '',
  supplierCode: '',
  contactName: '',
  email: '',
  phone: '',
  address: '',
  vatNumber: '',
  taxCode: '',
  paymentTerms: '',
  notes: '',
});

const createSupplierForm = (supplier: Supplier): Partial<Supplier> => ({
  name: supplier.name || '',
  supplierCode: supplier.supplierCode || '',
  contactName: supplier.contactName || '',
  email: supplier.email || '',
  phone: supplier.phone || '',
  address: supplier.address || '',
  vatNumber: supplier.vatNumber || '',
  taxCode: supplier.taxCode || '',
  paymentTerms: supplier.paymentTerms || '',
  notes: supplier.notes || '',
});

type SuppliersViewState = {
  isModalOpen: boolean;
  editingSupplier: Supplier | null;
  isDeleteConfirmOpen: boolean;
  supplierToDelete: Supplier | null;
  errors: Record<string, string>;
  formData: Partial<Supplier>;
};

type SuppliersViewAction =
  | { type: 'openAdd' }
  | { type: 'openEdit'; supplier: Supplier }
  | { type: 'closeModal' }
  | { type: 'patchForm'; patch: Partial<Supplier> }
  | { type: 'clearError'; field: string }
  | { type: 'setErrors'; errors: Record<string, string> }
  | { type: 'submitSuccess' }
  | { type: 'confirmDelete'; supplier: Supplier }
  | { type: 'deleteSuccess' };

const createSuppliersViewState = (): SuppliersViewState => ({
  isModalOpen: false,
  editingSupplier: null,
  isDeleteConfirmOpen: false,
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
        errors: {},
        formData: createEmptySupplierForm(),
      };
    case 'openEdit':
      return {
        ...state,
        isModalOpen: true,
        editingSupplier: action.supplier,
        errors: {},
        formData: createSupplierForm(action.supplier),
      };
    case 'closeModal':
      return { ...state, isModalOpen: false };
    case 'patchForm':
      return { ...state, formData: { ...state.formData, ...action.patch } };
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
    default:
      return state;
  }
};

type SupplierFormModalProps = {
  modalState: Pick<SuppliersViewState, 'isModalOpen' | 'editingSupplier' | 'errors' | 'formData'>;
  canSubmit: boolean;
  onSubmit: (event: React.FormEvent) => void;
  onClose: () => void;
  dispatch: React.Dispatch<SuppliersViewAction>;
};

const SupplierFormModal: React.FC<SupplierFormModalProps> = ({
  modalState,
  canSubmit,
  onSubmit,
  onClose,
  dispatch,
}) => {
  const { t } = useTranslation(['crm', 'common']);
  const { isModalOpen, editingSupplier, errors, formData } = modalState;

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
                    onChange={(e) => {
                      dispatch({ type: 'patchForm', patch: { supplierCode: e.target.value } });
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
                    onChange={(e) => {
                      dispatch({ type: 'patchForm', patch: { name: e.target.value } });
                      dispatch({ type: 'clearError', field: 'name' });
                    }}
                    placeholder={t('crm:suppliers.namePlaceholder')}
                    aria-invalid={Boolean(errors.name)}
                  />
                  <FieldError className="text-xs">{errors.name}</FieldError>
                </Field>
                <Field className="col-span-full">
                  <FieldLabel htmlFor="supplier-contact-name">
                    {t('crm:suppliers.contactName')}
                  </FieldLabel>
                  <Input
                    id="supplier-contact-name"
                    type="text"
                    value={formData.contactName}
                    onChange={(e) =>
                      dispatch({ type: 'patchForm', patch: { contactName: e.target.value } })
                    }
                    placeholder={t('crm:suppliers.contactPlaceholder')}
                  />
                </Field>
              </div>
            </div>

            <div className="space-y-4">
              <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-primary">
                <span className="size-1.5 rounded-full bg-primary"></span>
                {t('crm:suppliers.contacts')}
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field>
                  <FieldLabel htmlFor="supplier-email">{t('crm:suppliers.email')}</FieldLabel>
                  <Input
                    id="supplier-email"
                    type="email"
                    value={formData.email}
                    onChange={(e) =>
                      dispatch({ type: 'patchForm', patch: { email: e.target.value } })
                    }
                    placeholder={t('crm:suppliers.emailPlaceholder')}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="supplier-phone">{t('crm:suppliers.phone')}</FieldLabel>
                  <Input
                    id="supplier-phone"
                    type="text"
                    value={formData.phone}
                    onChange={(e) =>
                      dispatch({ type: 'patchForm', patch: { phone: e.target.value } })
                    }
                    placeholder={t('crm:suppliers.phonePlaceholder')}
                  />
                </Field>
                <Field className="col-span-full">
                  <FieldLabel htmlFor="supplier-address">{t('crm:suppliers.address')}</FieldLabel>
                  <Textarea
                    id="supplier-address"
                    rows={2}
                    value={formData.address}
                    onChange={(e) =>
                      dispatch({ type: 'patchForm', patch: { address: e.target.value } })
                    }
                    placeholder={t('crm:suppliers.addressPlaceholder')}
                    className="resize-none"
                  />
                </Field>
              </div>
            </div>

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
            .reduce((total, order) => total + calculateOrderTotal(order.items, order.discount), 0),
        align: 'right',
        cell: (info) => {
          const totalValue = info.value as number;
          return (
            <span
              className={`text-xs font-semibold whitespace-nowrap ${
                totalValue > 0 ? 'text-emerald-700' : 'text-zinc-400'
              }`}
            >
              {totalValue.toFixed(2)} {currency}
            </span>
          );
        },
        filterFormat: (value: unknown) => (value as number).toFixed(2),
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
  onUpdateSupplier,
  onDeleteSupplier,
  permissions,
}) => {
  const { t } = useTranslation(['crm', 'common']);
  const canCreateSuppliers = hasScopedActionPermission(permissions, 'crm.suppliers', 'create');
  const canUpdateSuppliers = hasScopedActionPermission(permissions, 'crm.suppliers', 'update');
  const canDeleteSuppliers = hasScopedActionPermission(permissions, 'crm.suppliers', 'delete');
  const [state, dispatch] = useReducer(suppliersViewReducer, undefined, createSuppliersViewState);
  const { isModalOpen, editingSupplier, isDeleteConfirmOpen, supplierToDelete, errors, formData } =
    state;

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

    const payload = {
      ...formData,
      name: trimmedName,
      supplierCode: trimmedSupplierCode,
      vatNumber: trimmedVatNumber,
    };

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
        modalState={{ isModalOpen, editingSupplier, errors, formData }}
        canSubmit={canSubmit}
        onSubmit={handleSubmit}
        onClose={() => dispatch({ type: 'closeModal' })}
        dispatch={dispatch}
      />

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
            <HeaderAddButton onClick={openAddModal}>
              {t('crm:suppliers.addSupplier')}
            </HeaderAddButton>
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
