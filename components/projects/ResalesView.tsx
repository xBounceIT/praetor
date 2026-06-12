import { ArrowLeft, Pencil, Plus, Settings2, Trash2 } from 'lucide-react';
import type React from 'react';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  RequiredMark,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { CreateResaleBody, UpsertResaleActivityBody } from '@/services/api/resales';
import type {
  Resale,
  ResaleActivity,
  ResaleBillingFrequency,
  ResaleCategory,
  ResaleOrderOption,
} from '../../types';
import { formatDateOnlyForLocale } from '../../utils/date';
import { buildPermission, hasPermission } from '../../utils/permissions';
import DateField from '../shared/DateField';
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
import SelectControl from '../shared/SelectControl';
import StandardTable, { type Column } from '../shared/StandardTable';
import StatusBadge from '../shared/StatusBadge';
import { TABLE_CONTROL_BUTTON_CLASSNAME } from '../shared/tableControlStyles';

const billingFrequencyValues: ResaleBillingFrequency[] = [
  'monthly',
  'quarterly',
  'annual',
  'one_time',
];

type ResaleFormState = {
  clientOrderId: string;
  supplierOrderId: string;
  dueDate: string;
  notes: string;
  errors: Record<string, string>;
};

type ActivityFormState = {
  id: string | null;
  name: string;
  billingFrequency: ResaleBillingFrequency;
  categoryId: string;
  cost: string;
  revenue: string;
  released: boolean;
  dueDate: string;
  notes: string;
  errors: Record<string, string>;
};

const initialResaleForm: ResaleFormState = {
  clientOrderId: '',
  supplierOrderId: '',
  dueDate: '',
  notes: '',
  errors: {},
};

const initialActivityForm: ActivityFormState = {
  id: null,
  name: '',
  billingFrequency: 'one_time',
  categoryId: '',
  cost: '',
  revenue: '',
  released: false,
  dueDate: '',
  notes: '',
  errors: {},
};

export interface ResalesViewProps {
  resales: Resale[];
  categories: ResaleCategory[];
  orderOptions: ResaleOrderOption[];
  permissions: string[];
  currency: string;
  onAddResale: (input: CreateResaleBody) => Promise<Resale | null>;
  onDeleteResale: (id: string) => void | Promise<void>;
  onAddActivity: (resaleId: string, input: UpsertResaleActivityBody) => Promise<Resale | null>;
  onUpdateActivity: (
    resaleId: string,
    activityId: string,
    updates: Partial<UpsertResaleActivityBody>,
  ) => Promise<Resale | null>;
  onDeleteActivity: (resaleId: string, activityId: string) => Promise<Resale | null>;
  onCreateCategory: (name: string) => Promise<ResaleCategory | null>;
  onUpdateCategory: (id: string, name: string) => Promise<ResaleCategory | null>;
  onDeleteCategory: (id: string) => void | Promise<void>;
}

const parseMoney = (value: string) => (value ? Number.parseFloat(value) : 0);

const ResalesView: React.FC<ResalesViewProps> = ({
  resales,
  categories,
  orderOptions,
  permissions,
  currency,
  onAddResale,
  onDeleteResale,
  onAddActivity,
  onUpdateActivity,
  onDeleteActivity,
  onCreateCategory,
  onUpdateCategory,
  onDeleteCategory,
}) => {
  const { t, i18n } = useTranslation(['projects', 'common']);
  const canCreate = hasPermission(permissions, buildPermission('projects.resales', 'create'));
  const canUpdate = hasPermission(permissions, buildPermission('projects.resales', 'update'));
  const canDelete = hasPermission(permissions, buildPermission('projects.resales', 'delete'));

  const [selectedResaleId, setSelectedResaleId] = useState<string | null>(null);
  const [resaleForm, setResaleForm] = useState<ResaleFormState>(initialResaleForm);
  const [isResaleModalOpen, setIsResaleModalOpen] = useState(false);
  const [activityForm, setActivityForm] = useState<ActivityFormState>(initialActivityForm);
  const [isActivityModalOpen, setIsActivityModalOpen] = useState(false);
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [categoryName, setCategoryName] = useState('');
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [categoryError, setCategoryError] = useState('');
  const [resaleToDelete, setResaleToDelete] = useState<Resale | null>(null);
  const [activityToDelete, setActivityToDelete] = useState<ResaleActivity | null>(null);

  const selectedResale = selectedResaleId
    ? resales.find((resale) => resale.id === selectedResaleId)
    : null;

  const formatMoney = useCallback(
    (value: number) =>
      `${Number(value || 0).toLocaleString(i18n.language, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })} ${currency}`,
    [currency, i18n.language],
  );

  const billingOptions = billingFrequencyValues.map((value) => ({
    id: value,
    name: t(`resales.billingFrequencies.${value}`),
  }));

  const categoryOptions = categories.map((category) => ({
    id: category.id,
    name: category.name,
  }));

  const clientOrderOptions = orderOptions.map((option) => ({
    id: option.clientOrderId,
    name: `${option.clientName} - ${option.clientOrderId}`,
  }));

  const selectedOrderOption = orderOptions.find(
    (option) => option.clientOrderId === resaleForm.clientOrderId,
  );
  const supplierOrderOptions =
    selectedOrderOption?.supplierOrders.map((order) => ({
      id: order.id,
      name: `${order.supplierName} - ${order.id} (${formatMoney(order.total)})`,
    })) ?? [];

  const openCreateResale = () => {
    if (!canCreate) return;
    setResaleForm(initialResaleForm);
    setIsResaleModalOpen(true);
  };

  const closeResaleModal = () => {
    setIsResaleModalOpen(false);
    setResaleForm(initialResaleForm);
  };

  const submitResale = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canCreate) return;
    const errors: Record<string, string> = {};
    if (!resaleForm.clientOrderId) errors.clientOrderId = t('resales.validation.clientOrder');
    if (!resaleForm.supplierOrderId) {
      errors.supplierOrderId = t('resales.validation.supplierOrder');
    }
    if (Object.keys(errors).length > 0) {
      setResaleForm((prev) => ({ ...prev, errors }));
      return;
    }
    const created = await onAddResale({
      clientOrderId: resaleForm.clientOrderId,
      supplierOrderId: resaleForm.supplierOrderId,
      dueDate: resaleForm.dueDate || null,
      notes: resaleForm.notes.trim() || null,
    });
    if (created) {
      setSelectedResaleId(created.id);
      closeResaleModal();
    }
  };

  const openCreateActivity = () => {
    if (!selectedResale || !canCreate) return;
    setActivityForm({
      ...initialActivityForm,
      categoryId: categories[0]?.id ?? '',
    });
    setIsActivityModalOpen(true);
  };

  const openEditActivity = useCallback(
    (activity: ResaleActivity) => {
      if (!canUpdate) return;
      setActivityForm({
        id: activity.id,
        name: activity.name,
        billingFrequency: activity.billingFrequency,
        categoryId: activity.categoryId,
        cost: String(activity.cost),
        revenue: String(activity.revenue),
        released: activity.released,
        dueDate: activity.dueDate ?? '',
        notes: activity.notes ?? '',
        errors: {},
      });
      setIsActivityModalOpen(true);
    },
    [canUpdate],
  );

  const closeActivityModal = () => {
    setIsActivityModalOpen(false);
    setActivityForm(initialActivityForm);
  };

  const submitActivity = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedResale) return;
    const errors: Record<string, string> = {};
    if (!activityForm.name.trim()) errors.name = t('resales.validation.activityName');
    if (!activityForm.categoryId) errors.categoryId = t('resales.validation.category');
    const cost = parseMoney(activityForm.cost);
    const revenue = parseMoney(activityForm.revenue);
    if (Number.isNaN(cost) || cost < 0) {
      errors.cost = t('resales.validation.nonNegative');
    }
    if (Number.isNaN(revenue) || revenue < 0) {
      errors.revenue = t('resales.validation.nonNegative');
    }
    if (Object.keys(errors).length > 0) {
      setActivityForm((prev) => ({ ...prev, errors }));
      return;
    }

    const payload: UpsertResaleActivityBody = {
      name: activityForm.name.trim(),
      billingFrequency: activityForm.billingFrequency,
      categoryId: activityForm.categoryId,
      cost,
      revenue,
      released: activityForm.released,
      dueDate: activityForm.dueDate || null,
      notes: activityForm.notes.trim() || null,
    };

    const result = activityForm.id
      ? await onUpdateActivity(selectedResale.id, activityForm.id, payload)
      : await onAddActivity(selectedResale.id, payload);
    if (result) closeActivityModal();
  };

  const submitCategory = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmedName = categoryName.trim();
    if (!trimmedName) {
      setCategoryError(t('resales.validation.categoryName'));
      return;
    }
    const saved = editingCategoryId
      ? await onUpdateCategory(editingCategoryId, trimmedName)
      : await onCreateCategory(trimmedName);
    if (saved) {
      setCategoryName('');
      setEditingCategoryId(null);
      setCategoryError('');
    }
  };

  const resaleColumns = useMemo<Column<Resale>[]>(
    () => [
      {
        id: 'clientOrderId',
        header: t('resales.columns.clientOrder'),
        accessorKey: 'clientOrderId',
        cell: ({ row }) => (
          <div className="space-y-0.5">
            <span className="block text-sm font-semibold text-foreground">{row.clientOrderId}</span>
            <span className="block text-xs text-muted-foreground">{row.clientName}</span>
          </div>
        ),
      },
      {
        id: 'supplierOrderId',
        header: t('resales.columns.supplierOrder'),
        accessorKey: 'supplierOrderId',
        cell: ({ row }) => (
          <div className="space-y-0.5">
            <span className="block text-sm font-semibold text-foreground">
              {row.supplierOrderId}
            </span>
            <span className="block text-xs text-muted-foreground">{row.supplierName}</span>
          </div>
        ),
      },
      {
        id: 'revenue',
        header: t('resales.columns.revenue'),
        accessorFn: (row) => row.resaleRevenue,
        cell: ({ row }) => (
          <span className="font-mono text-sm">{formatMoney(row.resaleRevenue)}</span>
        ),
      },
      {
        id: 'supplierCost',
        header: t('resales.columns.supplierCost'),
        accessorFn: (row) => row.supplierOrderCost,
        cell: ({ row }) => (
          <span className="font-mono text-sm">{formatMoney(row.supplierOrderCost)}</span>
        ),
      },
      {
        id: 'activityCost',
        header: t('resales.columns.activityCost'),
        accessorFn: (row) => row.activityCostTotal,
        cell: ({ row }) => (
          <span className="font-mono text-sm">{formatMoney(row.activityCostTotal)}</span>
        ),
      },
      {
        id: 'variance',
        header: t('resales.columns.variance'),
        accessorFn: (row) => row.costVariance,
        cell: ({ row }) =>
          Math.abs(row.costVariance) > 0.009 ? (
            <StatusBadge type="pending" label={formatMoney(row.costVariance)} />
          ) : (
            <StatusBadge type="active" label={t('resales.balanced')} />
          ),
      },
      {
        id: 'dueDate',
        header: t('resales.columns.dueDate'),
        accessorKey: 'dueDate',
        cell: ({ row }) =>
          row.dueDate ? (
            <span className="text-xs text-muted-foreground">
              {formatDateOnlyForLocale(row.dueDate, i18n.language)}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">-</span>
          ),
      },
      {
        id: 'actions',
        header: t('common:labels.actions'),
        align: 'right',
        disableSorting: true,
        disableFiltering: true,
        cell: ({ row }) =>
          canDelete ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={(event) => {
                    event.stopPropagation();
                    setResaleToDelete(row);
                  }}
                  aria-label={t('common:buttons.delete')}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('common:buttons.delete')}</TooltipContent>
            </Tooltip>
          ) : null,
      },
    ],
    [canDelete, formatMoney, i18n.language, t],
  );

  const activityColumns = useMemo<Column<ResaleActivity>[]>(
    () => [
      { id: 'name', header: t('resales.columns.activityName'), accessorKey: 'name' },
      {
        id: 'billingFrequency',
        header: t('resales.columns.billing'),
        accessorFn: (row) => t(`resales.billingFrequencies.${row.billingFrequency}`),
      },
      { id: 'categoryName', header: t('resales.columns.category'), accessorKey: 'categoryName' },
      {
        id: 'cost',
        header: t('resales.columns.cost'),
        accessorFn: (row) => row.cost,
        cell: ({ row }) => <span className="font-mono text-sm">{formatMoney(row.cost)}</span>,
      },
      {
        id: 'revenue',
        header: t('resales.columns.revenue'),
        accessorFn: (row) => row.revenue,
        cell: ({ row }) => <span className="font-mono text-sm">{formatMoney(row.revenue)}</span>,
      },
      {
        id: 'released',
        header: t('resales.columns.released'),
        accessorFn: (row) => (row.released ? t('resales.released') : t('resales.notReleased')),
        cell: ({ row }) =>
          row.released ? (
            <StatusBadge type="active" label={t('resales.released')} />
          ) : (
            <StatusBadge type="draft" label={t('resales.notReleased')} />
          ),
      },
      {
        id: 'dueDate',
        header: t('resales.columns.dueDate'),
        accessorKey: 'dueDate',
        cell: ({ row }) =>
          row.dueDate ? formatDateOnlyForLocale(row.dueDate, i18n.language) : '-',
      },
      {
        id: 'notes',
        header: t('resales.columns.notes'),
        accessorKey: 'notes',
        cell: ({ row }) => (
          <span className="line-clamp-2 text-xs text-muted-foreground">{row.notes || '-'}</span>
        ),
      },
      {
        id: 'actions',
        header: t('common:labels.actions'),
        align: 'right',
        disableSorting: true,
        disableFiltering: true,
        cell: ({ row }) => (
          <div className="inline-flex items-center justify-end gap-1">
            {canUpdate && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => openEditActivity(row)}
                    aria-label={t('common:buttons.edit')}
                  >
                    <Pencil className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t('common:buttons.edit')}</TooltipContent>
              </Tooltip>
            )}
            {canDelete && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setActivityToDelete(row)}
                    aria-label={t('common:buttons.delete')}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t('common:buttons.delete')}</TooltipContent>
              </Tooltip>
            )}
          </div>
        ),
      },
    ],
    [canDelete, canUpdate, formatMoney, i18n.language, openEditActivity, t],
  );

  const categoryColumns = useMemo<Column<ResaleCategory>[]>(
    () => [
      { id: 'name', header: t('resales.columns.category'), accessorKey: 'name' },
      {
        id: 'activityCount',
        header: t('resales.categoryActivityCount'),
        accessorFn: (row) => row.activityCount ?? 0,
      },
      {
        id: 'actions',
        header: t('common:labels.actions'),
        align: 'right',
        disableSorting: true,
        disableFiltering: true,
        cell: ({ row }) => (
          <div className="inline-flex items-center justify-end gap-1">
            {canUpdate && (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => {
                  setEditingCategoryId(row.id);
                  setCategoryName(row.name);
                  setCategoryError('');
                }}
                aria-label={t('common:buttons.edit')}
              >
                <Pencil className="size-4" />
              </Button>
            )}
            {canDelete && (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => onDeleteCategory(row.id)}
                disabled={row.hasLinkedActivities}
                aria-label={t('common:buttons.delete')}
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="size-4" />
              </Button>
            )}
          </div>
        ),
      },
    ],
    [canDelete, canUpdate, onDeleteCategory, t],
  );

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-foreground">{t('resales.title')}</h2>
          <p className="text-sm text-muted-foreground">{t('resales.subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => setIsCategoryModalOpen(true)}
            disabled={!canCreate && !canUpdate && !canDelete}
          >
            <Settings2 className="size-4" />
            {t('resales.manageCategories')}
          </Button>
          {canCreate && (
            <HeaderAddButton onClick={openCreateResale}>{t('resales.addResale')}</HeaderAddButton>
          )}
        </div>
      </div>

      <StandardTable<Resale>
        title={t('resales.directory')}
        viewKey="projects.resales"
        data={resales}
        columns={resaleColumns}
        defaultRowsPerPage={5}
        onRowClick={(row) => setSelectedResaleId(row.id)}
      />

      {selectedResale && (
        <section className="space-y-4 border-t border-border pt-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 space-y-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setSelectedResaleId(null)}
                className="-ml-2"
              >
                <ArrowLeft className="size-4" />
                {t('common:buttons.back')}
              </Button>
              <h3 className="text-xl font-semibold text-foreground">
                {selectedResale.clientOrderId} / {selectedResale.supplierOrderId}
              </h3>
              <p className="text-sm text-muted-foreground">
                {selectedResale.clientName} · {selectedResale.supplierName}
              </p>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded-lg border border-border bg-background p-4">
              <p className="text-xs font-medium uppercase text-muted-foreground">
                {t('resales.columns.revenue')}
              </p>
              <p className="mt-2 font-mono text-xl font-semibold">
                {formatMoney(selectedResale.resaleRevenue)}
              </p>
            </div>
            <div className="rounded-lg border border-border bg-background p-4">
              <p className="text-xs font-medium uppercase text-muted-foreground">
                {t('resales.columns.supplierCost')}
              </p>
              <p className="mt-2 font-mono text-xl font-semibold">
                {formatMoney(selectedResale.supplierOrderCost)}
              </p>
            </div>
            <div className="rounded-lg border border-border bg-background p-4">
              <p className="text-xs font-medium uppercase text-muted-foreground">
                {t('resales.columns.activityCost')}
              </p>
              <p className="mt-2 font-mono text-xl font-semibold">
                {formatMoney(selectedResale.activityCostTotal)}
              </p>
            </div>
            <div className="rounded-lg border border-border bg-background p-4">
              <p className="text-xs font-medium uppercase text-muted-foreground">
                {t('resales.columns.variance')}
              </p>
              <div className="mt-2">
                {Math.abs(selectedResale.costVariance) > 0.009 ? (
                  <StatusBadge type="pending" label={formatMoney(selectedResale.costVariance)} />
                ) : (
                  <StatusBadge type="active" label={t('resales.balanced')} />
                )}
              </div>
              {Math.abs(selectedResale.costVariance) > 0.009 && (
                <p className="mt-2 text-xs text-muted-foreground">{t('resales.varianceHint')}</p>
              )}
            </div>
          </div>

          <StandardTable<ResaleActivity>
            title={t('resales.activitiesTitle')}
            data={selectedResale.activities}
            columns={activityColumns}
            defaultRowsPerPage={5}
            headerAction={
              canCreate ? (
                <Button
                  type="button"
                  size="sm"
                  onClick={openCreateActivity}
                  className={TABLE_CONTROL_BUTTON_CLASSNAME}
                >
                  <Plus className="size-4" />
                  {t('resales.addActivity')}
                </Button>
              ) : undefined
            }
          />
        </section>
      )}

      <Modal isOpen={isResaleModalOpen} onClose={closeResaleModal}>
        {isResaleModalOpen && (
          <ModalContent size="lg">
            <form onSubmit={submitResale}>
              <ModalHeader>
                <ModalTitle>{t('resales.createTitle')}</ModalTitle>
                <ModalCloseButton onClick={closeResaleModal} />
              </ModalHeader>
              <ModalBody>
                <div className="grid gap-4">
                  <div className="space-y-1.5">
                    <SelectControl
                      id="resale-client-order"
                      options={clientOrderOptions}
                      value={resaleForm.clientOrderId}
                      onChange={(value) =>
                        setResaleForm((prev) => ({
                          ...prev,
                          clientOrderId: value as string,
                          supplierOrderId: '',
                          errors: { ...prev.errors, clientOrderId: '', supplierOrderId: '' },
                        }))
                      }
                      label={
                        <>
                          {t('resales.fields.clientOrder')} <RequiredMark />
                        </>
                      }
                      searchable
                      placeholder={t('resales.placeholders.clientOrder')}
                    />
                    <FieldError className="text-xs">{resaleForm.errors.clientOrderId}</FieldError>
                  </div>
                  <div className="space-y-1.5">
                    <SelectControl
                      id="resale-supplier-order"
                      options={supplierOrderOptions}
                      value={resaleForm.supplierOrderId}
                      onChange={(value) =>
                        setResaleForm((prev) => ({
                          ...prev,
                          supplierOrderId: value as string,
                          errors: { ...prev.errors, supplierOrderId: '' },
                        }))
                      }
                      label={
                        <>
                          {t('resales.fields.supplierOrder')} <RequiredMark />
                        </>
                      }
                      searchable
                      disabled={!resaleForm.clientOrderId}
                      placeholder={t('resales.placeholders.supplierOrder')}
                    />
                    <FieldError className="text-xs">{resaleForm.errors.supplierOrderId}</FieldError>
                  </div>
                  <Field>
                    <FieldLabel htmlFor="resale-due-date">{t('resales.fields.dueDate')}</FieldLabel>
                    <DateField
                      id="resale-due-date"
                      value={resaleForm.dueDate}
                      onChange={(value) => setResaleForm((prev) => ({ ...prev, dueDate: value }))}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="resale-notes">{t('resales.fields.notes')}</FieldLabel>
                    <Textarea
                      id="resale-notes"
                      value={resaleForm.notes}
                      onChange={(event) =>
                        setResaleForm((prev) => ({ ...prev, notes: event.target.value }))
                      }
                    />
                  </Field>
                </div>
              </ModalBody>
              <ModalFooter>
                <Button type="button" variant="outline" onClick={closeResaleModal}>
                  {t('common:buttons.cancel')}
                </Button>
                <Button type="submit">{t('common:buttons.create')}</Button>
              </ModalFooter>
            </form>
          </ModalContent>
        )}
      </Modal>

      <Modal isOpen={isActivityModalOpen} onClose={closeActivityModal}>
        {isActivityModalOpen && (
          <ModalContent size="2xl">
            <form onSubmit={submitActivity}>
              <ModalHeader>
                <ModalTitle>
                  {activityForm.id ? t('resales.editActivity') : t('resales.addActivity')}
                </ModalTitle>
                <ModalCloseButton onClick={closeActivityModal} />
              </ModalHeader>
              <ModalBody>
                <div className="grid gap-4 md:grid-cols-2">
                  <Field className="md:col-span-2">
                    <FieldLabel htmlFor="resale-activity-name">
                      {t('resales.columns.activityName')} <RequiredMark />
                    </FieldLabel>
                    <Input
                      id="resale-activity-name"
                      value={activityForm.name}
                      onChange={(event) =>
                        setActivityForm((prev) => ({ ...prev, name: event.target.value }))
                      }
                    />
                    <FieldError className="text-xs">{activityForm.errors.name}</FieldError>
                  </Field>
                  <div className="space-y-1.5">
                    <SelectControl
                      id="resale-activity-billing"
                      options={billingOptions}
                      value={activityForm.billingFrequency}
                      onChange={(value) =>
                        setActivityForm((prev) => ({
                          ...prev,
                          billingFrequency: value as ResaleBillingFrequency,
                        }))
                      }
                      label={t('resales.columns.billing')}
                      searchable={false}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <SelectControl
                      id="resale-activity-category"
                      options={categoryOptions}
                      value={activityForm.categoryId}
                      onChange={(value) =>
                        setActivityForm((prev) => ({
                          ...prev,
                          categoryId: value as string,
                          errors: { ...prev.errors, categoryId: '' },
                        }))
                      }
                      label={
                        <>
                          {t('resales.columns.category')} <RequiredMark />
                        </>
                      }
                      searchable
                    />
                    <FieldError className="text-xs">{activityForm.errors.categoryId}</FieldError>
                  </div>
                  <Field>
                    <FieldLabel htmlFor="resale-activity-cost">
                      {t('resales.columns.cost')} ({currency}) <RequiredMark />
                    </FieldLabel>
                    <Input
                      id="resale-activity-cost"
                      type="number"
                      min="0"
                      step="0.01"
                      value={activityForm.cost}
                      onChange={(event) =>
                        setActivityForm((prev) => ({ ...prev, cost: event.target.value }))
                      }
                    />
                    <FieldError className="text-xs">{activityForm.errors.cost}</FieldError>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="resale-activity-revenue">
                      {t('resales.columns.revenue')} ({currency}) <RequiredMark />
                    </FieldLabel>
                    <Input
                      id="resale-activity-revenue"
                      type="number"
                      min="0"
                      step="0.01"
                      value={activityForm.revenue}
                      onChange={(event) =>
                        setActivityForm((prev) => ({ ...prev, revenue: event.target.value }))
                      }
                    />
                    <FieldError className="text-xs">{activityForm.errors.revenue}</FieldError>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="resale-activity-due-date">
                      {t('resales.columns.dueDate')}
                    </FieldLabel>
                    <DateField
                      id="resale-activity-due-date"
                      value={activityForm.dueDate}
                      onChange={(value) => setActivityForm((prev) => ({ ...prev, dueDate: value }))}
                    />
                    <FieldDescription className="text-xs">
                      {t('resales.activityDueDateHint')}
                    </FieldDescription>
                  </Field>
                  <Field className="flex-row items-center gap-2">
                    <Checkbox
                      id="resale-activity-released"
                      checked={activityForm.released}
                      onCheckedChange={(checked) =>
                        setActivityForm((prev) => ({ ...prev, released: checked === true }))
                      }
                    />
                    <FieldLabel htmlFor="resale-activity-released" className="font-normal">
                      {t('resales.columns.released')}
                    </FieldLabel>
                  </Field>
                  <Field className="md:col-span-2">
                    <FieldLabel htmlFor="resale-activity-notes">
                      {t('resales.columns.notes')}
                    </FieldLabel>
                    <Textarea
                      id="resale-activity-notes"
                      value={activityForm.notes}
                      onChange={(event) =>
                        setActivityForm((prev) => ({ ...prev, notes: event.target.value }))
                      }
                    />
                  </Field>
                </div>
              </ModalBody>
              <ModalFooter>
                <Button type="button" variant="outline" onClick={closeActivityModal}>
                  {t('common:buttons.cancel')}
                </Button>
                <Button type="submit">
                  {activityForm.id ? t('common:buttons.save') : t('common:buttons.create')}
                </Button>
              </ModalFooter>
            </form>
          </ModalContent>
        )}
      </Modal>

      <Modal isOpen={isCategoryModalOpen} onClose={() => setIsCategoryModalOpen(false)}>
        {isCategoryModalOpen && (
          <ModalContent size="lg">
            <ModalHeader>
              <ModalTitle>{t('resales.manageCategories')}</ModalTitle>
              <ModalCloseButton onClick={() => setIsCategoryModalOpen(false)} />
            </ModalHeader>
            <ModalBody>
              <form onSubmit={submitCategory} className="mb-4 grid gap-3 sm:grid-cols-[1fr_auto]">
                <Field>
                  <FieldLabel htmlFor="resale-category-name">
                    {t('resales.fields.categoryName')}
                  </FieldLabel>
                  <Input
                    id="resale-category-name"
                    value={categoryName}
                    onChange={(event) => {
                      setCategoryName(event.target.value);
                      setCategoryError('');
                    }}
                  />
                  <FieldError className="text-xs">{categoryError}</FieldError>
                </Field>
                <div className="flex items-end gap-2">
                  <Button type="submit" disabled={!canCreate && !canUpdate}>
                    {editingCategoryId ? t('common:buttons.save') : t('common:buttons.create')}
                  </Button>
                  {editingCategoryId && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setEditingCategoryId(null);
                        setCategoryName('');
                        setCategoryError('');
                      }}
                    >
                      {t('common:buttons.cancel')}
                    </Button>
                  )}
                </div>
              </form>
              <StandardTable<ResaleCategory>
                title={t('resales.categoriesDirectory')}
                data={categories}
                columns={categoryColumns}
                defaultRowsPerPage={5}
              />
            </ModalBody>
          </ModalContent>
        )}
      </Modal>

      <DeleteConfirmModal
        isOpen={!!resaleToDelete}
        onClose={() => setResaleToDelete(null)}
        onConfirm={async () => {
          if (resaleToDelete) {
            await onDeleteResale(resaleToDelete.id);
            if (selectedResaleId === resaleToDelete.id) setSelectedResaleId(null);
          }
          setResaleToDelete(null);
        }}
        title={t('resales.deleteTitle')}
        description={t('resales.deleteDescription', { id: resaleToDelete?.id })}
      />

      <DeleteConfirmModal
        isOpen={!!activityToDelete}
        onClose={() => setActivityToDelete(null)}
        onConfirm={async () => {
          if (selectedResale && activityToDelete) {
            await onDeleteActivity(selectedResale.id, activityToDelete.id);
          }
          setActivityToDelete(null);
        }}
        title={t('resales.deleteActivityTitle')}
        description={t('resales.deleteActivityDescription', { name: activityToDelete?.name })}
      />
    </div>
  );
};

export default ResalesView;
