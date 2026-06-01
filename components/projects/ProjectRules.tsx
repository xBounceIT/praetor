import { BellRingIcon, PencilIcon, PlusIcon, RefreshCwIcon, Trash2Icon } from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
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

const emptyRecipients: ProjectRuleRecipientOptions = { users: [], roles: [] };

const canModifyRuleField = (rule: ProjectRule, permissions: string[]) => {
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
      (!definition?.requiresPermission || permissions.includes(definition.requiresPermission)) &&
      (!valueDefinition?.requiresPermission ||
        permissions.includes(valueDefinition.requiresPermission))
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

const ProjectRules: React.FC<ProjectRulesProps> = ({ projectId, permissions, className }) => {
  const { t } = useTranslation(['projects', 'common']);
  const canView = hasPermission(permissions, 'projects.rules.view');
  const canCreate = hasPermission(permissions, 'projects.rules.create');
  const canUpdate = hasPermission(permissions, 'projects.rules.update');
  const canDelete = hasPermission(permissions, 'projects.rules.delete');
  const [rules, setRules] = useState<ProjectRule[]>([]);
  const [recipients, setRecipients] = useState<ProjectRuleRecipientOptions>(emptyRecipients);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [formRule, setFormRule] = useState<ProjectRule | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [busyRuleId, setBusyRuleId] = useState<string | null>(null);
  const [ruleToDelete, setRuleToDelete] = useState<ProjectRule | null>(null);

  const loadRules = useCallback(
    async (signal?: AbortSignal) => {
      if (!canView) return;
      setLoading(true);
      setError(false);
      try {
        const [nextRules, nextRecipients] = await Promise.all([
          projectRulesApi.list(projectId, signal),
          projectRulesApi.getRecipients(projectId, signal),
        ]);
        if (signal?.aborted) return;
        setRules(nextRules);
        setRecipients(nextRecipients);
      } catch (err) {
        if (signal?.aborted) return;
        console.error('Failed to load project rules', err);
        setError(true);
      } finally {
        if (!signal?.aborted) setLoading(false);
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

  const handleSubmit = async (payload: ProjectRuleFormPayload) => {
    try {
      if (formRule) {
        const updated = await projectRulesApi.update(projectId, formRule.id, payload);
        setRules((current) => current.map((rule) => (rule.id === updated.id ? updated : rule)));
        toastSuccess(t('projects:detail.rules.toasts.updated'));
      } else {
        const created = await projectRulesApi.create(projectId, payload);
        setRules((current) => [...current, created]);
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
    setBusyRuleId(rule.id);
    try {
      const updated = await projectRulesApi.update(projectId, rule.id, { isEnabled: checked });
      setRules((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    } catch (err) {
      const message =
        err instanceof Error ? err.message : t('projects:detail.rules.toasts.saveFailed');
      toastError(message);
    } finally {
      setBusyRuleId(null);
    }
  };

  const handleDelete = async () => {
    if (!ruleToDelete || !canDelete) return;
    setBusyRuleId(ruleToDelete.id);
    try {
      await projectRulesApi.delete(projectId, ruleToDelete.id);
      setRules((current) => current.filter((rule) => rule.id !== ruleToDelete.id));
      toastSuccess(t('projects:detail.rules.toasts.deleted'));
      setRuleToDelete(null);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : t('projects:detail.rules.toasts.deleteFailed');
      toastError(message);
    } finally {
      setBusyRuleId(null);
    }
  };

  const sortedRules = useMemo(
    () => [...rules].sort((left, right) => left.name.localeCompare(right.name)),
    [rules],
  );
  const deletingSelectedRule = busyRuleId === ruleToDelete?.id;

  if (!canView) return null;

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1.5">
          <h2 className="text-base font-semibold leading-none">
            {t('projects:detail.rules.title')}
          </h2>
          <p className="text-sm text-muted-foreground">{t('projects:detail.rules.description')}</p>
        </div>
        {canCreate && (
          <Button
            type="button"
            size="sm"
            onClick={() => {
              setFormRule(null);
              setFormOpen(true);
            }}
            disabled={loading || error}
          >
            <PlusIcon className="size-4" />
            {t('projects:detail.rules.actions.add')}
          </Button>
        )}
      </div>

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
            <Button type="button" variant="outline" size="sm" onClick={() => void loadRules()}>
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
            {sortedRules.map((rule) => {
              const canUpdateThis = canUpdate && canModifyRuleField(rule, permissions);
              const disabledReason =
                canUpdate && !canUpdateThis
                  ? t('projects:detail.rules.costPermissionRequired')
                  : undefined;
              return (
                <li
                  key={rule.id}
                  className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                      <BellRingIcon className="size-4" />
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
                    </div>
                  </div>
                  <div className="flex items-center justify-end gap-2">
                    <Tooltip disabled={!disabledReason}>
                      <TooltipTrigger asChild>
                        <span className="inline-flex">
                          <Switch
                            checked={rule.isEnabled}
                            disabled={!canUpdateThis || busyRuleId === rule.id}
                            onCheckedChange={(checked) => void handleToggle(rule, checked)}
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
                              disabled={!canUpdateThis || busyRuleId === rule.id}
                              onClick={() => {
                                setFormRule(rule);
                                setFormOpen(true);
                              }}
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
                        disabled={busyRuleId === rule.id}
                        onClick={() => setRuleToDelete(rule)}
                        aria-label={t('projects:detail.rules.actions.delete')}
                      >
                        <Trash2Icon className="size-4 text-destructive" />
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <ProjectRuleFormModal
        open={formOpen}
        onOpenChange={setFormOpen}
        rule={formRule}
        recipients={recipients}
        permissions={permissions}
        onSubmit={handleSubmit}
      />

      <Dialog
        open={!!ruleToDelete}
        onOpenChange={(open) => !open && !deletingSelectedRule && setRuleToDelete(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('projects:detail.rules.delete.title')}</DialogTitle>
            <DialogDescription>
              {t('projects:detail.rules.delete.description', { name: ruleToDelete?.name ?? '' })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setRuleToDelete(null)}
              disabled={deletingSelectedRule}
            >
              {t('common:buttons.cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void handleDelete()}
              disabled={deletingSelectedRule}
            >
              {t('common:buttons.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ProjectRules;
