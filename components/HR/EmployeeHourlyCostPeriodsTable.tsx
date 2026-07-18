import { Check, Info, Pencil, Plus, Trash2 } from 'lucide-react';
import type React from 'react';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Column } from '@/components/shared/StandardTable';
import { Button } from '@/components/ui/button';
import { FieldError } from '@/components/ui/field';
import { InputGroup, InputGroupAddon } from '@/components/ui/input-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { addDaysToDateOnly, formatDateOnlyForLocale } from '../../utils/date';
import { formatDecimal } from '../../utils/numbers';
import DateField from '../shared/DateField';
import StandardTable from '../shared/StandardTable';
import ValidatedNumberInput from '../shared/ValidatedNumberInput';
import {
  createEmptyHourlyCostPeriodDraft,
  type EmployeeHourlyCostPeriodDraft,
  sortHourlyCostPeriodDrafts,
} from './employeeHrProfile';

type EmployeeHourlyCostPeriodsTableProps = {
  periods: EmployeeHourlyCostPeriodDraft[];
  onChange: React.Dispatch<React.SetStateAction<EmployeeHourlyCostPeriodDraft[]>>;
  errors: Record<string, string>;
  currency: string;
  canUpdate: boolean;
  isLoading: boolean;
  loadError: string | null;
};

const EmployeeHourlyCostPeriodsTable: React.FC<EmployeeHourlyCostPeriodsTableProps> = ({
  periods,
  onChange,
  errors,
  currency,
  canUpdate,
  isLoading,
  loadError,
}) => {
  const { t, i18n } = useTranslation(['hr', 'common']);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const sortedPeriods = useMemo(() => sortHourlyCostPeriodDrafts(periods), [periods]);

  const patchPeriod = useCallback(
    (
      key: string,
      update: Partial<Pick<EmployeeHourlyCostPeriodDraft, 'effectiveFrom' | 'costPerHour'>>,
    ) =>
      onChange((current) =>
        current.map((period) => (period.key === key ? { ...period, ...update } : period)),
      ),
    [onChange],
  );

  const removePeriod = useCallback(
    (key: string) => {
      setEditingKey((current) => (current === key ? null : current));
      onChange((current) => current.filter((period) => period.key !== key));
    },
    [onChange],
  );

  const patchEffectiveTo = useCallback(
    (key: string, effectiveTo: string) =>
      onChange((current) => {
        const ordered = sortHourlyCostPeriodDrafts(current);
        const index = ordered.findIndex((period) => period.key === key);
        const nextPeriod = ordered[index + 1];
        if (!nextPeriod || !effectiveTo) return current;

        const nextEffectiveFrom = addDaysToDateOnly(effectiveTo, 1);
        return current.map((period) =>
          period.key === nextPeriod.key ? { ...period, effectiveFrom: nextEffectiveFrom } : period,
        );
      }),
    [onChange],
  );

  const addPeriod = useCallback(() => {
    const period = createEmptyHourlyCostPeriodDraft();
    setEditingKey(period.key);
    onChange((current) => [...current, period]);
  }, [onChange]);

  const columns = useMemo<Column<EmployeeHourlyCostPeriodDraft>[]>(
    () => [
      {
        id: 'effectiveFrom',
        header: t('employeeProfile.costPeriods.from'),
        accessorFn: (period) => period.effectiveFrom ?? '',
        minWidth: 190,
        disableFiltering: true,
        disableSorting: true,
        cell: ({ row }) => {
          if (row.effectiveFrom === null) {
            return (
              <span className="text-sm font-medium">
                {t('employeeProfile.costPeriods.fromBeginning')}
              </span>
            );
          }

          const error = errors[`hourlyCostPeriods.${row.key}.effectiveFrom`];
          if (!canUpdate || editingKey !== row.key) {
            return row.effectiveFrom
              ? formatDateOnlyForLocale(row.effectiveFrom, i18n.language)
              : '—';
          }

          return (
            <div className="min-w-44 space-y-1">
              <DateField
                value={row.effectiveFrom}
                onChange={(effectiveFrom) => patchPeriod(row.key, { effectiveFrom })}
                required
                aria-invalid={Boolean(error)}
                aria-label={t('employeeProfile.costPeriods.from')}
              />
              <FieldError className="text-xs">{error}</FieldError>
            </div>
          );
        },
      },
      {
        id: 'effectiveTo',
        header: t('employeeProfile.costPeriods.to'),
        accessorFn: (period) => {
          const index = sortedPeriods.findIndex((candidate) => candidate.key === period.key);
          const nextFrom = sortedPeriods[index + 1]?.effectiveFrom;
          return nextFrom || '';
        },
        minWidth: 150,
        disableFiltering: true,
        disableSorting: true,
        cell: ({ row }) => {
          const index = sortedPeriods.findIndex((candidate) => candidate.key === row.key);
          const nextFrom = sortedPeriods[index + 1]?.effectiveFrom;
          if (canUpdate && editingKey === row.key && nextFrom) {
            return (
              <div className="min-w-44">
                <DateField
                  value={addDaysToDateOnly(nextFrom, -1)}
                  onChange={(effectiveTo) => patchEffectiveTo(row.key, effectiveTo)}
                  required
                  aria-label={t('employeeProfile.costPeriods.to')}
                />
              </div>
            );
          }

          return nextFrom
            ? formatDateOnlyForLocale(addDaysToDateOnly(nextFrom, -1), i18n.language)
            : t('employeeProfile.costPeriods.toPresent');
        },
      },
      {
        id: 'costPerHour',
        header: t('employeeProfile.costPeriods.costPerHour'),
        accessorFn: (period) => Number(period.costPerHour),
        minWidth: 190,
        disableFiltering: true,
        disableSorting: true,
        cell: ({ row }) => {
          const error = errors[`hourlyCostPeriods.${row.key}.costPerHour`];
          if (!canUpdate || editingKey !== row.key) {
            const cost = Number(row.costPerHour);
            return `${currency} ${Number.isFinite(cost) ? formatDecimal(cost, 2) : '—'}`;
          }

          return (
            <div className="min-w-40 space-y-1">
              <InputGroup>
                <InputGroupAddon align="inline-start">{currency}</InputGroupAddon>
                <ValidatedNumberInput
                  data-slot="input-group-control"
                  min="0"
                  value={row.costPerHour}
                  onValueChange={(costPerHour) => patchPeriod(row.key, { costPerHour })}
                  className="h-9 min-w-0 flex-1 rounded-none border-0 bg-transparent px-2 shadow-none focus-visible:ring-0 dark:bg-transparent"
                  placeholder="0,00"
                  aria-invalid={Boolean(error)}
                  aria-label={t('employeeProfile.costPeriods.costPerHour')}
                />
              </InputGroup>
              <FieldError className="text-xs">{error}</FieldError>
            </div>
          );
        },
      },
      {
        id: 'actions',
        header: t('common:labels.actions'),
        align: 'right',
        sticky: 'right',
        minWidth: 90,
        disableFiltering: true,
        disableSorting: true,
        cell: ({ row }) => {
          if (!canUpdate) return null;
          const isEditing = editingKey === row.key;
          const editLabel = t(isEditing ? 'common:buttons.done' : 'common:buttons.edit');

          return (
            <div className="flex items-center justify-end gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => setEditingKey(isEditing ? null : row.key)}
                    aria-label={editLabel}
                  >
                    {isEditing ? (
                      <Check className="size-3.5 text-primary" aria-hidden="true" />
                    ) : (
                      <Pencil className="size-3.5 text-primary" aria-hidden="true" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{editLabel}</TooltipContent>
              </Tooltip>
              {row.effectiveFrom !== null && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => removePeriod(row.key)}
                      aria-label={t('employeeProfile.costPeriods.delete')}
                    >
                      <Trash2 className="size-3.5 text-destructive" aria-hidden="true" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t('employeeProfile.costPeriods.delete')}</TooltipContent>
                </Tooltip>
              )}
            </div>
          );
        },
      },
    ],
    [
      canUpdate,
      currency,
      editingKey,
      errors,
      i18n.language,
      patchEffectiveTo,
      patchPeriod,
      removePeriod,
      sortedPeriods,
      t,
    ],
  );

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-1.5">
        <h3 className="text-sm font-semibold text-foreground">
          {t('employeeProfile.costPeriods.title')}
        </h3>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="rounded-full text-muted-foreground hover:text-foreground"
              aria-label={t('employeeProfile.costPeriods.description')}
            >
              <Info className="size-3.5" aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">
            {t('employeeProfile.costPeriods.description')}
          </TooltipContent>
        </Tooltip>
      </div>

      {loadError && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {loadError}
        </div>
      )}
      {errors.hourlyCostPeriods && (
        <div className="text-sm text-destructive">{errors.hourlyCostPeriods}</div>
      )}

      <StandardTable<EmployeeHourlyCostPeriodDraft>
        title={t('employeeProfile.costPeriods.tableTitle')}
        persistenceKey="hr.employee-hourly-cost-periods"
        data={sortedPeriods}
        columns={columns}
        isLoading={isLoading}
        allowColumnHiding={false}
        showConfigurationControls={false}
        defaultRowsPerPage={5}
        autoRevealNewRows
        minBodyRows={0}
        popupZIndex={90}
        tableContainerClassName="overflow-x-auto"
        headerAction={
          canUpdate ? (
            <Button
              type="button"
              size="sm"
              onClick={addPeriod}
              disabled={isLoading || Boolean(loadError)}
            >
              <Plus className="size-4" aria-hidden="true" />
              {t('employeeProfile.costPeriods.add')}
            </Button>
          ) : null
        }
      />
    </section>
  );
};

export default EmployeeHourlyCostPeriodsTable;
