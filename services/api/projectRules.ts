import type {
  ProjectRule,
  ProjectRuleCondition,
  ProjectRuleConditionLogic,
  ProjectRuleRecipientOptions,
} from '../../types';
import { fetchApi } from './client';

export type ProjectRulePayload = {
  name: string;
  field: string;
  operator: string;
  value: string;
  conditionLogic?: ProjectRuleConditionLogic;
  conditions?: ProjectRuleCondition[];
  actionType?: 'notify';
  actionConfig: {
    recipientUserIds: string[];
    recipientRoleIds: string[];
  };
  isEnabled?: boolean;
};

export const projectRulesApi = {
  list: (projectId: string, signal?: AbortSignal): Promise<ProjectRule[]> =>
    fetchApi<ProjectRule[]>(`/projects/${projectId}/rules`, { signal }),

  getRecipients: (projectId: string, signal?: AbortSignal): Promise<ProjectRuleRecipientOptions> =>
    fetchApi<ProjectRuleRecipientOptions>(`/projects/${projectId}/rules/recipients`, { signal }),

  create: (projectId: string, data: ProjectRulePayload): Promise<ProjectRule> =>
    fetchApi<ProjectRule>(`/projects/${projectId}/rules`, {
      method: 'POST',
      body: JSON.stringify({ actionType: 'notify', ...data }),
    }),

  update: (
    projectId: string,
    ruleId: string,
    data: Partial<ProjectRulePayload>,
  ): Promise<ProjectRule> =>
    fetchApi<ProjectRule>(`/projects/${projectId}/rules/${ruleId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  delete: (projectId: string, ruleId: string): Promise<void> =>
    fetchApi<void>(`/projects/${projectId}/rules/${ruleId}`, { method: 'DELETE' }),
};
