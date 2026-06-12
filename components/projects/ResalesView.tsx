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
  startDate: string;
  dueDate: string;
  notes: string;
  activities: DraftResaleActivity[];
  errors: Record<string, string>;
};

type DraftResaleActivity = {
  _id: string;
  name: string;
  billingFrequency: ResaleBillingFrequency;
  categoryId: string;
  cost: string;
  revenue: string;
  released: boolean;
  dueDate: string;
  notes: string;
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
  startDate: '',
  dueDate: '',
  notes: '',
  activities: [],
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
const parseDisplayMoney = (value: string) => {
  const parsed = parseMoney(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

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
  const selectedSupplierOrder = selectedOrderOption?.supplierOrders.find(
    (order) => order.id === resaleForm.supplierOrderId,
  );
  const draftResaleRevenue = resaleForm.activities.reduce(
    (sum, activity) => sum + parseDisplayMoney(activity.revenue),
    0,
  );
  const draftResaleCost = selectedSupplierOrder?.total ?? 0;
  const releasedOptions = [
    { id: 'true', name: t('resales.boolean.yes') },
    { id: 'false', name: t('resales.boolean.no') },
  ];

  const createDraftResaleActivity = useCallback(
    (): DraftResaleActivity => ({
      _id: `${Date.now()}-${Math.random()}`,
      name: '',
      billingFrequency: 'one_time',
      categoryId: categories[0]?.id ?? '',
      cost: '',
      revenue: '',
      released: false,
      dueDate: '',
      notes: '',
    }),
    [categories],
  );

  const openCreateResale = () => {
    if (!canCreate) return;
    setResaleForm({
      ...initialResaleForm,
      activities: [createDraftResaleActivity()],
    });
    setIsResaleModalOpen(true);
  };

  const closeResaleModal = () => {
    setIsResaleModalOpen(false);
    setResaleForm(initialResaleForm);
  };

  const openCategoryModal = () => {
    if (!canCreate && !canUpdate && !canDelete) return;
    setEditingCategoryId(null);
    setCategoryName('');
    setCategoryError('');
    setIsCategoryModalOpen(true);
  };

  const closeCategoryModal = () => {
    setIsCategoryModalOpen(false);
    setEditingCategoryId(null);
    setCategoryName('');
    setCategoryError('');
  };

  const addDraftActivity = () => {
    setResaleForm((prev) => ({
      ...prev,
      activities: [...prev.activities, createDraftResaleActivity()],
      errors: { ...prev.errors, activities: '' },
    }));
  };

  function updateDraftActivity<K extends keyof Omit<DraftResaleActivity, '_id'>>(
    id: string,
    field: K,
    value: DraftResaleActivity[K],
  ) {
    setResaleForm((prev) => ({
      ...prev,
      activities: prev.activities.map((activity) =>
        activity._id === id ? { ...activity, [field]: value } : activity,
      ),
      errors: { ...prev.errors, activities: '' },
    }));
  }

  const removeDraftActivity = (id: string) => {
    setResaleForm((prev) => ({
      ...prev,
      activities: prev.activities.filter((activity) => activity._id !== id),
      errors: { ...prev.errors, activities: '' },
    }));
  };

  const submitResale = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canCreate) return;
    const errors: Record<string, string> = {};
    if (!resaleForm.clientOrderId) errors.clientOrderId = t('resales.validation.clientOrder');
    if (!resaleForm.supplierOrderId) {
      errors.supplierOrderId = t('resales.validation.supplierOrder');
    }
    if (!resaleForm.startDate) errors.startDate = t('resales.validation.startDate');
    if (!resaleForm.dueDate) errors.dueDate = t('resales.validation.dueDate');
    const activityInputs: UpsertResaleActivityBody[] = [];
    for (const activity of resaleForm.activities) {
      const cost = parseMoney(activity.cost);
      const revenue = parseMoney(activity.revenue);
      if (
        !activity.name.trim() ||
        !activity.categoryId ||
        !activity.cost.trim() ||
        !activity.revenue.trim() ||
        Number.isNaN(cost) ||
        cost < 0 ||
        Number.isNaN(revenue) ||
        revenue < 0
      ) {
        errors.activities = t('resales.validation.activityRows');
        break;
      }
      activityInputs.push({
        name: activity.name.trim(),
        billingFrequency: activity.billingFrequency,
        categoryId: activity.categoryId,
        cost,
        revenue,
        released: activity.released,
        dueDate: activity.dueDate || null,
        notes: activity.notes.trim() || null,
      });
    }
    if (activityInputs.length === 0 && !errors.activities) {
      errors.activities = t('resales.validation.activitiesRequired');
    }
    if (Object.keys(errors).length > 0) {
      setResaleForm((prev) => ({ ...prev, errors }));
      return;
    }
    const created = await onAddResale({
      clientOrderId: resaleForm.clientOrderId,
      supplierOrderId: resaleForm.supplierOrderId,
      startDate: resaleForm.startDate,
      dueDate: resaleForm.dueDate,
      notes: resaleForm.notes.trim() || null,
      activities: activityInputs,
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
    const wasEditing = Boolean(editingCategoryId);
    const saved = editingCategoryId
      ? await onUpdateCategory(editingCategoryId, trimmedName)
      : await onCreateCategory(trimmedName);
    if (saved) {
      if (!wasEditing) {
        setResaleForm((prev) => ({
          ...prev,
          activities: prev.activities.map((activity) =>
            activity.categoryId ? activity : { ...activity, categoryId: saved.id },
          ),
        }));
        setActivityForm((prev) => (prev.categoryId ? prev : { ...prev, categoryId: saved.id }));
      }
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

  const draftActivityColumns: Column<DraftResaleActivity>[] = [
    {
      id: 'name',
      header: t('resales.columns.activityName'),
      accessorKey: 'name',
      disableFiltering: true,
      cell: ({ row }) => (
        <Input
          value={row.name}
          required
          placeholder={t('resales.columns.activityName')}
          onChange={(event) => updateDraftActivity(row._id, 'name', event.target.value)}
          className="h-8 min-w-[140px] text-xs"
        />
      ),
    },
    {
      id: 'billingFrequency',
      header: t('resales.columns.billing'),
      accessorKey: 'billingFrequency',
      disableFiltering: true,
      cell: ({ row }) => (
        <SelectControl
          options={billingOptions}
          value={row.billingFrequency}
          onChange={(value) =>
            updateDraftActivity(row._id, 'billingFrequency', value as ResaleBillingFrequency)
          }
          className="min-w-[130px]"
          buttonClassName="h-8 text-xs"
          searchable={false}
        />
      ),
    },
    {
      id: 'categoryId',
      header: t('resales.columns.category'),
      accessorKey: 'categoryId',
      disableFiltering: true,
      cell: ({ row }) => (
        <SelectControl
          options={categoryOptions}
          value={row.categoryId}
          onChange={(value) => updateDraftActivity(row._id, 'categoryId', value as string)}
          className="min-w-[130px]"
          buttonClassName="h-8 text-xs"
          searchable={false}
          placeholder={t('resales.placeholders.category')}
        />
      ),
    },
    {
      id: 'cost',
      header: `${t('resales.columns.cost')} (${currency})`,
      accessorKey: 'cost',
      disableFiltering: true,
      cell: ({ row }) => (
        <Input
          type="number"
          min="0"
          step="0.01"
          required
          value={row.cost}
          placeholder="0.00"
          onChange={(event) => updateDraftActivity(row._id, 'cost', event.target.value)}
          className="h-8 min-w-[90px] text-xs"
        />
      ),
    },
    {
      id: 'revenue',
      header: `${t('resales.columns.revenue')} (${currency})`,
      accessorKey: 'revenue',
      disableFiltering: true,
      cell: ({ row }) => (
        <Input
          type="number"
          min="0"
          step="0.01"
          required
          value={row.revenue}
          placeholder="0.00"
          onChange={(event) => updateDraftActivity(row._id, 'revenue', event.target.value)}
          className="h-8 min-w-[90px] text-xs"
        />
      ),
    },
    {
      id: 'released',
      header: t('resales.columns.released'),
      accessorKey: 'released',
      disableFiltering: true,
      cell: ({ row }) => (
        <SelectControl
          options={releasedOptions}
          value={row.released ? 'true' : 'false'}
          onChange={(value) => updateDraftActivity(row._id, 'released', value === 'true')}
          className="min-w-[90px]"
          buttonClassName="h-8 text-xs"
          searchable={false}
        />
      ),
    },
    {
      id: 'dueDate',
      header: t('resales.columns.dueDate'),
      accessorKey: 'dueDate',
      disableFiltering: true,
      cell: ({ row }) => (
        <DateField
          value={row.dueDate}
          onChange={(value) => updateDraftActivity(row._id, 'dueDate', value)}
          className="h-8 min-w-[130px] text-xs"
        />
      ),
    },
    {
      id: 'notes',
      header: t('resales.columns.notes'),
      accessorKey: 'notes',
      disableFiltering: true,
      cell: ({ row }) => (
        <Input
          value={row.notes}
          placeholder="-"
          onChange={(event) => updateDraftActivity(row._id, 'notes', event.target.value)}
          className="h-8 min-w-[140px] text-xs"
        />
      ),
    },
    {
      id: 'actions',
      header: t('common:labels.actions'),
      align: 'right',
      disableFiltering: true,
      cell: ({ row }) => (
        <div className="flex justify-end">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={() => removeDraftActivity(row._id)}
                aria-label={t('common:buttons.delete')}
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('common:buttons.delete')}</TooltipContent>
          </Tooltip>
        </div>
      ),
    },
  ];

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
            onClick={openCategoryModal}
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
          <ModalContent size="2xl">
            <form onSubmit={submitResale} className="flex min-h-0 flex-col">
              <ModalHeader>
                <ModalTitle className="gap-3">
                  <span className="flex size-10 items-center justify-center rounded-md bg-muted text-primary">
                    <i className="fa-solid fa-cart-shopping" aria-hidden="true"></i>
                  </span>
                  {t('resales.createTitle')}
                </ModalTitle>
                <ModalCloseButton onClick={closeResaleModal} />
              </ModalHeader>
              <ModalBody className="space-y-6">
                <div className="space-y-4">
                  <div className="grid gap-4 md:grid-cols-2">
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
                        buttonClassName="h-9"
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
                        buttonClassName="h-9"
                      />
                      <FieldError className="text-xs">
                        {resaleForm.errors.supplierOrderId}
                      </FieldError>
                    </div>
                    <Field>
                      <FieldLabel htmlFor="resale-start-date">
                        {t('resales.fields.startDate')} <RequiredMark />
                      </FieldLabel>
                      <DateField
                        id="resale-start-date"
                        value={resaleForm.startDate}
                        onChange={(value) =>
                          setResaleForm((prev) => ({
                            ...prev,
                            startDate: value,
                            errors: { ...prev.errors, startDate: '' },
                          }))
                        }
                        required
                        aria-invalid={Boolean(resaleForm.errors.startDate)}
                      />
                      <FieldError className="text-xs">{resaleForm.errors.startDate}</FieldError>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="resale-due-date">
                        {t('resales.fields.dueDate')} <RequiredMark />
                      </FieldLabel>
                      <DateField
                        id="resale-due-date"
                        value={resaleForm.dueDate}
                        onChange={(value) =>
                          setResaleForm((prev) => ({
                            ...prev,
                            dueDate: value,
                            errors: { ...prev.errors, dueDate: '' },
                          }))
                        }
                        required
                        aria-invalid={Boolean(resaleForm.errors.dueDate)}
                      />
                      <FieldError className="text-xs">{resaleForm.errors.dueDate}</FieldError>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="resale-revenue">
                        {t('resales.fields.resaleRevenue')}
                      </FieldLabel>
                      <Input
                        id="resale-revenue"
                        value={formatMoney(draftResaleRevenue)}
                        readOnly
                        aria-readonly="true"
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="resale-cost">
                        {t('resales.fields.resaleCost')}
                      </FieldLabel>
                      <Input
                        id="resale-cost"
                        value={formatMoney(draftResaleCost)}
                        readOnly
                        aria-readonly="true"
                      />
                    </Field>
                    <Field className="md:col-span-2">
                      <FieldLabel htmlFor="resale-notes">{t('resales.fields.notes')}</FieldLabel>
                      <Textarea
                        id="resale-notes"
                        value={resaleForm.notes}
                        onChange={(event) =>
                          setResaleForm((prev) => ({ ...prev, notes: event.target.value }))
                        }
                        rows={3}
                        className="min-h-20 resize-none"
                      />
                    </Field>
                  </div>

                  <div className="space-y-2">
                    <StandardTable<DraftResaleActivity>
                      title={t('resales.initialActivitiesTitle')}
                      data={resaleForm.activities}
                      columns={draftActivityColumns}
                      defaultRowsPerPage={5}
                      emptyState={
                        <span className="text-xs italic text-muted-foreground">
                          {t('resales.noActivitiesAdded')}
                        </span>
                      }
                      headerAction={
                        <Button
                          type="button"
                          onClick={addDraftActivity}
                          size="sm"
                          className={TABLE_CONTROL_BUTTON_CLASSNAME}
                        >
                          <Plus className="size-4" />
                          {t('resales.addActivity')}
                        </Button>
                      }
                    />
                    <FieldError className="text-xs">{resaleForm.errors.activities}</FieldError>
                  </div>
                </div>
              </ModalBody>
              <ModalFooter className="sm:justify-between">
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

      <Modal isOpen={isCategoryModalOpen} onClose={closeCategoryModal}>
        {isCategoryModalOpen && (
          <ModalContent size="2xl">
            <ModalHeader>
              <ModalTitle className="gap-3">
                <span className="flex size-8 items-center justify-center rounded-md bg-muted text-primary">
                  <i className="fa-solid fa-folder-tree" aria-hidden="true"></i>
                </span>
                {t('resales.manageCategories')}
              </ModalTitle>
              <ModalCloseButton onClick={closeCategoryModal} />
            </ModalHeader>
            <ModalBody className="max-h-[60vh] space-y-4">
              <form
                onSubmit={submitCategory}
                className="space-y-3 rounded-md border border-border bg-muted/30 p-4"
              >
                <div className="flex items-start gap-3">
                  <Field className="flex-1 space-y-1.5">
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
                  {editingCategoryId && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setEditingCategoryId(null);
                        setCategoryName('');
                        setCategoryError('');
                      }}
                      className="mt-7"
                    >
                      {t('common:buttons.cancel')}
                    </Button>
                  )}
                  <Button type="submit" disabled={!canCreate && !canUpdate} className="mt-7">
                    {editingCategoryId ? t('common:buttons.save') : t('common:buttons.create')}
                  </Button>
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
