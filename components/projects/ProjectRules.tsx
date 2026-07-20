import {
  BellRingIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
  Webhook as WebhookIcon,
} from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useMemo, useReducer } from 'react';
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
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { projectRulesApi } from '../../services/api/projectRules';
import type { ProjectRule, ProjectRuleRecipientOptions } from '../../types';
import { hasPermission } from '../../utils/permissions';
import { toastError, toastSuccess } from '../../utils/toast';
import ProjectRuleFormModal, { type ProjectRuleFormPayload } from './ProjectRuleFormModal';
import { getProjectRuleFieldDefinition } from './projectRuleRegistry';

export interface ProjectRulesProps {
  projectId: string;
  permissions: string[];
  className?: string;
}

const emptyRecipients: ProjectRuleRecipientOptions = { users: [], roles: [], webhooks: [] };

type ProjectRulesState = {
  rules: ProjectRule[];
  recipients: ProjectRuleRecipientOptions;
  loading: boolean;
  error: boolean;
  formRule: ProjectRule | null;
  formOpen: boolean;
  busyRuleId: string | null;
  ruleToDelete: ProjectRule | null;
};

type ProjectRulesAction =
  | { type: 'loadStart' }
  | { type: 'loadSuccess'; rules: ProjectRule[]; recipients: ProjectRuleRecipientOptions }
  | { type: 'loadError' }
  | { type: 'openCreateForm' }
  | { type: 'openEditForm'; rule: ProjectRule }
  | { type: 'setFormOpen'; open: boolean }
  | { type: 'upsertRule'; rule: ProjectRule }
  | { type: 'setBusyRule'; ruleId: string | null }
  | { type: 'confirmDelete'; rule: ProjectRule }
  | { type: 'clearDelete' }
  | { type: 'deleteRule'; ruleId: string };

const createProjectRulesState = (): ProjectRulesState => ({
  rules: [],
  recipients: emptyRecipients,
  loading: true,
  error: false,
  formRule: null,
  formOpen: false,
  busyRuleId: null,
  ruleToDelete: null,
});

const projectRulesReducer = (
  state: ProjectRulesState,
  action: ProjectRulesAction,
): ProjectRulesState => {
  switch (action.type) {
    case 'loadStart':
      return { ...state, loading: true, error: false };
    case 'loadSuccess':
      return {
        ...state,
        rules: action.rules,
        recipients: action.recipients,
        loading: false,
        error: false,
      };
    case 'loadError':
      return { ...state, loading: false, error: true };
    case 'openCreateForm':
      return { ...state, formRule: null, formOpen: true };
    case 'openEditForm':
      return { ...state, formRule: action.rule, formOpen: true };
    case 'setFormOpen':
      return { ...state, formOpen: action.open };
    case 'upsertRule':
      return {
        ...state,
        rules: state.rules.some((rule) => rule.id === action.rule.id)
          ? state.rules.map((rule) => (rule.id === action.rule.id ? action.rule : rule))
          : [...state.rules, action.rule],
      };
    case 'setBusyRule':
      return { ...state, busyRuleId: action.ruleId };
    case 'confirmDelete':
      return { ...state, ruleToDelete: action.rule };
    case 'clearDelete':
      return { ...state, ruleToDelete: null };
    case 'deleteRule':
      return {
        ...state,
        rules: state.rules.filter((rule) => rule.id !== action.ruleId),
        ruleToDelete: null,
      };
    default:
      return state;
  }
};

const canModifyRuleField = (rule: ProjectRule, permissions: string[]) => {
  const permissionSet = new Set(permissions);
  const conditions =
    rule.conditions?.length > 0
      ? rule.conditions
      : [
          {
            field: rule.field,
            operator: rule.operator,
            value: rule.value,
            valueType: 'literal' as const,
          },
        ];
  return conditions.every((condition) => {
    const definition = getProjectRuleFieldDefinition(condition.field);
    const valueDefinition =
      condition.valueType === 'field' ? getProjectRuleFieldDefinition(condition.value) : null;
    return (
      (!definition?.requiresPermission || permissionSet.has(definition.requiresPermission)) &&
      (!valueDefinition?.requiresPermission ||
        permissionSet.has(valueDefinition.requiresPermission))
    );
  });
};

const enumValueLabelKey = (field: string, value: string) => {
  if (field === 'billing_type') {
    if (value === 'time_and_materials') return 'projects:projects.billingTypes.timeAndMaterials';
    if (value === 'retainer') return 'projects:projects.billingTypes.retainer';
  }
  return `projects:detail.rules.values.${field}.${value}`;
};

type ProjectRuleFormatter = (rule: ProjectRule) => string;

const ProjectRulesHeader: React.FC<{
  canCreate: boolean;
  loading: boolean;
  error: boolean;
  onCreate: () => void;
}> = ({ canCreate, loading, error, onCreate }) => {
  const { t } = useTranslation(['projects', 'common']);

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="space-y-1.5">
        <h2 className="text-base font-semibold leading-none">{t('projects:detail.rules.title')}</h2>
        <p className="text-sm text-muted-foreground">{t('projects:detail.rules.description')}</p>
      </div>
      {canCreate && (
        <Button type="button" size="sm" onClick={onCreate} disabled={loading || error}>
          <PlusIcon className="size-4" />
          {t('projects:detail.rules.actions.add')}
        </Button>
      )}
    </div>
  );
};

const ProjectRuleListItem: React.FC<{
  rule: ProjectRule;
  permissions: string[];
  canUpdate: boolean;
  canDelete: boolean;
  busyRuleId: string | null;
  ruleSummary: ProjectRuleFormatter;
  actionSummary: ProjectRuleFormatter;
  onToggle: (rule: ProjectRule, checked: boolean) => void;
  onEdit: (rule: ProjectRule) => void;
  onDelete: (rule: ProjectRule) => void;
}> = ({
  rule,
  permissions,
  canUpdate,
  canDelete,
  busyRuleId,
  ruleSummary,
  actionSummary,
  onToggle,
  onEdit,
  onDelete,
}) => {
  const { t } = useTranslation(['projects', 'common']);
  const canUpdateThis = canUpdate && canModifyRuleField(rule, permissions);
  const disabledReason =
    canUpdate && !canUpdateThis ? t('projects:detail.rules.costPermissionRequired') : undefined;
  const hasNotificationRecipients =
    rule.actionConfig.recipientUserIds.length + rule.actionConfig.recipientRoleIds.length > 0;
  const hasHiddenWebhookAction =
    rule.actionType === 'webhook' &&
    !hasPermission(permissions, 'administration.webhooks.view') &&
    rule.actionConfig.webhookIds.length === 0;
  const Icon =
    !hasNotificationRecipients &&
    (rule.actionConfig.webhookIds.length > 0 || hasHiddenWebhookAction)
      ? WebhookIcon
      : BellRingIcon;
  const busy = busyRuleId === rule.id;

  return (
    <li className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <Icon className="size-4" />
        </div>
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-medium text-foreground">{rule.name}</p>
            {rule.conditionMet && (
              <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-medium uppercase text-primary">
                {t('projects:detail.rules.conditionMet')}
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground">{ruleSummary(rule)}</p>
          <p className="text-xs text-muted-foreground">{actionSummary(rule)}</p>
        </div>
      </div>
      <div className="flex items-center justify-end gap-2">
        <Tooltip disabled={!disabledReason}>
          <TooltipTrigger asChild>
            <span className="inline-flex">
              <Switch
                checked={rule.isEnabled}
                disabled={!canUpdateThis || busy}
                onCheckedChange={(checked) => onToggle(rule, checked)}
                aria-label={t('projects:detail.rules.actions.toggle')}
              />
            </span>
          </TooltipTrigger>
          <TooltipContent>{disabledReason}</TooltipContent>
        </Tooltip>
        {canUpdate && (
          <Tooltip disabled={!disabledReason}>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={!canUpdateThis || busy}
                  onClick={() => onEdit(rule)}
                  aria-label={t('projects:detail.rules.actions.edit')}
                >
                  <PencilIcon className="size-4" />
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {disabledReason ?? t('projects:detail.rules.actions.edit')}
            </TooltipContent>
          </Tooltip>
        )}
        {canDelete && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={busy}
            onClick={() => onDelete(rule)}
            aria-label={t('projects:detail.rules.actions.delete')}
          >
            <Trash2Icon className="size-4 text-destructive" />
          </Button>
        )}
      </div>
    </li>
  );
};

const ProjectRulesPanel: React.FC<{
  loading: boolean;
  error: boolean;
  sortedRules: ProjectRule[];
  permissions: string[];
  canUpdate: boolean;
  canDelete: boolean;
  busyRuleId: string | null;
  ruleSummary: ProjectRuleFormatter;
  actionSummary: ProjectRuleFormatter;
  onRefresh: () => void;
  onToggle: (rule: ProjectRule, checked: boolean) => void;
  onEdit: (rule: ProjectRule) => void;
  onDelete: (rule: ProjectRule) => void;
}> = ({
  loading,
  error,
  sortedRules,
  permissions,
  canUpdate,
  canDelete,
  busyRuleId,
  ruleSummary,
  actionSummary,
  onRefresh,
  onToggle,
  onEdit,
  onDelete,
}) => {
  const { t } = useTranslation(['projects', 'common']);

  return (
    <div className="rounded-lg border border-border bg-background">
      {loading ? (
        <div className="space-y-3 p-4">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : error ? (
        <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
          <p className="text-sm text-muted-foreground">
            {t('projects:detail.rules.errors.loadFailed')}
          </p>
          <Button type="button" variant="outline" size="sm" onClick={onRefresh}>
            <RefreshCwIcon className="size-4" />
            {t('common:buttons.refresh')}
          </Button>
        </div>
      ) : sortedRules.length === 0 ? (
        <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
          <BellRingIcon className="size-8 text-muted-foreground" />
          <div className="space-y-1">
            <p className="text-sm font-medium">{t('projects:detail.rules.empty.title')}</p>
            <p className="text-sm text-muted-foreground">
              {t('projects:detail.rules.empty.description')}
            </p>
          </div>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {sortedRules.map((rule) => (
            <ProjectRuleListItem
              key={rule.id}
              rule={rule}
              permissions={permissions}
              canUpdate={canUpdate}
              canDelete={canDelete}
              busyRuleId={busyRuleId}
              ruleSummary={ruleSummary}
              actionSummary={actionSummary}
              onToggle={onToggle}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))}
        </ul>
      )}
    </div>
  );
};

const ProjectRuleDeleteDialog: React.FC<{
  ruleToDelete: ProjectRule | null;
  deleting: boolean;
  onCancel: () => void;
  onDelete: () => void;
}> = ({ ruleToDelete, deleting, onCancel, onDelete }) => {
  const { t } = useTranslation(['projects', 'common']);

  return (
    <Dialog open={!!ruleToDelete} onOpenChange={(open) => !open && !deleting && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('projects:detail.rules.delete.title')}</DialogTitle>
          <DialogDescription>
            {t('projects:detail.rules.delete.description', { name: ruleToDelete?.name ?? '' })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel} disabled={deleting}>
            {t('common:buttons.cancel')}
          </Button>
          <Button type="button" variant="destructive" onClick={onDelete} disabled={deleting}>
            {t('common:buttons.delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const ProjectRules: React.FC<ProjectRulesProps> = ({ projectId, permissions, className }) => {
  const { t } = useTranslation(['projects', 'common']);
  const canView = hasPermission(permissions, 'projects.rules.view');
  const canCreate = hasPermission(permissions, 'projects.rules.create');
  const canUpdate = hasPermission(permissions, 'projects.rules.update');
  const canDelete = hasPermission(permissions, 'projects.rules.delete');
  const canViewWebhookTargets = hasPermission(permissions, 'administration.webhooks.view');
  const [state, dispatch] = useReducer(projectRulesReducer, undefined, createProjectRulesState);
  const { rules, recipients, loading, error, formRule, formOpen, busyRuleId, ruleToDelete } = state;
  const loadRules = useCallback(
    async (signal?: AbortSignal) => {
      if (!canView) return;
      dispatch({ type: 'loadStart' });
      try {
        const [nextRules, nextRecipients] = await Promise.all([
          projectRulesApi.list(projectId, signal),
          projectRulesApi.getRecipients(projectId, signal),
        ]);
        if (signal?.aborted) return;
        dispatch({ type: 'loadSuccess', rules: nextRules, recipients: nextRecipients });
      } catch (err) {
        if (signal?.aborted) return;
        console.error('Failed to load project rules', err);
        dispatch({ type: 'loadError' });
      }
    },
    [canView, projectId],
  );
  useEffect(() => {
    if (!canView) return;
    const controller = new AbortController();
    void loadRules(controller.signal);
    return () => controller.abort();
  }, [canView, loadRules]);

  const ruleSummary = useCallback(
    (rule: ProjectRule) => {
      const conditions =
        rule.conditions?.length > 0
          ? rule.conditions
          : [
              {
                field: rule.field,
                operator: rule.operator,
                value: rule.value,
                valueType: 'literal' as const,
              },
            ];
      const joiner = ` ${t(`projects:detail.rules.joiners.${rule.conditionLogic ?? 'and'}`)} `;
      return conditions
        .map((condition) => {
          const field = t(`projects:detail.rules.fields.${condition.field}`);
          const operator = t(`projects:detail.rules.operators.${condition.operator}`);
          const definition = getProjectRuleFieldDefinition(condition.field);
          const value =
            condition.valueType === 'field'
              ? t(`projects:detail.rules.fields.${condition.value}`)
              : definition?.kind === 'enum'
                ? t(enumValueLabelKey(condition.field, condition.value))
                : condition.value;
          return `${field} ${operator} ${value}`;
        })
        .join(joiner);
    },
    [t],
  );

  const webhookNameById = useMemo(
    () => new Map(recipients.webhooks.map((webhook) => [webhook.id, webhook.name])),
    [recipients.webhooks],
  );

  const actionSummary = useCallback(
    (rule: ProjectRule) => {
      const parts: string[] = [];
      const userCount = rule.actionConfig.recipientUserIds.length;
      const roleCount = rule.actionConfig.recipientRoleIds.length;
      if (userCount > 0) {
        parts.push(t('projects:detail.rules.actionSummary.users', { count: userCount }));
      }
      if (roleCount > 0) {
        parts.push(t('projects:detail.rules.actionSummary.roles', { count: roleCount }));
      }
      if (rule.actionConfig.webhookIds.length > 0) {
        const names = rule.actionConfig.webhookIds
          .map((id) => webhookNameById.get(id) ?? id)
          .join(', ');
        parts.push(t('projects:detail.rules.actionSummary.webhooks', { names }));
      } else if (!canViewWebhookTargets && rule.actionType === 'webhook') {
        parts.push(t('projects:detail.rules.actionSummary.hiddenWebhook'));
      }
      return parts.length > 0 ? parts.join(' · ') : t('projects:detail.rules.actionSummary.none');
    },
    [canViewWebhookTargets, t, webhookNameById],
  );

  const handleSubmit = async (payload: ProjectRuleFormPayload) => {
    try {
      if (formRule) {
        const updated = await projectRulesApi.update(projectId, formRule.id, payload);
        dispatch({ type: 'upsertRule', rule: updated });
        toastSuccess(t('projects:detail.rules.toasts.updated'));
      } else {
        const created = await projectRulesApi.create(projectId, payload);
        dispatch({ type: 'upsertRule', rule: created });
        toastSuccess(t('projects:detail.rules.toasts.created'));
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : t('projects:detail.rules.toasts.saveFailed');
      toastError(message);
      throw err;
    }
  };

  const handleToggle = async (rule: ProjectRule, checked: boolean) => {
    if (!canUpdate || !canModifyRuleField(rule, permissions)) return;
    dispatch({ type: 'setBusyRule', ruleId: rule.id });
    try {
      const updated = await projectRulesApi.update(projectId, rule.id, { isEnabled: checked });
      dispatch({ type: 'upsertRule', rule: updated });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : t('projects:detail.rules.toasts.saveFailed');
      toastError(message);
    } finally {
      dispatch({ type: 'setBusyRule', ruleId: null });
    }
  };

  const handleDelete = async () => {
    if (!ruleToDelete || !canDelete) return;
    dispatch({ type: 'setBusyRule', ruleId: ruleToDelete.id });
    try {
      await projectRulesApi.delete(projectId, ruleToDelete.id);
      dispatch({ type: 'deleteRule', ruleId: ruleToDelete.id });
      toastSuccess(t('projects:detail.rules.toasts.deleted'));
    } catch (err) {
      const message =
        err instanceof Error ? err.message : t('projects:detail.rules.toasts.deleteFailed');
      toastError(message);
    } finally {
      dispatch({ type: 'setBusyRule', ruleId: null });
    }
  };

  const sortedRules = useMemo(
    () => rules.toSorted((left, right) => left.name.localeCompare(right.name)),
    [rules],
  );
  const deletingSelectedRule = busyRuleId === ruleToDelete?.id;

  if (!canView) return null;

  return (
    <div className={cn('space-y-3', className)}>
      <ProjectRulesHeader
        canCreate={canCreate}
        loading={loading}
        error={error}
        onCreate={() => dispatch({ type: 'openCreateForm' })}
      />

      <ProjectRulesPanel
        loading={loading}
        error={error}
        sortedRules={sortedRules}
        permissions={permissions}
        canUpdate={canUpdate}
        canDelete={canDelete}
        busyRuleId={busyRuleId}
        ruleSummary={ruleSummary}
        actionSummary={actionSummary}
        onRefresh={() => void loadRules()}
        onToggle={(rule, checked) => void handleToggle(rule, checked)}
        onEdit={(rule) => dispatch({ type: 'openEditForm', rule })}
        onDelete={(rule) => dispatch({ type: 'confirmDelete', rule })}
      />

      <ProjectRuleFormModal
        open={formOpen}
        onOpenChange={(open) => dispatch({ type: 'setFormOpen', open })}
        rule={formRule}
        recipients={recipients}
        permissions={permissions}
        onSubmit={handleSubmit}
      />

      <ProjectRuleDeleteDialog
        ruleToDelete={ruleToDelete}
        deleting={deletingSelectedRule}
        onCancel={() => dispatch({ type: 'clearDelete' })}
        onDelete={() => void handleDelete()}
      />
    </div>
  );
};

export default ProjectRules;
