import { CalendarClockIcon, PlusIcon, RadarIcon, Trash2Icon } from 'lucide-react';
import type React from 'react';
import { useMemo, useReducer, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type {
  ProjectRule,
  ProjectRuleActionConfig,
  ProjectRuleActionType,
  ProjectRuleCondition,
  ProjectRuleConditionLogic,
  ProjectRuleConditionValueType,
  ProjectRuleEvaluationMode,
  ProjectRuleNotifyRecipientType,
  ProjectRuleRecipientOptions,
  ProjectRuleSchedule,
  ProjectRuleScheduleFrequency,
} from '../../types';
import { hasPermission } from '../../utils/permissions';
import { formatRecurrencePattern } from '../../utils/recurrence';
import CustomRepeatModal from '../shared/CustomRepeatModal';
import SelectControl from '../shared/SelectControl';
import ValidatedNumberInput from '../shared/ValidatedNumberInput';
import {
  getAvailableProjectRuleFields,
  getAvailableProjectRuleValueFields,
  getProjectRuleFieldDefinition,
  getProjectRuleValueLabelKey,
  isProjectRuleUnaryOperator,
  isValidProjectRuleConditionValue,
  type ProjectRuleFieldGroup,
} from './projectRuleRegistry';

export type ProjectRuleFormPayload = {
  name: string;
  field: string;
  operator: string;
  value: string;
  conditionLogic: ProjectRuleConditionLogic;
  conditions: ProjectRuleCondition[];
  actionType: ProjectRuleActionType;
  actionConfig: ProjectRuleActionConfig;
  evaluationMode: ProjectRuleEvaluationMode;
  schedule: ProjectRuleSchedule;
  isEnabled: boolean;
};

export interface ProjectRuleFormModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rule?: ProjectRule | null;
  recipients: ProjectRuleRecipientOptions;
  permissions: string[];
  onSubmit: (payload: ProjectRuleFormPayload) => Promise<void>;
}

type ProjectRuleFormState = {
  name: string;
  evaluationMode: ProjectRuleEvaluationMode;
  schedule: ProjectRuleSchedule;
  conditionLogic: ProjectRuleConditionLogic;
  conditions: ProjectRuleFormConditionRow[];
  actions: ProjectRuleFormActionRow[];
  isEnabled: boolean;
  errors: Record<string, string>;
  submitting: boolean;
};

type ProjectRuleFormActionRow = {
  uid: string;
  type: ProjectRuleActionType;
  recipientType: ProjectRuleNotifyRecipientType;
  recipientUserIds: string[];
  recipientRoleIds: string[];
  webhookId: string;
};

type ProjectRuleFormConditionRow = ProjectRuleCondition & { uid: string };

type ProjectRuleFormAction =
  | { type: 'setName'; name: string }
  | {
      type: 'setEvaluationMode';
      evaluationMode: ProjectRuleEvaluationMode;
      fallbackField: string;
    }
  | { type: 'setSchedule'; patch: Partial<ProjectRuleSchedule> }
  | { type: 'setConditionLogic'; conditionLogic: ProjectRuleConditionLogic }
  | { type: 'updateCondition'; index: number; patch: Partial<ProjectRuleCondition> }
  | { type: 'addCondition'; field: string }
  | { type: 'removeCondition'; index: number }
  | { type: 'addAction' }
  | { type: 'removeAction'; index: number }
  | { type: 'setActionType'; index: number; actionType: ProjectRuleActionType }
  | {
      type: 'setActionRecipientType';
      index: number;
      recipientType: ProjectRuleNotifyRecipientType;
    }
  | { type: 'setActionRecipientUserIds'; index: number; recipientUserIds: string[] }
  | { type: 'setActionRecipientRoleIds'; index: number; recipientRoleIds: string[] }
  | { type: 'setActionWebhookId'; index: number; webhookId: string }
  | { type: 'setEnabled'; isEnabled: boolean }
  | { type: 'setErrors'; errors: Record<string, string> }
  | { type: 'setSubmitting'; submitting: boolean };

const CONDITION_GRID_CLASSNAME =
  'grid gap-3 md:grid-cols-[minmax(0,1fr)_10rem_10rem_minmax(10rem,14rem)_2.25rem]';
const ACTION_GRID_CLASSNAME =
  'grid gap-3 md:grid-cols-[minmax(0,12rem)_minmax(0,10rem)_minmax(12rem,1fr)_2.25rem]';
const PROJECT_RULE_NAME_MAX_LENGTH = 255;

const firstValueForField = (field: string) => {
  const definition = getProjectRuleFieldDefinition(field);
  if (definition?.kind === 'enum') return definition.enumValues?.[0] ?? '';
  if (definition?.kind === 'boolean') return 'true';
  return '';
};

const defaultSchedule = (): ProjectRuleSchedule => ({
  frequency: 'monthly',
  userIds: [],
  taskIds: [],
});

const defaultConditionForField = (field: string): ProjectRuleCondition => {
  const definition = getProjectRuleFieldDefinition(field);
  const operator = definition?.operators[0] ?? '';
  return {
    field,
    operator,
    value: isProjectRuleUnaryOperator(operator) ? '' : firstValueForField(field),
    valueType: 'literal',
  };
};

const normalizeConditionForForm = (condition: ProjectRuleCondition): ProjectRuleCondition =>
  isProjectRuleUnaryOperator(condition.operator)
    ? { ...condition, value: '', valueType: 'literal' }
    : { ...condition, valueType: condition.valueType ?? 'literal' };

const uniqueStrings = (values: readonly string[]) => Array.from(new Set(values));

let actionRowCounter = 0;
let conditionRowCounter = 0;

const createConditionRow = (condition: ProjectRuleCondition): ProjectRuleFormConditionRow => {
  conditionRowCounter += 1;
  return { ...condition, uid: `project-rule-condition-${conditionRowCounter}` };
};

const createActionRow = (
  patch: Partial<Omit<ProjectRuleFormActionRow, 'uid'>> = {},
): ProjectRuleFormActionRow => {
  actionRowCounter += 1;
  return {
    uid: `project-rule-action-${actionRowCounter}`,
    type: 'notify',
    recipientType: 'user',
    recipientUserIds: [],
    recipientRoleIds: [],
    webhookId: '',
    ...patch,
  };
};

const actionRowsForRule = (
  rule: ProjectRule | null | undefined,
  hasHiddenWebhookAction: boolean,
): ProjectRuleFormActionRow[] => {
  const config = rule?.actionConfig;
  const rows: ProjectRuleFormActionRow[] = [];

  for (const action of config?.actions ?? []) {
    if (action.type === 'notify') {
      if (action.recipientType === 'role') {
        rows.push(
          createActionRow({
            type: 'notify',
            recipientType: 'role',
            recipientRoleIds: action.recipientRoleIds,
          }),
        );
      } else {
        rows.push(
          createActionRow({
            type: 'notify',
            recipientType: 'user',
            recipientUserIds: action.recipientUserIds,
          }),
        );
      }
      continue;
    }
    rows.push(createActionRow({ type: 'webhook', webhookId: action.webhookId }));
  }

  if (rows.length > 0) return rows;

  if (config?.recipientUserIds?.length) {
    rows.push(
      createActionRow({
        type: 'notify',
        recipientType: 'user',
        recipientUserIds: config.recipientUserIds,
      }),
    );
  }
  if (config?.recipientRoleIds?.length) {
    rows.push(
      createActionRow({
        type: 'notify',
        recipientType: 'role',
        recipientRoleIds: config.recipientRoleIds,
      }),
    );
  }
  for (const webhookId of config?.webhookIds ?? []) {
    rows.push(createActionRow({ type: 'webhook', webhookId }));
  }

  return rows.length > 0 || hasHiddenWebhookAction ? rows : [createActionRow()];
};

const hasRedactedWebhookAction = (rule: ProjectRule | null | undefined, permissions: string[]) =>
  Boolean(
    rule?.actionType === 'webhook' &&
      !hasPermission(permissions, 'administration.webhooks.view') &&
      rule.actionConfig.webhookIds.length === 0 &&
      rule.actionConfig.actions.every((action) => action.type !== 'webhook'),
  );

const hasConfiguredActionTarget = (action: ProjectRuleFormActionRow) => {
  if (action.type === 'webhook') return Boolean(action.webhookId);
  return action.recipientType === 'role'
    ? action.recipientRoleIds.length > 0
    : action.recipientUserIds.length > 0;
};

const buildActionConfigFromRows = (
  actions: ProjectRuleFormActionRow[],
): ProjectRuleActionConfig => {
  const recipientUserIds = uniqueStrings(
    actions.flatMap((action) =>
      action.type === 'notify' && action.recipientType === 'user' ? action.recipientUserIds : [],
    ),
  );
  const recipientRoleIds = uniqueStrings(
    actions.flatMap((action) =>
      action.type === 'notify' && action.recipientType === 'role' ? action.recipientRoleIds : [],
    ),
  );
  const webhookIds = uniqueStrings(
    actions.flatMap((action) => (action.type === 'webhook' ? [action.webhookId] : [])),
  );
  const normalizedActions: ProjectRuleActionConfig['actions'] = [];

  if (recipientUserIds.length > 0) {
    normalizedActions.push({ type: 'notify', recipientType: 'user', recipientUserIds });
  }
  if (recipientRoleIds.length > 0) {
    normalizedActions.push({ type: 'notify', recipientType: 'role', recipientRoleIds });
  }
  for (const webhookId of webhookIds) normalizedActions.push({ type: 'webhook', webhookId });

  return {
    recipientUserIds,
    recipientRoleIds,
    webhookIds,
    actions: normalizedActions,
  };
};

const conditionsForRule = (
  rule: ProjectRule | null | undefined,
  fallbackField: string,
): ProjectRuleFormConditionRow[] => {
  if (rule?.conditions?.length) {
    return rule.conditions.map((condition) =>
      createConditionRow(normalizeConditionForForm(condition)),
    );
  }
  if (rule) {
    return [
      createConditionRow({
        field: rule.field,
        operator: rule.operator,
        value: rule.value,
        valueType: 'literal',
      }),
    ];
  }
  return fallbackField ? [createConditionRow(defaultConditionForField(fallbackField))] : [];
};

const createProjectRuleFormState = (
  rule: ProjectRule | null | undefined,
  initialField: string,
  hasHiddenWebhookAction: boolean,
): ProjectRuleFormState => ({
  name: rule?.name ?? '',
  evaluationMode: rule?.evaluationMode ?? 'continuous',
  schedule: { ...defaultSchedule(), ...rule?.schedule },
  conditionLogic: rule?.conditionLogic ?? 'and',
  conditions: conditionsForRule(rule, initialField),
  actions: actionRowsForRule(rule, hasHiddenWebhookAction),
  isEnabled: rule?.isEnabled ?? true,
  errors: {},
  submitting: false,
});

const projectRuleFormReducer = (
  state: ProjectRuleFormState,
  action: ProjectRuleFormAction,
): ProjectRuleFormState => {
  switch (action.type) {
    case 'setName':
      return { ...state, name: action.name };
    case 'setEvaluationMode':
      return {
        ...state,
        evaluationMode: action.evaluationMode,
        conditions:
          action.evaluationMode === 'periodic'
            ? state.conditions
            : state.conditions.map((condition) => {
                if (getProjectRuleFieldDefinition(condition.field)?.periodOnly) {
                  return {
                    ...createConditionRow(defaultConditionForField(action.fallbackField)),
                    uid: condition.uid,
                  };
                }
                if (
                  condition.valueType === 'field' &&
                  getProjectRuleFieldDefinition(condition.value)?.periodOnly
                ) {
                  return {
                    ...condition,
                    valueType: 'literal',
                    value: firstValueForField(condition.field),
                  };
                }
                return condition;
              }),
      };
    case 'setSchedule':
      return { ...state, schedule: { ...state.schedule, ...action.patch } };
    case 'setConditionLogic':
      return { ...state, conditionLogic: action.conditionLogic };
    case 'updateCondition':
      return {
        ...state,
        conditions: state.conditions.map((condition, conditionIndex) =>
          conditionIndex === action.index ? { ...condition, ...action.patch } : condition,
        ),
      };
    case 'addCondition':
      return {
        ...state,
        conditions: [
          ...state.conditions,
          createConditionRow(defaultConditionForField(action.field)),
        ],
      };
    case 'removeCondition':
      return {
        ...state,
        conditions: state.conditions.filter((_, conditionIndex) => conditionIndex !== action.index),
      };
    case 'addAction':
      return { ...state, actions: [...state.actions, createActionRow()] };
    case 'removeAction':
      return {
        ...state,
        actions: state.actions.filter((_, actionIndex) => actionIndex !== action.index),
      };
    case 'setActionType':
      return {
        ...state,
        actions: state.actions.map((row, actionIndex) =>
          actionIndex === action.index ? { ...row, type: action.actionType } : row,
        ),
      };
    case 'setActionRecipientType':
      return {
        ...state,
        actions: state.actions.map((row, actionIndex) =>
          actionIndex === action.index ? { ...row, recipientType: action.recipientType } : row,
        ),
      };
    case 'setActionRecipientUserIds':
      return {
        ...state,
        actions: state.actions.map((row, actionIndex) =>
          actionIndex === action.index
            ? { ...row, recipientUserIds: action.recipientUserIds }
            : row,
        ),
      };
    case 'setActionRecipientRoleIds':
      return {
        ...state,
        actions: state.actions.map((row, actionIndex) =>
          actionIndex === action.index
            ? { ...row, recipientRoleIds: action.recipientRoleIds }
            : row,
        ),
      };
    case 'setActionWebhookId':
      return {
        ...state,
        actions: state.actions.map((row, actionIndex) =>
          actionIndex === action.index ? { ...row, webhookId: action.webhookId } : row,
        ),
      };
    case 'setEnabled':
      return { ...state, isEnabled: action.isEnabled };
    case 'setErrors':
      return { ...state, errors: action.errors };
    case 'setSubmitting':
      return { ...state, submitting: action.submitting };
  }
};

type ProjectRuleOption = {
  id: string;
  name: string;
  description?: string;
  disabled?: boolean;
};
type ProjectRuleFieldOption = ProjectRuleOption & {
  description: string;
  group: ProjectRuleFieldGroup;
};

const PROJECT_RULE_FIELD_GROUPS: readonly ProjectRuleFieldGroup[] = [
  'project',
  'computed',
  'period',
];

const ProjectRuleFieldOptionGroups: React.FC<{ options: ProjectRuleFieldOption[] }> = ({
  options,
}) => {
  const { t } = useTranslation(['projects']);
  return PROJECT_RULE_FIELD_GROUPS.map((group) => {
    const groupOptions = options.filter((option) => option.group === group);
    if (groupOptions.length === 0) return null;
    return (
      <SelectGroup key={group}>
        <SelectLabel>{t(`projects:detail.rules.fieldGroups.${group}`)}</SelectLabel>
        {groupOptions.map((option) => (
          <SelectItem key={option.id} value={option.id}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="-mx-2 -my-1.5 flex min-w-0 flex-1 px-2 py-1.5">{option.name}</span>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={6} className="max-w-72">
                {option.description}
              </TooltipContent>
            </Tooltip>
          </SelectItem>
        ))}
      </SelectGroup>
    );
  });
};

const includeUnavailableSelections = (
  options: ProjectRuleOption[],
  selectedIds: readonly string[],
  unavailableLabel: string,
): ProjectRuleOption[] => {
  const availableIds = new Set(options.map((option) => option.id));
  return [
    ...options,
    ...selectedIds
      .filter((id) => !availableIds.has(id))
      .map((id) => ({
        id,
        name: `${id} · ${unavailableLabel}`,
        disabled: true,
      })),
  ];
};

const ProjectRuleEvaluationEditor: React.FC<{
  evaluationMode: ProjectRuleEvaluationMode;
  schedule: ProjectRuleSchedule;
  recipients: ProjectRuleRecipientOptions;
  submitting: boolean;
  onModeChange: (mode: ProjectRuleEvaluationMode) => void;
  onScheduleChange: (patch: Partial<ProjectRuleSchedule>) => void;
}> = ({ evaluationMode, schedule, recipients, submitting, onModeChange, onScheduleChange }) => {
  const { t } = useTranslation(['projects']);
  const [isCustomRepeatOpen, setIsCustomRepeatOpen] = useState(false);
  const isCustomFrequency = schedule.frequency.startsWith('monthly:');
  const frequencyOptions = useMemo(
    () => [
      ...(['daily', 'weekly', 'monthly', 'quarterly', 'yearly'] as const).map((frequency) => ({
        id: frequency,
        name: t(`projects:detail.rules.schedule.frequencies.${frequency}`),
      })),
      {
        id: 'custom',
        name: isCustomFrequency
          ? formatRecurrencePattern(schedule.frequency, t)
          : t('timesheets:entry.recurrencePatterns.custom'),
      },
    ],
    [isCustomFrequency, schedule.frequency, t],
  );
  const unavailableLabel = t('projects:detail.rules.schedule.unavailable');
  const filterUserOptions = includeUnavailableSelections(
    (recipients.filters?.users ?? []).map((user) => ({
      id: user.id,
      name: `${user.name} (${user.username})${
        user.isDisabled ? ` · ${t('projects:detail.rules.schedule.disabled')}` : ''
      }`,
    })),
    schedule.userIds,
    unavailableLabel,
  );
  const filterTaskOptions = includeUnavailableSelections(
    (recipients.filters?.tasks ?? []).map((task) => ({
      id: task.id,
      name: `${task.name}${
        task.isDisabled ? ` · ${t('projects:detail.rules.schedule.disabled')}` : ''
      }`,
    })),
    schedule.taskIds,
    unavailableLabel,
  );

  const handleFrequencyChange = (value: string) => {
    if (value === 'custom') {
      setIsCustomRepeatOpen(true);
      return;
    }
    onScheduleChange({ frequency: value as ProjectRuleScheduleFrequency });
  };

  return (
    <>
      <section className="space-y-3" aria-labelledby="project-rule-evaluation-heading">
        <div>
          <FieldLabel id="project-rule-evaluation-heading">
            {t('projects:detail.rules.form.evaluationMode')}
          </FieldLabel>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('projects:detail.rules.form.evaluationModeDescription')}
          </p>
        </div>
        <RadioGroup
          value={evaluationMode}
          onValueChange={(value) => onModeChange(value as ProjectRuleEvaluationMode)}
          className="grid gap-3 sm:grid-cols-2"
          disabled={submitting}
        >
          {(['continuous', 'periodic'] as const).map((mode) => {
            const Icon = mode === 'continuous' ? RadarIcon : CalendarClockIcon;
            const selected = evaluationMode === mode;
            return (
              <label
                key={mode}
                className={`flex cursor-pointer gap-3 rounded-lg border p-4 transition-colors ${
                  selected
                    ? 'border-primary/50 bg-primary/[0.06]'
                    : 'border-border bg-background hover:bg-muted/40'
                }`}
              >
                <RadioGroupItem value={mode} className="mt-0.5" />
                <Icon className={`mt-0.5 size-4 shrink-0 ${selected ? 'text-primary' : ''}`} />
                <span className="space-y-1">
                  <span className="block text-sm font-medium">
                    {t(`projects:detail.rules.evaluationModes.${mode}.title`)}
                  </span>
                  <span className="block text-sm text-muted-foreground">
                    {t(`projects:detail.rules.evaluationModes.${mode}.description`)}
                  </span>
                </span>
              </label>
            );
          })}
        </RadioGroup>

        {evaluationMode === 'periodic' && (
          <div className="grid gap-4 rounded-lg border border-primary/20 bg-muted/25 p-4 md:grid-cols-2 lg:grid-cols-3">
            <SelectControl
              id="project-rule-schedule-frequency"
              searchable={false}
              disabled={submitting}
              label={t('projects:detail.rules.schedule.frequency')}
              options={frequencyOptions}
              value={isCustomFrequency ? 'custom' : schedule.frequency}
              onChange={(next) =>
                handleFrequencyChange((Array.isArray(next) ? next[0] : next) as string)
              }
            />
            <SelectControl
              id="project-rule-schedule-users"
              searchable
              isMulti
              disabled={submitting}
              label={t('projects:detail.rules.schedule.users')}
              placeholder={t('projects:detail.rules.schedule.allUsers')}
              options={filterUserOptions}
              value={schedule.userIds}
              onChange={(next) => onScheduleChange({ userIds: Array.isArray(next) ? next : [] })}
            />
            <SelectControl
              id="project-rule-schedule-tasks"
              searchable
              isMulti
              disabled={submitting}
              label={t('projects:detail.rules.schedule.tasks')}
              placeholder={t('projects:detail.rules.schedule.allTasks')}
              options={filterTaskOptions}
              value={schedule.taskIds}
              onChange={(next) => onScheduleChange({ taskIds: Array.isArray(next) ? next : [] })}
            />
            <p className="text-sm text-muted-foreground md:col-span-2 lg:col-span-full">
              {t(
                schedule.frequency === 'monthly' || isCustomFrequency
                  ? 'projects:detail.rules.schedule.monthlyPeriodHint'
                  : 'projects:detail.rules.schedule.previousPeriodHint',
              )}
            </p>
          </div>
        )}
      </section>

      <CustomRepeatModal
        isOpen={isCustomRepeatOpen}
        onClose={() => setIsCustomRepeatOpen(false)}
        onSave={(frequency) =>
          onScheduleChange({ frequency: frequency as ProjectRuleScheduleFrequency })
        }
      />
    </>
  );
};

const ProjectRuleConditionsEditor: React.FC<{
  conditionLogic: ProjectRuleConditionLogic;
  conditions: ProjectRuleFormConditionRow[];
  errors: Record<string, string>;
  submitting: boolean;
  availableFields: ReturnType<typeof getAvailableProjectRuleFields>;
  fieldOptions: ProjectRuleFieldOption[];
  permissions: string[];
  evaluationMode: ProjectRuleEvaluationMode;
  dispatch: React.Dispatch<ProjectRuleFormAction>;
  onAddCondition: () => void;
  onRemoveCondition: (index: number) => void;
  onUpdateCondition: (index: number, patch: Partial<ProjectRuleCondition>) => void;
  onFieldChange: (index: number, nextField: string) => void;
  onOperatorChange: (index: number, nextOperator: string) => void;
  onValueTypeChange: (index: number, nextValueType: ProjectRuleConditionValueType) => void;
}> = ({
  conditionLogic,
  conditions,
  errors,
  submitting,
  availableFields,
  fieldOptions,
  permissions,
  evaluationMode,
  dispatch,
  onAddCondition,
  onRemoveCondition,
  onUpdateCondition,
  onFieldChange,
  onOperatorChange,
  onValueTypeChange,
}) => {
  const { t } = useTranslation(['projects', 'common']);

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <Field className="max-w-xs">
          <FieldLabel htmlFor="project-rule-condition-logic">
            {t('projects:detail.rules.form.conditionLogic')}
          </FieldLabel>
          <Select
            value={conditionLogic}
            onValueChange={(next) =>
              dispatch({
                type: 'setConditionLogic',
                conditionLogic: next as ProjectRuleConditionLogic,
              })
            }
            disabled={submitting}
          >
            <SelectTrigger id="project-rule-condition-logic" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {(['and', 'or'] as const).map((logic) => (
                  <SelectItem key={logic} value={logic}>
                    {t(`projects:detail.rules.conditionLogic.${logic}`)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onAddCondition}
          disabled={submitting || availableFields.length === 0}
        >
          <PlusIcon className="size-4" />
          {t('projects:detail.rules.actions.addCondition')}
        </Button>
      </div>

      <div className="rounded-md border border-border">
        <div
          className={`${CONDITION_GRID_CLASSNAME} hidden border-b border-border px-3 py-2 text-sm font-medium text-muted-foreground md:grid`}
        >
          <span>{t('projects:detail.rules.form.field')}</span>
          <span>{t('projects:detail.rules.form.operator')}</span>
          <span>{t('projects:detail.rules.form.compareAgainst')}</span>
          <span>
            {t('projects:detail.rules.form.value')} / {t('projects:detail.rules.form.targetField')}
          </span>
          <span className="sr-only">{t('projects:detail.rules.actions.removeCondition')}</span>
        </div>

        <div className="divide-y divide-border">
          {conditions.map((condition, index) => {
            const fieldDefinition = getProjectRuleFieldDefinition(condition.field);
            const operatorOptions =
              fieldDefinition?.operators.map((id) => ({
                id,
                name: t(`projects:detail.rules.operators.${id}`),
              })) ?? [];
            const enumValueOptions =
              fieldDefinition?.enumValues?.map((id) => ({
                id,
                name: t(getProjectRuleValueLabelKey(condition.field, id)),
              })) ?? [];
            const booleanValueOptions =
              fieldDefinition?.kind === 'boolean'
                ? ['true', 'false'].map((id) => ({
                    id,
                    name: t(getProjectRuleValueLabelKey(condition.field, id)),
                  }))
                : [];
            const valueType = condition.valueType ?? 'literal';
            const valueFieldOptions = getAvailableProjectRuleValueFields(
              condition.field,
              permissions,
              evaluationMode,
            ).map((definition) => ({
              id: definition.id,
              name: t(`projects:detail.rules.fields.${definition.id}`),
              description: t(`projects:detail.rules.fieldDescriptions.${definition.id}`),
              group: definition.group,
            }));
            const unaryOperator = isProjectRuleUnaryOperator(condition.operator);
            const valueTypeChoices: readonly ProjectRuleConditionValueType[] =
              !unaryOperator && valueFieldOptions.length > 0
                ? (['literal', 'field'] as const)
                : (['literal'] as const);
            const fieldError = errors[`field-${index}`];
            const operatorError = errors[`operator-${index}`];
            const valueError = errors[`value-${index}`];
            return (
              <div key={condition.uid} className={`${CONDITION_GRID_CLASSNAME} p-3`}>
                <Field data-invalid={!!fieldError}>
                  <FieldLabel
                    className="md:sr-only"
                    htmlFor={`project-rule-field-${index}`}
                    required
                  >
                    {t('projects:detail.rules.form.field')}
                  </FieldLabel>
                  <Select
                    value={condition.field}
                    onValueChange={(nextField) => onFieldChange(index, nextField)}
                    disabled={submitting}
                  >
                    <SelectTrigger
                      id={`project-rule-field-${index}`}
                      className="w-full"
                      aria-invalid={!!fieldError}
                    >
                      <SelectValue placeholder={t('projects:detail.rules.form.field')} />
                    </SelectTrigger>
                    <SelectContent>
                      <ProjectRuleFieldOptionGroups options={fieldOptions} />
                    </SelectContent>
                  </Select>
                  <FieldError>{fieldError}</FieldError>
                </Field>

                <Field data-invalid={!!operatorError}>
                  <FieldLabel
                    className="md:sr-only"
                    htmlFor={`project-rule-operator-${index}`}
                    required
                  >
                    {t('projects:detail.rules.form.operator')}
                  </FieldLabel>
                  <Select
                    value={condition.operator}
                    onValueChange={(operator) => onOperatorChange(index, operator)}
                    disabled={submitting}
                  >
                    <SelectTrigger
                      id={`project-rule-operator-${index}`}
                      className="w-full"
                      aria-invalid={!!operatorError}
                    >
                      <SelectValue placeholder={t('projects:detail.rules.form.operator')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {operatorOptions.map((option) => (
                          <SelectItem key={option.id} value={option.id}>
                            {option.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <FieldError>{operatorError}</FieldError>
                </Field>

                <Field>
                  <FieldLabel className="md:sr-only" htmlFor={`project-rule-value-type-${index}`}>
                    {t('projects:detail.rules.form.compareAgainst')}
                  </FieldLabel>
                  <Select
                    value={valueType}
                    onValueChange={(next) =>
                      onValueTypeChange(index, next as ProjectRuleConditionValueType)
                    }
                    disabled={submitting || unaryOperator}
                  >
                    <SelectTrigger id={`project-rule-value-type-${index}`} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {valueTypeChoices.map((nextValueType) => (
                          <SelectItem key={nextValueType} value={nextValueType}>
                            {t(`projects:detail.rules.valueTypes.${nextValueType}`)}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>

                <Field data-invalid={!!valueError}>
                  <FieldLabel
                    className="md:sr-only"
                    htmlFor={`project-rule-value-${index}`}
                    required={!unaryOperator}
                  >
                    {t(
                      valueType === 'field'
                        ? 'projects:detail.rules.form.targetField'
                        : 'projects:detail.rules.form.value',
                    )}
                  </FieldLabel>
                  {unaryOperator ? (
                    <div
                      id={`project-rule-value-${index}`}
                      className="flex h-9 items-center rounded-md border border-dashed border-border px-3 text-sm text-muted-foreground"
                    >
                      {t('projects:detail.rules.form.noValueRequired')}
                    </div>
                  ) : valueType === 'field' ? (
                    <Select
                      value={condition.value}
                      onValueChange={(value) => onUpdateCondition(index, { value })}
                      disabled={submitting || valueFieldOptions.length === 0}
                    >
                      <SelectTrigger
                        id={`project-rule-value-${index}`}
                        className="w-full"
                        aria-invalid={!!valueError}
                      >
                        <SelectValue placeholder={t('projects:detail.rules.form.targetField')} />
                      </SelectTrigger>
                      <SelectContent>
                        <ProjectRuleFieldOptionGroups options={valueFieldOptions} />
                      </SelectContent>
                    </Select>
                  ) : fieldDefinition?.kind === 'enum' || fieldDefinition?.kind === 'boolean' ? (
                    <Select
                      value={condition.value}
                      onValueChange={(value) => onUpdateCondition(index, { value })}
                      disabled={submitting}
                    >
                      <SelectTrigger
                        id={`project-rule-value-${index}`}
                        className="w-full"
                        aria-invalid={!!valueError}
                      >
                        <SelectValue placeholder={t('projects:detail.rules.form.value')} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {(fieldDefinition.kind === 'boolean'
                            ? booleanValueOptions
                            : enumValueOptions
                          ).map((option) => (
                            <SelectItem key={option.id} value={option.id}>
                              {option.name}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  ) : fieldDefinition?.kind === 'number' ? (
                    <ValidatedNumberInput
                      id={`project-rule-value-${index}`}
                      value={condition.value}
                      onValueChange={(value) => onUpdateCondition(index, { value })}
                      allowNegative
                      disabled={submitting}
                      aria-invalid={!!valueError}
                      placeholder={t('projects:detail.rules.form.valuePlaceholder')}
                    />
                  ) : (
                    <Input
                      id={`project-rule-value-${index}`}
                      type={fieldDefinition?.kind === 'date' ? 'date' : 'text'}
                      value={condition.value}
                      onChange={(event) => onUpdateCondition(index, { value: event.target.value })}
                      disabled={submitting}
                      aria-invalid={!!valueError}
                      placeholder={t('projects:detail.rules.form.valuePlaceholder')}
                    />
                  )}
                  <FieldError>{valueError}</FieldError>
                </Field>

                <div className="flex items-end justify-end md:items-center">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => onRemoveCondition(index)}
                    disabled={submitting || conditions.length === 1}
                    aria-label={t('projects:detail.rules.actions.removeCondition')}
                  >
                    <Trash2Icon className="size-4" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {errors.conditions && (
        <p className="text-sm font-medium text-destructive">{errors.conditions}</p>
      )}
    </div>
  );
};

const ProjectRuleActionsEditor: React.FC<{
  actions: ProjectRuleFormActionRow[];
  errors: Record<string, string>;
  submitting: boolean;
  userOptions: ProjectRuleOption[];
  roleOptions: ProjectRuleOption[];
  webhookOptions: ProjectRuleOption[];
  actionTypeOptions: Array<{ id: ProjectRuleActionType; name: string }>;
  recipientTypeOptions: Array<{ id: ProjectRuleNotifyRecipientType; name: string }>;
  allowEmptyActions: boolean;
  dispatch: React.Dispatch<ProjectRuleFormAction>;
}> = ({
  actions,
  errors,
  submitting,
  userOptions,
  roleOptions,
  webhookOptions,
  actionTypeOptions,
  recipientTypeOptions,
  allowEmptyActions,
  dispatch,
}) => {
  const { t } = useTranslation(['projects', 'common']);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <FieldLabel>{t('projects:detail.rules.form.actions')}</FieldLabel>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => dispatch({ type: 'addAction' })}
          disabled={submitting}
        >
          <PlusIcon className="size-4" />
          {t('projects:detail.rules.actions.addAction')}
        </Button>
      </div>
      <div className="rounded-md border border-border">
        <div
          className={`${ACTION_GRID_CLASSNAME} hidden border-b border-border px-3 py-2 text-sm font-medium text-muted-foreground md:grid`}
        >
          <span>{t('projects:detail.rules.form.action')}</span>
          <span>{t('projects:detail.rules.form.recipientType')}</span>
          <span>{t('projects:detail.rules.form.actionValue')}</span>
          <span className="sr-only">{t('projects:detail.rules.actions.removeAction')}</span>
        </div>

        <div className="divide-y divide-border">
          {actions.map((action, index) => (
            <div key={action.uid} className={`${ACTION_GRID_CLASSNAME} p-3`}>
              <SelectControl
                id={`project-rule-action-type-${index}`}
                searchable={false}
                disabled={submitting}
                label={t('projects:detail.rules.form.action')}
                labelClassName="md:sr-only"
                options={actionTypeOptions}
                value={action.type}
                onChange={(next) =>
                  dispatch({
                    type: 'setActionType',
                    index,
                    actionType: (Array.isArray(next) ? next[0] : next) as ProjectRuleActionType,
                  })
                }
              />
              {action.type === 'notify' ? (
                <>
                  <SelectControl
                    id={`project-rule-recipient-type-${index}`}
                    searchable={false}
                    disabled={submitting}
                    label={t('projects:detail.rules.form.recipientType')}
                    labelClassName="md:sr-only"
                    options={recipientTypeOptions}
                    value={action.recipientType}
                    onChange={(next) =>
                      dispatch({
                        type: 'setActionRecipientType',
                        index,
                        recipientType: (Array.isArray(next)
                          ? next[0]
                          : next) as ProjectRuleNotifyRecipientType,
                      })
                    }
                  />
                  <SelectControl
                    id={`project-rule-action-recipient-${index}`}
                    searchable
                    isMulti
                    disabled={submitting}
                    label={
                      action.recipientType === 'user'
                        ? t('projects:detail.rules.form.users')
                        : t('projects:detail.rules.form.roles')
                    }
                    labelClassName="md:sr-only"
                    placeholder={
                      action.recipientType === 'user'
                        ? t('projects:detail.rules.form.usersPlaceholder')
                        : t('projects:detail.rules.form.rolesPlaceholder')
                    }
                    options={action.recipientType === 'user' ? userOptions : roleOptions}
                    value={
                      action.recipientType === 'user'
                        ? action.recipientUserIds
                        : action.recipientRoleIds
                    }
                    onChange={(next) =>
                      dispatch(
                        action.recipientType === 'user'
                          ? {
                              type: 'setActionRecipientUserIds',
                              index,
                              recipientUserIds: Array.isArray(next) ? next : [],
                            }
                          : {
                              type: 'setActionRecipientRoleIds',
                              index,
                              recipientRoleIds: Array.isArray(next) ? next : [],
                            },
                      )
                    }
                  />
                </>
              ) : (
                <SelectControl
                  id={`project-rule-action-webhook-${index}`}
                  searchable
                  disabled={submitting}
                  className="md:col-span-2"
                  label={t('projects:detail.rules.form.webhook')}
                  labelClassName="md:sr-only"
                  placeholder={t('projects:detail.rules.form.webhookPlaceholder')}
                  options={webhookOptions}
                  value={action.webhookId}
                  onChange={(next) =>
                    dispatch({
                      type: 'setActionWebhookId',
                      index,
                      webhookId: Array.isArray(next) ? (next[0] ?? '') : next,
                    })
                  }
                />
              )}
              <div className="flex items-end justify-end md:items-center">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={submitting || (actions.length === 1 && !allowEmptyActions)}
                  onClick={() => dispatch({ type: 'removeAction', index })}
                  aria-label={t('projects:detail.rules.actions.removeAction')}
                >
                  <Trash2Icon className="size-4" />
                </Button>
              </div>
              {errors[`action-${index}`] && (
                <p className="text-sm font-medium text-destructive md:col-span-4">
                  {errors[`action-${index}`]}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>
      {errors.actions && <p className="text-sm font-medium text-destructive">{errors.actions}</p>}
    </div>
  );
};

type ProjectRuleFormModalSessionProps = ProjectRuleFormModalProps & {
  initialField: string;
};

const ProjectRuleFormModalSession: React.FC<ProjectRuleFormModalSessionProps> = ({
  open,
  onOpenChange,
  rule,
  recipients,
  permissions,
  onSubmit,
  initialField,
}) => {
  const { t } = useTranslation(['projects', 'common']);
  const hasHiddenWebhookAction = hasRedactedWebhookAction(rule, permissions);
  const [formState, dispatch] = useReducer(projectRuleFormReducer, undefined, () =>
    createProjectRuleFormState(rule, initialField, hasHiddenWebhookAction),
  );
  const {
    name,
    evaluationMode,
    schedule,
    conditionLogic,
    conditions,
    actions,
    isEnabled,
    errors,
    submitting,
  } = formState;
  const availableFields = useMemo(
    () => getAvailableProjectRuleFields(permissions, evaluationMode),
    [permissions, evaluationMode],
  );

  const fieldOptions = availableFields.map((definition) => ({
    id: definition.id,
    name: t(`projects:detail.rules.fields.${definition.id}`),
    description: t(`projects:detail.rules.fieldDescriptions.${definition.id}`),
    group: definition.group,
  }));
  const userOptions = recipients.users.map((user) => ({
    id: user.id,
    name: `${user.name} (${user.username})`,
  }));
  const roleOptions = recipients.roles.map((role) => ({ id: role.id, name: role.name }));
  const webhookOptions = recipients.webhooks.map((webhook) => ({
    id: webhook.id,
    name: webhook.name,
  }));
  const actionTypeOptions: Array<{ id: ProjectRuleActionType; name: string }> = [
    { id: 'notify', name: t('projects:detail.rules.form.actionTypes.notify') },
    ...(hasPermission(permissions, 'administration.webhooks.view')
      ? [{ id: 'webhook' as const, name: t('projects:detail.rules.form.actionTypes.webhook') }]
      : []),
  ];
  const recipientTypeOptions: Array<{ id: ProjectRuleNotifyRecipientType; name: string }> = [
    { id: 'user', name: t('projects:detail.rules.form.recipientTypes.user') },
    { id: 'role', name: t('projects:detail.rules.form.recipientTypes.role') },
  ];

  const updateCondition = (index: number, patch: Partial<ProjectRuleCondition>) => {
    dispatch({ type: 'updateCondition', index, patch });
  };

  const firstValueFieldForField = (field: string) =>
    getAvailableProjectRuleValueFields(field, permissions, evaluationMode)[0]?.id ?? '';

  const handleFieldChange = (index: number, nextField: string) => {
    const currentValueType = conditions[index]?.valueType ?? 'literal';
    const nextValueField = firstValueFieldForField(nextField);
    const nextValueType: ProjectRuleConditionValueType =
      currentValueType === 'field' && nextValueField ? 'field' : 'literal';
    const nextDefinition = getProjectRuleFieldDefinition(nextField);
    const nextOperator = nextDefinition?.operators[0] ?? '';
    updateCondition(index, {
      field: nextField,
      operator: nextOperator,
      valueType: nextValueType,
      value:
        nextValueType === 'field'
          ? nextValueField
          : isProjectRuleUnaryOperator(nextOperator)
            ? ''
            : firstValueForField(nextField),
    });
  };

  const handleValueTypeChange = (index: number, nextValueType: ProjectRuleConditionValueType) => {
    const field = conditions[index]?.field ?? '';
    updateCondition(index, {
      valueType: nextValueType,
      value: nextValueType === 'field' ? firstValueFieldForField(field) : firstValueForField(field),
    });
  };

  const handleOperatorChange = (index: number, nextOperator: string) => {
    const condition = conditions[index];
    if (!condition) return;
    const wasUnary = isProjectRuleUnaryOperator(condition.operator);
    const isUnary = isProjectRuleUnaryOperator(nextOperator);
    updateCondition(index, {
      operator: nextOperator,
      valueType: isUnary ? 'literal' : condition.valueType,
      value: isUnary ? '' : wasUnary ? firstValueForField(condition.field) : condition.value,
    });
  };

  const handleEvaluationModeChange = (nextMode: ProjectRuleEvaluationMode) => {
    const continuousFields = getAvailableProjectRuleFields(permissions, 'continuous');
    const fallbackField =
      continuousFields.find((definition) => definition.id === 'revenue')?.id ??
      continuousFields[0]?.id ??
      '';
    dispatch({ type: 'setEvaluationMode', evaluationMode: nextMode, fallbackField });
  };

  const addCondition = () => {
    const field =
      availableFields.find((definition) => definition.id === 'revenue')?.id ??
      availableFields[0]?.id ??
      '';
    if (!field) return;
    dispatch({ type: 'addCondition', field });
  };

  const removeCondition = (index: number) => {
    dispatch({ type: 'removeCondition', index });
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const nextErrors: Record<string, string> = {};
    const primary = conditions[0];
    if (!name.trim()) nextErrors.name = t('projects:detail.rules.errors.nameRequired');
    if (conditions.length === 0) {
      nextErrors.conditions = t('projects:detail.rules.errors.conditionsRequired');
    }
    conditions.forEach((condition, index) => {
      if (!condition.field)
        nextErrors[`field-${index}`] = t('projects:detail.rules.errors.fieldRequired');
      if (!condition.operator) {
        nextErrors[`operator-${index}`] = t('projects:detail.rules.errors.operatorRequired');
      }
      if (
        !isValidProjectRuleConditionValue({
          field: condition.field,
          operator: condition.operator,
          value: condition.value,
          valueType: condition.valueType ?? 'literal',
          permissions,
          evaluationMode,
        })
      ) {
        nextErrors[`value-${index}`] = t('projects:detail.rules.errors.valueInvalid');
      }
    });
    const submittedActions = hasHiddenWebhookAction
      ? actions.filter(hasConfiguredActionTarget)
      : actions;
    if (submittedActions.length === 0 && !hasHiddenWebhookAction) {
      nextErrors.actions = t('projects:detail.rules.errors.actionsRequired');
    }
    submittedActions.forEach((action, index) => {
      if (action.type === 'notify' && action.recipientType === 'user') {
        if (action.recipientUserIds.length === 0) {
          nextErrors[`action-${index}`] = t('projects:detail.rules.errors.usersRequired');
        }
        return;
      }
      if (action.type === 'notify' && action.recipientType === 'role') {
        if (action.recipientRoleIds.length === 0) {
          nextErrors[`action-${index}`] = t('projects:detail.rules.errors.rolesRequired');
        }
        return;
      }
      if (action.type === 'webhook' && !action.webhookId) {
        nextErrors[`action-${index}`] = t('projects:detail.rules.errors.webhookRequired');
      }
    });
    dispatch({ type: 'setErrors', errors: nextErrors });
    if (Object.keys(nextErrors).length > 0) return;

    dispatch({ type: 'setSubmitting', submitting: true });
    try {
      const normalizedConditions = conditions.map((condition) => ({
        field: condition.field,
        operator: condition.operator,
        value: condition.value.trim(),
        valueType: condition.valueType ?? 'literal',
      }));
      const firstCondition = normalizedConditions[0] ?? primary;
      if (!firstCondition) return;
      const actionConfig = buildActionConfigFromRows(submittedActions);
      const actionType =
        actionConfig.actions[0]?.type ?? (hasHiddenWebhookAction ? 'webhook' : 'notify');
      await onSubmit({
        name: name.trim(),
        field: firstCondition.field,
        operator: firstCondition.operator,
        value: firstCondition.value,
        conditionLogic,
        conditions: normalizedConditions,
        actionType,
        actionConfig,
        evaluationMode,
        schedule,
        isEnabled,
      });
      onOpenChange(false);
    } finally {
      dispatch({ type: 'setSubmitting', submitting: false });
    }
  };

  return (
    <Dialog open={open} onOpenChange={submitting ? undefined : onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>
            {rule
              ? t('projects:detail.rules.form.editTitle')
              : t('projects:detail.rules.form.createTitle')}
          </DialogTitle>
          <DialogDescription>{t('projects:detail.rules.form.description')}</DialogDescription>
        </DialogHeader>

        <form className="space-y-5" onSubmit={handleSubmit}>
          <Field data-invalid={!!errors.name}>
            <FieldLabel htmlFor="project-rule-name" required>
              {t('projects:detail.rules.form.name')}
            </FieldLabel>
            <Input
              id="project-rule-name"
              value={name}
              maxLength={PROJECT_RULE_NAME_MAX_LENGTH}
              onChange={(event) => dispatch({ type: 'setName', name: event.target.value })}
              disabled={submitting}
              aria-invalid={!!errors.name}
              placeholder={t('projects:detail.rules.form.namePlaceholder')}
            />
            <FieldError>{errors.name}</FieldError>
          </Field>

          <ProjectRuleEvaluationEditor
            evaluationMode={evaluationMode}
            schedule={schedule}
            recipients={recipients}
            submitting={submitting}
            onModeChange={handleEvaluationModeChange}
            onScheduleChange={(patch) => dispatch({ type: 'setSchedule', patch })}
          />

          <ProjectRuleConditionsEditor
            conditionLogic={conditionLogic}
            conditions={conditions}
            errors={errors}
            submitting={submitting}
            availableFields={availableFields}
            fieldOptions={fieldOptions}
            permissions={permissions}
            evaluationMode={evaluationMode}
            dispatch={dispatch}
            onAddCondition={addCondition}
            onRemoveCondition={removeCondition}
            onUpdateCondition={updateCondition}
            onFieldChange={handleFieldChange}
            onOperatorChange={handleOperatorChange}
            onValueTypeChange={handleValueTypeChange}
          />

          <ProjectRuleActionsEditor
            actions={actions}
            errors={errors}
            submitting={submitting}
            userOptions={userOptions}
            roleOptions={roleOptions}
            webhookOptions={webhookOptions}
            actionTypeOptions={actionTypeOptions}
            recipientTypeOptions={recipientTypeOptions}
            allowEmptyActions={hasHiddenWebhookAction}
            dispatch={dispatch}
          />

          <Field className="flex-row items-center justify-between rounded-md border border-border p-3">
            <div className="space-y-1">
              <FieldLabel htmlFor="project-rule-enabled">
                {t('projects:detail.rules.form.enabled')}
              </FieldLabel>
              <p className="text-sm text-muted-foreground">
                {t('projects:detail.rules.form.enabledDescription')}
              </p>
            </div>
            <Switch
              id="project-rule-enabled"
              checked={isEnabled}
              onCheckedChange={(isEnabled) => dispatch({ type: 'setEnabled', isEnabled })}
              disabled={submitting}
            />
          </Field>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              {t('common:buttons.cancel')}
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? t('common:buttons.saving') : t('common:buttons.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

const ProjectRuleFormModal: React.FC<ProjectRuleFormModalProps> = (props) => {
  const availableFields = getAvailableProjectRuleFields(props.permissions);
  const initialField =
    props.rule?.field ??
    availableFields.find((definition) => definition.id === 'revenue')?.id ??
    availableFields[0]?.id ??
    '';
  const sessionKey = props.open ? `${props.rule?.id ?? 'new'}|${initialField}` : 'closed';

  return <ProjectRuleFormModalSession key={sessionKey} {...props} initialField={initialField} />;
};

export default ProjectRuleFormModal;
