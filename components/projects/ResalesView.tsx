import { ArrowLeft, ListChecks, Pencil, Plus, Settings2, ShoppingCart, Trash2 } from 'lucide-react';
import type React from 'react';
import { useCallback, useMemo, useReducer } from 'react';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
import { formatDecimal } from '../../utils/numbers';
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
import ValidatedNumberInput from '../shared/ValidatedNumberInput';

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

type ResalesViewTab = 'archive' | 'activities';
type StateUpdate<T> = T | ((prev: T) => T);

const isResalesViewTab = (value: string): value is ResalesViewTab =>
  value === 'archive' || value === 'activities';

type ResalesUiState = {
  activeTab: ResalesViewTab;
  selectedResaleId: string | null;
  resaleForm: ResaleFormState;
  isResaleModalOpen: boolean;
  activityForm: ActivityFormState;
  isActivityModalOpen: boolean;
  isCategoryModalOpen: boolean;
  categoryName: string;
  editingCategoryId: string | null;
  categoryError: string;
  resaleToDelete: Resale | null;
  activityToDelete: ResaleActivity | null;
};

type ResalesUiAction =
  | { type: 'setActiveTab'; update: StateUpdate<ResalesViewTab> }
  | { type: 'setSelectedResaleId'; update: StateUpdate<string | null> }
  | { type: 'setResaleForm'; update: StateUpdate<ResaleFormState> }
  | { type: 'setIsResaleModalOpen'; update: StateUpdate<boolean> }
  | { type: 'setActivityForm'; update: StateUpdate<ActivityFormState> }
  | { type: 'setIsActivityModalOpen'; update: StateUpdate<boolean> }
  | { type: 'setIsCategoryModalOpen'; update: StateUpdate<boolean> }
  | { type: 'setCategoryName'; update: StateUpdate<string> }
  | { type: 'setEditingCategoryId'; update: StateUpdate<string | null> }
  | { type: 'setCategoryError'; update: StateUpdate<string> }
  | { type: 'setResaleToDelete'; update: StateUpdate<Resale | null> }
  | { type: 'setActivityToDelete'; update: StateUpdate<ResaleActivity | null> };

const resolveStateUpdate = <T,>(current: T, update: StateUpdate<T>): T =>
  typeof update === 'function' ? (update as (prev: T) => T)(current) : update;

const createResalesUiState = (): ResalesUiState => ({
  activeTab: 'archive',
  selectedResaleId: null,
  resaleForm: initialResaleForm,
  isResaleModalOpen: false,
  activityForm: initialActivityForm,
  isActivityModalOpen: false,
  isCategoryModalOpen: false,
  categoryName: '',
  editingCategoryId: null,
  categoryError: '',
  resaleToDelete: null,
  activityToDelete: null,
});

const resalesUiReducer = (state: ResalesUiState, action: ResalesUiAction): ResalesUiState => {
  switch (action.type) {
    case 'setActiveTab':
      return { ...state, activeTab: resolveStateUpdate(state.activeTab, action.update) };
    case 'setSelectedResaleId':
      return {
        ...state,
        selectedResaleId: resolveStateUpdate(state.selectedResaleId, action.update),
      };
    case 'setResaleForm':
      return { ...state, resaleForm: resolveStateUpdate(state.resaleForm, action.update) };
    case 'setIsResaleModalOpen':
      return {
        ...state,
        isResaleModalOpen: resolveStateUpdate(state.isResaleModalOpen, action.update),
      };
    case 'setActivityForm':
      return { ...state, activityForm: resolveStateUpdate(state.activityForm, action.update) };
    case 'setIsActivityModalOpen':
      return {
        ...state,
        isActivityModalOpen: resolveStateUpdate(state.isActivityModalOpen, action.update),
      };
    case 'setIsCategoryModalOpen':
      return {
        ...state,
        isCategoryModalOpen: resolveStateUpdate(state.isCategoryModalOpen, action.update),
      };
    case 'setCategoryName':
      return { ...state, categoryName: resolveStateUpdate(state.categoryName, action.update) };
    case 'setEditingCategoryId':
      return {
        ...state,
        editingCategoryId: resolveStateUpdate(state.editingCategoryId, action.update),
      };
    case 'setCategoryError':
      return { ...state, categoryError: resolveStateUpdate(state.categoryError, action.update) };
    case 'setResaleToDelete':
      return { ...state, resaleToDelete: resolveStateUpdate(state.resaleToDelete, action.update) };
    case 'setActivityToDelete':
      return {
        ...state,
        activityToDelete: resolveStateUpdate(state.activityToDelete, action.update),
      };
  }
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

const useResalesController = ({
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
}: ResalesViewProps) => {
  const { t, i18n } = useTranslation(['projects', 'common']);
  const canCreate = hasPermission(permissions, buildPermission('projects.resales', 'create'));
  const canUpdate = hasPermission(permissions, buildPermission('projects.resales', 'update'));
  const canDelete = hasPermission(permissions, buildPermission('projects.resales', 'delete'));

  const [uiState, dispatchUiState] = useReducer(resalesUiReducer, undefined, createResalesUiState);
  const {
    activeTab,
    selectedResaleId,
    resaleForm,
    isResaleModalOpen,
    activityForm,
    isActivityModalOpen,
    isCategoryModalOpen,
    categoryName,
    editingCategoryId,
    categoryError,
    resaleToDelete,
    activityToDelete,
  } = uiState;
  const setActiveTab = useCallback(
    (update: StateUpdate<ResalesViewTab>) => dispatchUiState({ type: 'setActiveTab', update }),
    [],
  );
  const setSelectedResaleId = useCallback(
    (update: StateUpdate<string | null>) =>
      dispatchUiState({ type: 'setSelectedResaleId', update }),
    [],
  );
  const setResaleForm = useCallback(
    (update: StateUpdate<ResaleFormState>) => dispatchUiState({ type: 'setResaleForm', update }),
    [],
  );
  const setIsResaleModalOpen = useCallback(
    (update: StateUpdate<boolean>) => dispatchUiState({ type: 'setIsResaleModalOpen', update }),
    [],
  );
  const setActivityForm = useCallback(
    (update: StateUpdate<ActivityFormState>) =>
      dispatchUiState({ type: 'setActivityForm', update }),
    [],
  );
  const setIsActivityModalOpen = useCallback(
    (update: StateUpdate<boolean>) => dispatchUiState({ type: 'setIsActivityModalOpen', update }),
    [],
  );
  const setIsCategoryModalOpen = useCallback(
    (update: StateUpdate<boolean>) => dispatchUiState({ type: 'setIsCategoryModalOpen', update }),
    [],
  );
  const setCategoryName = useCallback(
    (update: StateUpdate<string>) => dispatchUiState({ type: 'setCategoryName', update }),
    [],
  );
  const setEditingCategoryId = useCallback(
    (update: StateUpdate<string | null>) =>
      dispatchUiState({ type: 'setEditingCategoryId', update }),
    [],
  );
  const setCategoryError = useCallback(
    (update: StateUpdate<string>) => dispatchUiState({ type: 'setCategoryError', update }),
    [],
  );
  const setResaleToDelete = useCallback(
    (update: StateUpdate<Resale | null>) => dispatchUiState({ type: 'setResaleToDelete', update }),
    [],
  );
  const setActivityToDelete = useCallback(
    (update: StateUpdate<ResaleActivity | null>) =>
      dispatchUiState({ type: 'setActivityToDelete', update }),
    [],
  );

  const selectedResale = selectedResaleId
    ? resales.find((resale) => resale.id === selectedResaleId)
    : null;
  const selectedTab: ResalesViewTab = selectedResale ? activeTab : 'archive';
  const clearSelectedResale = () => {
    setSelectedResaleId(null);
    setActiveTab('archive');
  };
  const handleTabChange = (value: string) => {
    if (!isResalesViewTab(value)) return;
    if (value === 'activities' && !selectedResale) return;
    setActiveTab(value);
  };

  const formatMoney = useCallback(
    (value: number) => `${formatDecimal(value)} ${currency}`,
    [currency],
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
      setActiveTab('activities');
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
    [canUpdate, setActivityForm, setIsActivityModalOpen],
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
        id: 'startDate',
        header: t('resales.columns.startDate'),
        accessorKey: 'startDate',
        className: 'whitespace-nowrap',
        filterFormat: (value) =>
          value ? formatDateOnlyForLocale(String(value), i18n.language) : '-',
        cell: ({ row }) =>
          row.startDate ? (
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              {formatDateOnlyForLocale(row.startDate, i18n.language)}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">-</span>
          ),
      },
      {
        id: 'dueDate',
        header: t('resales.columns.endDate'),
        accessorKey: 'dueDate',
        className: 'whitespace-nowrap',
        filterFormat: (value) =>
          value ? formatDateOnlyForLocale(String(value), i18n.language) : '-',
        cell: ({ row }) =>
          row.dueDate ? (
            <span className="text-xs text-muted-foreground whitespace-nowrap">
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
    [canDelete, formatMoney, i18n.language, setResaleToDelete, t],
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
    [canDelete, canUpdate, formatMoney, i18n.language, openEditActivity, setActivityToDelete, t],
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
    [
      canDelete,
      canUpdate,
      onDeleteCategory,
      setCategoryError,
      setCategoryName,
      setEditingCategoryId,
      t,
    ],
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
        <ValidatedNumberInput
          min="0"
          required
          value={row.cost}
          placeholder="0,00"
          onValueChange={(value) => updateDraftActivity(row._id, 'cost', value)}
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
        <ValidatedNumberInput
          min="0"
          required
          value={row.revenue}
          placeholder="0,00"
          onValueChange={(value) => updateDraftActivity(row._id, 'revenue', value)}
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

  return {
    t,
    activeTab,
    selectedTab,
    selectedResale,
    selectedResaleId,
    canCreate,
    canUpdate,
    canDelete,
    resales,
    categories,
    currency,
    resaleColumns,
    activityColumns,
    categoryColumns,
    draftActivityColumns,
    resaleForm,
    activityForm,
    isResaleModalOpen,
    isActivityModalOpen,
    isCategoryModalOpen,
    categoryName,
    editingCategoryId,
    categoryError,
    resaleToDelete,
    activityToDelete,
    clientOrderOptions,
    supplierOrderOptions,
    billingOptions,
    categoryOptions,
    draftResaleRevenue,
    draftResaleCost,
    handleTabChange,
    clearSelectedResale,
    openCategoryModal,
    openCreateResale,
    openCreateActivity,
    closeResaleModal,
    closeActivityModal,
    closeCategoryModal,
    submitResale,
    submitActivity,
    submitCategory,
    addDraftActivity,
    setActiveTab,
    setSelectedResaleId,
    setResaleForm,
    setActivityForm,
    setCategoryName,
    setCategoryError,
    setEditingCategoryId,
    setResaleToDelete,
    setActivityToDelete,
    formatMoney,
    onDeleteResale,
    onDeleteActivity,
  };
};

type ResalesController = ReturnType<typeof useResalesController>;

const ResalesView: React.FC<ResalesViewProps> = (props) => {
  const controller = useResalesController(props);
  return <ResalesLayout controller={controller} />;
};

const ResalesLayout: React.FC<{ controller: ResalesController }> = ({ controller }) => (
  <div className="space-y-6">
    <Tabs
      value={controller.selectedTab}
      onValueChange={controller.handleTabChange}
      className="space-y-6"
    >
      <TabsList variant="line" className="w-full justify-start overflow-x-auto border-b px-0">
        <TabsTrigger value="archive" className="flex-none rounded-none pb-3">
          <ShoppingCart className="size-4" aria-hidden="true" />
          {controller.t('resales.tabs.archive')}
        </TabsTrigger>
        <TabsTrigger
          value="activities"
          className="flex-none rounded-none pb-3"
          disabled={!controller.selectedResale}
        >
          <ListChecks className="size-4" aria-hidden="true" />
          {controller.t('resales.tabs.activities')}
        </TabsTrigger>
      </TabsList>

      <ResalesArchiveTab controller={controller} />
      <ResalesActivitiesTab controller={controller} />
    </Tabs>

    <ResaleCreateModal controller={controller} />
    <ResaleActivityModal controller={controller} />
    <ResaleCategoryModal controller={controller} />
    <ResaleDeleteDialogs controller={controller} />
  </div>
);

const ResalesArchiveTab: React.FC<{ controller: ResalesController }> = ({ controller }) => (
  <TabsContent value="archive" className="mt-0 space-y-6">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h2 className="text-2xl font-semibold text-foreground">{controller.t('resales.title')}</h2>
        <p className="text-sm text-muted-foreground">{controller.t('resales.subtitle')}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={controller.openCategoryModal}
          disabled={!controller.canCreate && !controller.canUpdate && !controller.canDelete}
        >
          <Settings2 className="size-4" />
          {controller.t('resales.manageCategories')}
        </Button>
        {controller.canCreate && (
          <HeaderAddButton onClick={controller.openCreateResale}>
            {controller.t('resales.addResale')}
          </HeaderAddButton>
        )}
      </div>
    </div>

    <StandardTable<Resale>
      title={controller.t('resales.directory')}
      viewKey="projects.resales"
      data={controller.resales}
      columns={controller.resaleColumns}
      defaultRowsPerPage={5}
      onRowClick={(row) => {
        controller.setSelectedResaleId(row.id);
        controller.setActiveTab('activities');
      }}
    />
  </TabsContent>
);

const ResalesActivitiesTab: React.FC<{ controller: ResalesController }> = ({ controller }) => (
  <TabsContent value="activities" className="mt-0">
    {controller.selectedResale ? (
      <section className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={controller.clearSelectedResale}
              className="-ml-2"
            >
              <ArrowLeft className="size-4" />
              {controller.t('common:buttons.back')}
            </Button>
            <h3 className="text-xl font-semibold text-foreground">
              {controller.selectedResale.clientOrderId} /{' '}
              {controller.selectedResale.supplierOrderId}
            </h3>
            <p className="text-sm text-muted-foreground">
              {controller.selectedResale.clientName} · {controller.selectedResale.supplierName}
            </p>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          <ResaleSummaryCard
            label={controller.t('resales.columns.revenue')}
            value={controller.formatMoney(controller.selectedResale.resaleRevenue)}
          />
          <ResaleSummaryCard
            label={controller.t('resales.columns.supplierCost')}
            value={controller.formatMoney(controller.selectedResale.supplierOrderCost)}
          />
          <ResaleSummaryCard
            label={controller.t('resales.columns.activityCost')}
            value={controller.formatMoney(controller.selectedResale.activityCostTotal)}
          />
          <div className="rounded-lg border border-border bg-background p-4">
            <p className="text-xs font-medium uppercase text-muted-foreground">
              {controller.t('resales.columns.variance')}
            </p>
            <div className="mt-2">
              {Math.abs(controller.selectedResale.costVariance) > 0.009 ? (
                <StatusBadge
                  type="pending"
                  label={controller.formatMoney(controller.selectedResale.costVariance)}
                />
              ) : (
                <StatusBadge type="active" label={controller.t('resales.balanced')} />
              )}
            </div>
            {Math.abs(controller.selectedResale.costVariance) > 0.009 && (
              <p className="mt-2 text-xs text-muted-foreground">
                {controller.t('resales.varianceHint')}
              </p>
            )}
          </div>
        </div>

        <StandardTable<ResaleActivity>
          title={controller.t('resales.activitiesTitle')}
          data={controller.selectedResale.activities}
          columns={controller.activityColumns}
          defaultRowsPerPage={5}
          headerAction={
            controller.canCreate ? (
              <Button
                type="button"
                size="sm"
                onClick={controller.openCreateActivity}
                className={TABLE_CONTROL_BUTTON_CLASSNAME}
              >
                <Plus className="size-4" />
                {controller.t('resales.addActivity')}
              </Button>
            ) : undefined
          }
        />
      </section>
    ) : (
      <div className="rounded-md border border-dashed border-border bg-muted/20 px-4 py-8 text-sm text-muted-foreground">
        {controller.t('resales.selectResaleForActivities')}
      </div>
    )}
  </TabsContent>
);

const ResaleSummaryCard: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="rounded-lg border border-border bg-background p-4">
    <p className="text-xs font-medium uppercase text-muted-foreground">{label}</p>
    <p className="mt-2 font-mono text-xl font-semibold">{value}</p>
  </div>
);

const ResaleCreateModal: React.FC<{ controller: ResalesController }> = ({ controller }) => (
  <Modal isOpen={controller.isResaleModalOpen} onClose={controller.closeResaleModal}>
    {controller.isResaleModalOpen && (
      <ModalContent size="2xl">
        <form onSubmit={controller.submitResale} className="flex min-h-0 flex-col">
          <ModalHeader>
            <ModalTitle className="gap-3">
              <span className="flex size-10 items-center justify-center rounded-md bg-muted text-primary">
                <i className="fa-solid fa-cart-shopping" aria-hidden="true"></i>
              </span>
              {controller.t('resales.createTitle')}
            </ModalTitle>
            <ModalCloseButton onClick={controller.closeResaleModal} />
          </ModalHeader>
          <ModalBody className="space-y-6">
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <SelectControl
                    id="resale-client-order"
                    options={controller.clientOrderOptions}
                    value={controller.resaleForm.clientOrderId}
                    onChange={(value) =>
                      controller.setResaleForm((prev) => ({
                        ...prev,
                        clientOrderId: value as string,
                        supplierOrderId: '',
                        errors: { ...prev.errors, clientOrderId: '', supplierOrderId: '' },
                      }))
                    }
                    label={
                      <>
                        {controller.t('resales.fields.clientOrder')} <RequiredMark />
                      </>
                    }
                    searchable
                    placeholder={controller.t('resales.placeholders.clientOrder')}
                    buttonClassName="h-9"
                  />
                  <FieldError className="text-xs">
                    {controller.resaleForm.errors.clientOrderId}
                  </FieldError>
                </div>
                <div className="space-y-1.5">
                  <SelectControl
                    id="resale-supplier-order"
                    options={controller.supplierOrderOptions}
                    value={controller.resaleForm.supplierOrderId}
                    onChange={(value) =>
                      controller.setResaleForm((prev) => ({
                        ...prev,
                        supplierOrderId: value as string,
                        errors: { ...prev.errors, supplierOrderId: '' },
                      }))
                    }
                    label={
                      <>
                        {controller.t('resales.fields.supplierOrder')} <RequiredMark />
                      </>
                    }
                    searchable
                    disabled={!controller.resaleForm.clientOrderId}
                    placeholder={controller.t('resales.placeholders.supplierOrder')}
                    buttonClassName="h-9"
                  />
                  <FieldError className="text-xs">
                    {controller.resaleForm.errors.supplierOrderId}
                  </FieldError>
                </div>
                <Field>
                  <FieldLabel htmlFor="resale-start-date">
                    {controller.t('resales.fields.startDate')} <RequiredMark />
                  </FieldLabel>
                  <DateField
                    id="resale-start-date"
                    value={controller.resaleForm.startDate}
                    onChange={(value) =>
                      controller.setResaleForm((prev) => ({
                        ...prev,
                        startDate: value,
                        errors: { ...prev.errors, startDate: '' },
                      }))
                    }
                    required
                    aria-invalid={Boolean(controller.resaleForm.errors.startDate)}
                  />
                  <FieldError className="text-xs">
                    {controller.resaleForm.errors.startDate}
                  </FieldError>
                </Field>
                <Field>
                  <FieldLabel htmlFor="resale-due-date">
                    {controller.t('resales.fields.dueDate')} <RequiredMark />
                  </FieldLabel>
                  <DateField
                    id="resale-due-date"
                    value={controller.resaleForm.dueDate}
                    onChange={(value) =>
                      controller.setResaleForm((prev) => ({
                        ...prev,
                        dueDate: value,
                        errors: { ...prev.errors, dueDate: '' },
                      }))
                    }
                    required
                    aria-invalid={Boolean(controller.resaleForm.errors.dueDate)}
                  />
                  <FieldError className="text-xs">
                    {controller.resaleForm.errors.dueDate}
                  </FieldError>
                </Field>
                <ReadOnlyMoneyField
                  id="resale-revenue"
                  label={controller.t('resales.fields.resaleRevenue')}
                  value={controller.formatMoney(controller.draftResaleRevenue)}
                />
                <ReadOnlyMoneyField
                  id="resale-cost"
                  label={controller.t('resales.fields.resaleCost')}
                  value={controller.formatMoney(controller.draftResaleCost)}
                />
                <Field className="md:col-span-2">
                  <FieldLabel htmlFor="resale-notes">
                    {controller.t('resales.fields.notes')}
                  </FieldLabel>
                  <Textarea
                    id="resale-notes"
                    value={controller.resaleForm.notes}
                    onChange={(event) =>
                      controller.setResaleForm((prev) => ({ ...prev, notes: event.target.value }))
                    }
                    rows={3}
                    className="min-h-20 resize-none"
                  />
                </Field>
              </div>

              <div className="space-y-2">
                <StandardTable<DraftResaleActivity>
                  title={controller.t('resales.initialActivitiesTitle')}
                  data={controller.resaleForm.activities}
                  columns={controller.draftActivityColumns}
                  defaultRowsPerPage={5}
                  emptyState={
                    <span className="text-xs italic text-muted-foreground">
                      {controller.t('resales.noActivitiesAdded')}
                    </span>
                  }
                  headerAction={
                    <Button
                      type="button"
                      onClick={controller.addDraftActivity}
                      size="sm"
                      className={TABLE_CONTROL_BUTTON_CLASSNAME}
                    >
                      <Plus className="size-4" />
                      {controller.t('resales.addActivity')}
                    </Button>
                  }
                />
                <FieldError className="text-xs">
                  {controller.resaleForm.errors.activities}
                </FieldError>
              </div>
            </div>
          </ModalBody>
          <ModalFooter className="sm:justify-between">
            <Button type="button" variant="outline" onClick={controller.closeResaleModal}>
              {controller.t('common:buttons.cancel')}
            </Button>
            <Button type="submit">{controller.t('common:buttons.create')}</Button>
          </ModalFooter>
        </form>
      </ModalContent>
    )}
  </Modal>
);

const ReadOnlyMoneyField: React.FC<{ id: string; label: string; value: string }> = ({
  id,
  label,
  value,
}) => (
  <Field>
    <FieldLabel htmlFor={id}>{label}</FieldLabel>
    <Input id={id} value={value} readOnly aria-readonly="true" />
  </Field>
);

const ResaleActivityModal: React.FC<{ controller: ResalesController }> = ({ controller }) => (
  <Modal isOpen={controller.isActivityModalOpen} onClose={controller.closeActivityModal}>
    {controller.isActivityModalOpen && (
      <ModalContent size="2xl">
        <form onSubmit={controller.submitActivity}>
          <ModalHeader>
            <ModalTitle>
              {controller.activityForm.id
                ? controller.t('resales.editActivity')
                : controller.t('resales.addActivity')}
            </ModalTitle>
            <ModalCloseButton onClick={controller.closeActivityModal} />
          </ModalHeader>
          <ModalBody>
            <div className="grid gap-4 md:grid-cols-2">
              <Field className="md:col-span-2">
                <FieldLabel htmlFor="resale-activity-name">
                  {controller.t('resales.columns.activityName')} <RequiredMark />
                </FieldLabel>
                <Input
                  id="resale-activity-name"
                  value={controller.activityForm.name}
                  onChange={(event) =>
                    controller.setActivityForm((prev) => ({ ...prev, name: event.target.value }))
                  }
                />
                <FieldError className="text-xs">{controller.activityForm.errors.name}</FieldError>
              </Field>
              <div className="space-y-1.5">
                <SelectControl
                  id="resale-activity-billing"
                  options={controller.billingOptions}
                  value={controller.activityForm.billingFrequency}
                  onChange={(value) =>
                    controller.setActivityForm((prev) => ({
                      ...prev,
                      billingFrequency: value as ResaleBillingFrequency,
                    }))
                  }
                  label={controller.t('resales.columns.billing')}
                  searchable={false}
                />
              </div>
              <div className="space-y-1.5">
                <SelectControl
                  id="resale-activity-category"
                  options={controller.categoryOptions}
                  value={controller.activityForm.categoryId}
                  onChange={(value) =>
                    controller.setActivityForm((prev) => ({
                      ...prev,
                      categoryId: value as string,
                      errors: { ...prev.errors, categoryId: '' },
                    }))
                  }
                  label={
                    <>
                      {controller.t('resales.columns.category')} <RequiredMark />
                    </>
                  }
                  searchable
                />
                <FieldError className="text-xs">
                  {controller.activityForm.errors.categoryId}
                </FieldError>
              </div>
              <ActivityMoneyInput controller={controller} field="cost" />
              <ActivityMoneyInput controller={controller} field="revenue" />
              <Field>
                <FieldLabel htmlFor="resale-activity-due-date">
                  {controller.t('resales.columns.dueDate')}
                </FieldLabel>
                <DateField
                  id="resale-activity-due-date"
                  value={controller.activityForm.dueDate}
                  onChange={(value) =>
                    controller.setActivityForm((prev) => ({ ...prev, dueDate: value }))
                  }
                />
                <FieldDescription className="text-xs">
                  {controller.t('resales.activityDueDateHint')}
                </FieldDescription>
              </Field>
              <Field className="flex-row items-center gap-2">
                <Checkbox
                  id="resale-activity-released"
                  checked={controller.activityForm.released}
                  onCheckedChange={(checked) =>
                    controller.setActivityForm((prev) => ({
                      ...prev,
                      released: checked === true,
                    }))
                  }
                />
                <FieldLabel htmlFor="resale-activity-released" className="font-normal">
                  {controller.t('resales.columns.released')}
                </FieldLabel>
              </Field>
              <Field className="md:col-span-2">
                <FieldLabel htmlFor="resale-activity-notes">
                  {controller.t('resales.columns.notes')}
                </FieldLabel>
                <Textarea
                  id="resale-activity-notes"
                  value={controller.activityForm.notes}
                  onChange={(event) =>
                    controller.setActivityForm((prev) => ({ ...prev, notes: event.target.value }))
                  }
                />
              </Field>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button type="button" variant="outline" onClick={controller.closeActivityModal}>
              {controller.t('common:buttons.cancel')}
            </Button>
            <Button type="submit">
              {controller.activityForm.id
                ? controller.t('common:buttons.save')
                : controller.t('common:buttons.create')}
            </Button>
          </ModalFooter>
        </form>
      </ModalContent>
    )}
  </Modal>
);

const ActivityMoneyInput: React.FC<{
  controller: ResalesController;
  field: 'cost' | 'revenue';
}> = ({ controller, field }) => (
  <Field>
    <FieldLabel htmlFor={`resale-activity-${field}`}>
      {controller.t(`resales.columns.${field}`)} ({controller.currency}) <RequiredMark />
    </FieldLabel>
    <ValidatedNumberInput
      id={`resale-activity-${field}`}
      min="0"
      value={controller.activityForm[field]}
      onValueChange={(value) => controller.setActivityForm((prev) => ({ ...prev, [field]: value }))}
    />
    <FieldError className="text-xs">{controller.activityForm.errors[field]}</FieldError>
  </Field>
);

const ResaleCategoryModal: React.FC<{ controller: ResalesController }> = ({ controller }) => (
  <Modal isOpen={controller.isCategoryModalOpen} onClose={controller.closeCategoryModal}>
    {controller.isCategoryModalOpen && (
      <ModalContent size="2xl">
        <ModalHeader>
          <ModalTitle className="gap-3">
            <span className="flex size-8 items-center justify-center rounded-md bg-muted text-primary">
              <i className="fa-solid fa-folder-tree" aria-hidden="true"></i>
            </span>
            {controller.t('resales.manageCategories')}
          </ModalTitle>
          <ModalCloseButton onClick={controller.closeCategoryModal} />
        </ModalHeader>
        <ModalBody className="max-h-[60vh] space-y-4">
          <form
            onSubmit={controller.submitCategory}
            className="space-y-3 rounded-md border border-border bg-muted/30 p-4"
          >
            <div className="flex items-start gap-3">
              <Field className="flex-1 space-y-1.5">
                <FieldLabel htmlFor="resale-category-name">
                  {controller.t('resales.fields.categoryName')}
                </FieldLabel>
                <Input
                  id="resale-category-name"
                  value={controller.categoryName}
                  onChange={(event) => {
                    controller.setCategoryName(event.target.value);
                    controller.setCategoryError('');
                  }}
                />
                <FieldError className="text-xs">{controller.categoryError}</FieldError>
              </Field>
              {controller.editingCategoryId && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    controller.setEditingCategoryId(null);
                    controller.setCategoryName('');
                    controller.setCategoryError('');
                  }}
                  className="mt-7"
                >
                  {controller.t('common:buttons.cancel')}
                </Button>
              )}
              <Button
                type="submit"
                disabled={!controller.canCreate && !controller.canUpdate}
                className="mt-7"
              >
                {controller.editingCategoryId
                  ? controller.t('common:buttons.save')
                  : controller.t('common:buttons.create')}
              </Button>
            </div>
          </form>
          <StandardTable<ResaleCategory>
            title={controller.t('resales.categoriesDirectory')}
            data={controller.categories}
            columns={controller.categoryColumns}
            defaultRowsPerPage={5}
          />
        </ModalBody>
      </ModalContent>
    )}
  </Modal>
);

const ResaleDeleteDialogs: React.FC<{ controller: ResalesController }> = ({ controller }) => (
  <>
    <DeleteConfirmModal
      isOpen={!!controller.resaleToDelete}
      onClose={() => controller.setResaleToDelete(null)}
      onConfirm={async () => {
        if (controller.resaleToDelete) {
          await controller.onDeleteResale(controller.resaleToDelete.id);
          if (controller.selectedResaleId === controller.resaleToDelete.id) {
            controller.clearSelectedResale();
          }
        }
        controller.setResaleToDelete(null);
      }}
      title={controller.t('resales.deleteTitle')}
      description={controller.t('resales.deleteDescription', { id: controller.resaleToDelete?.id })}
    />

    <DeleteConfirmModal
      isOpen={!!controller.activityToDelete}
      onClose={() => controller.setActivityToDelete(null)}
      onConfirm={async () => {
        if (controller.selectedResale && controller.activityToDelete) {
          await controller.onDeleteActivity(
            controller.selectedResale.id,
            controller.activityToDelete.id,
          );
        }
        controller.setActivityToDelete(null);
      }}
      title={controller.t('resales.deleteActivityTitle')}
      description={controller.t('resales.deleteActivityDescription', {
        name: controller.activityToDelete?.name,
      })}
    />
  </>
);

export default ResalesView;
