import { PlusIcon, Trash2Icon } from 'lucide-react';
import type React from 'react';
import { useMemo, useReducer } from 'react';
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import type {
  ProjectRule,
  ProjectRuleActionConfig,
  ProjectRuleActionType,
  ProjectRuleCondition,
  ProjectRuleConditionLogic,
  ProjectRuleConditionValueType,
  ProjectRuleNotifyRecipientType,
  ProjectRuleRecipientOptions,
} from '../../types';
import SelectControl from '../shared/SelectControl';
import {
  getAvailableProjectRuleFields,
  getAvailableProjectRuleValueFields,
  getProjectRuleFieldDefinition,
  isValidProjectRuleConditionValue,
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
  conditionLogic: ProjectRuleConditionLogic;
  conditions: ProjectRuleCondition[];
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

type ProjectRuleFormAction =
  | { type: 'setName'; name: string }
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

const firstValueForField = (field: string) => {
  const definition = getProjectRuleFieldDefinition(field);
  if (definition?.kind === 'enum') return definition.enumValues?.[0] ?? '';
  return '';
};

const defaultConditionForField = (field: string): ProjectRuleCondition => {
  const definition = getProjectRuleFieldDefinition(field);
  return {
    field,
    operator: definition?.operators[0] ?? '',
    value: firstValueForField(field),
    valueType: 'literal',
  };
};

const normalizeConditionForForm = (condition: ProjectRuleCondition): ProjectRuleCondition => ({
  ...condition,
  valueType: condition.valueType ?? 'literal',
});

const uniqueStrings = (values: readonly string[]) => Array.from(new Set(values));

let actionRowCounter = 0;

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

const actionRowsForRule = (rule: ProjectRule | null | undefined): ProjectRuleFormActionRow[] => {
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

  return rows.length > 0 ? rows : [createActionRow()];
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
): ProjectRuleCondition[] => {
  if (rule?.conditions?.length) return rule.conditions.map(normalizeConditionForForm);
  if (rule) {
    return [
      {
        field: rule.field,
        operator: rule.operator,
        value: rule.value,
        valueType: 'literal',
      },
    ];
  }
  return fallbackField ? [defaultConditionForField(fallbackField)] : [];
};

const enumValueLabelKey = (field: string, value: string) => {
  if (field === 'billing_type') {
    if (value === 'time_and_materials') return 'projects:projects.billingTypes.timeAndMaterials';
    if (value === 'retainer') return 'projects:projects.billingTypes.retainer';
  }
  return `projects:detail.rules.values.${field}.${value}`;
};

const createProjectRuleFormState = (
  rule: ProjectRule | null | undefined,
  initialField: string,
): ProjectRuleFormState => ({
  name: rule?.name ?? '',
  conditionLogic: rule?.conditionLogic ?? 'and',
  conditions: conditionsForRule(rule, initialField),
  actions: actionRowsForRule(rule),
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
        conditions: [...state.conditions, defaultConditionForField(action.field)],
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

type ProjectRuleOption = { id: string; name: string };

const ProjectRuleConditionsEditor: React.FC<{
  conditionLogic: ProjectRuleConditionLogic;
  conditions: ProjectRuleCondition[];
  errors: Record<string, string>;
  submitting: boolean;
  availableFields: ReturnType<typeof getAvailableProjectRuleFields>;
  fieldOptions: ProjectRuleOption[];
  permissions: string[];
  dispatch: React.Dispatch<ProjectRuleFormAction>;
  onAddCondition: () => void;
  onRemoveCondition: (index: number) => void;
  onUpdateCondition: (index: number, patch: Partial<ProjectRuleCondition>) => void;
  onFieldChange: (index: number, nextField: string) => void;
  onValueTypeChange: (index: number, nextValueType: ProjectRuleConditionValueType) => void;
}> = ({
  conditionLogic,
  conditions,
  errors,
  submitting,
  availableFields,
  fieldOptions,
  permissions,
  dispatch,
  onAddCondition,
  onRemoveCondition,
  onUpdateCondition,
  onFieldChange,
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
                name: t(enumValueLabelKey(condition.field, id)),
              })) ?? [];
            const valueType = condition.valueType ?? 'literal';
            const valueFieldOptions = getAvailableProjectRuleValueFields(
              condition.field,
              permissions,
            ).map((definition) => ({
              id: definition.id,
              name: t(`projects:detail.rules.fields.${definition.id}`),
            }));
            const valueTypeChoices: readonly ProjectRuleConditionValueType[] =
              valueFieldOptions.length > 0
                ? (['literal', 'field'] as const)
                : (['literal'] as const);
            const fieldError = errors[`field-${index}`];
            const operatorError = errors[`operator-${index}`];
            const valueError = errors[`value-${index}`];
            return (
              <div
                key={`${condition.field}-${index}`}
                className={`${CONDITION_GRID_CLASSNAME} p-3`}
              >
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
                      <SelectGroup>
                        {fieldOptions.map((option) => (
                          <SelectItem key={option.id} value={option.id}>
                            {option.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
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
                    onValueChange={(operator) => onUpdateCondition(index, { operator })}
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
                    disabled={submitting}
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
                    required
                  >
                    {t(
                      valueType === 'field'
                        ? 'projects:detail.rules.form.targetField'
                        : 'projects:detail.rules.form.value',
                    )}
                  </FieldLabel>
                  {valueType === 'field' ? (
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
                        <SelectGroup>
                          {valueFieldOptions.map((option) => (
                            <SelectItem key={option.id} value={option.id}>
                              {option.name}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  ) : fieldDefinition?.kind === 'enum' ? (
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
                          {enumValueOptions.map((option) => (
                            <SelectItem key={option.id} value={option.id}>
                              {option.name}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      id={`project-rule-value-${index}`}
                      type="number"
                      step="any"
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
                  disabled={submitting || actions.length === 1}
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
  const availableFields = useMemo(() => getAvailableProjectRuleFields(permissions), [permissions]);
  const [formState, dispatch] = useReducer(projectRuleFormReducer, undefined, () =>
    createProjectRuleFormState(rule, initialField),
  );
  const { name, conditionLogic, conditions, actions, isEnabled, errors, submitting } = formState;

  const fieldOptions = availableFields.map((definition) => ({
    id: definition.id,
    name: t(`projects:detail.rules.fields.${definition.id}`),
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
    { id: 'webhook', name: t('projects:detail.rules.form.actionTypes.webhook') },
  ];
  const recipientTypeOptions: Array<{ id: ProjectRuleNotifyRecipientType; name: string }> = [
    { id: 'user', name: t('projects:detail.rules.form.recipientTypes.user') },
    { id: 'role', name: t('projects:detail.rules.form.recipientTypes.role') },
  ];

  const updateCondition = (index: number, patch: Partial<ProjectRuleCondition>) => {
    dispatch({ type: 'updateCondition', index, patch });
  };

  const firstValueFieldForField = (field: string) =>
    getAvailableProjectRuleValueFields(field, permissions)[0]?.id ?? '';

  const handleFieldChange = (index: number, nextField: string) => {
    const currentValueType = conditions[index]?.valueType ?? 'literal';
    const nextValueField = firstValueFieldForField(nextField);
    const nextValueType: ProjectRuleConditionValueType =
      currentValueType === 'field' && nextValueField ? 'field' : 'literal';
    const nextDefinition = getProjectRuleFieldDefinition(nextField);
    updateCondition(index, {
      field: nextField,
      operator: nextDefinition?.operators[0] ?? '',
      valueType: nextValueType,
      value: nextValueType === 'field' ? nextValueField : firstValueForField(nextField),
    });
  };

  const handleValueTypeChange = (index: number, nextValueType: ProjectRuleConditionValueType) => {
    const field = conditions[index]?.field ?? '';
    updateCondition(index, {
      valueType: nextValueType,
      value: nextValueType === 'field' ? firstValueFieldForField(field) : firstValueForField(field),
    });
  };

  const addCondition = () => {
    const field = availableFields[0]?.id ?? '';
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
          value: condition.value,
          valueType: condition.valueType ?? 'literal',
          permissions,
        })
      ) {
        nextErrors[`value-${index}`] = t('projects:detail.rules.errors.valueInvalid');
      }
    });
    if (actions.length === 0) {
      nextErrors.actions = t('projects:detail.rules.errors.actionsRequired');
    }
    actions.forEach((action, index) => {
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
      const actionConfig = buildActionConfigFromRows(actions);
      const actionType = actionConfig.actions[0]?.type ?? 'notify';
      await onSubmit({
        name: name.trim(),
        field: firstCondition.field,
        operator: firstCondition.operator,
        value: firstCondition.value,
        conditionLogic,
        conditions: normalizedConditions,
        actionType,
        actionConfig,
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
              onChange={(event) => dispatch({ type: 'setName', name: event.target.value })}
              disabled={submitting}
              aria-invalid={!!errors.name}
              placeholder={t('projects:detail.rules.form.namePlaceholder')}
            />
            <FieldError>{errors.name}</FieldError>
          </Field>

          <ProjectRuleConditionsEditor
            conditionLogic={conditionLogic}
            conditions={conditions}
            errors={errors}
            submitting={submitting}
            availableFields={availableFields}
            fieldOptions={fieldOptions}
            permissions={permissions}
            dispatch={dispatch}
            onAddCondition={addCondition}
            onRemoveCondition={removeCondition}
            onUpdateCondition={updateCondition}
            onFieldChange={handleFieldChange}
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
  const initialField =
    props.rule?.field ?? getAvailableProjectRuleFields(props.permissions)[0]?.id ?? '';
  const sessionKey = props.open ? `${props.rule?.id ?? 'new'}|${initialField}` : 'closed';

  return <ProjectRuleFormModalSession key={sessionKey} {...props} initialField={initialField} />;
};

export default ProjectRuleFormModal;
