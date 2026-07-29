import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';
import { projects } from './projects.ts';
import { users } from './users.ts';

export type ProjectRuleActionType = 'notify' | 'webhook';

export type ProjectRuleNotifyRecipientType = 'user' | 'role';

export type ProjectRuleNotifyAction =
  | {
      type: 'notify';
      recipientType: 'user';
      recipientUserIds: string[];
    }
  | {
      type: 'notify';
      recipientType: 'role';
      recipientRoleIds: string[];
    };

export type ProjectRuleWebhookAction = {
  type: 'webhook';
  webhookId: string;
};

export type ProjectRuleAction = ProjectRuleNotifyAction | ProjectRuleWebhookAction;

export type ProjectRuleActionConfig = {
  recipientUserIds: string[];
  recipientRoleIds: string[];
  webhookIds: string[];
  actions: ProjectRuleAction[];
};

export type ProjectRuleCondition = {
  field: string;
  operator: string;
  value: string;
  valueType: ProjectRuleConditionValueType;
};

export type ProjectRuleConditionLogic = 'and' | 'or';
export type ProjectRuleConditionValueType = 'literal' | 'field';
export type ProjectRuleEvaluationMode = 'continuous' | 'periodic';
export type ProjectRuleScheduleFrequency = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';
export type ProjectRuleSchedule = {
  frequency: ProjectRuleScheduleFrequency;
  timeZone: string;
  userIds: string[];
  taskIds: string[];
};

export const projectRules = pgTable(
  'project_rules',
  {
    id: varchar('id', { length: 50 }).primaryKey(),
    projectId: varchar('project_id', { length: 50 })
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    field: varchar('field', { length: 50 }).notNull(),
    operator: varchar('operator', { length: 30 }).notNull(),
    value: text('value').notNull(),
    conditionLogic: varchar('condition_logic', { length: 10 }).notNull().default('and'),
    conditions: jsonb('conditions')
      .$type<ProjectRuleCondition[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    actionType: varchar('action_type', { length: 30 }).notNull().default('notify'),
    actionConfig: jsonb('action_config')
      .$type<ProjectRuleActionConfig>()
      .notNull()
      .default(sql`'{"recipientUserIds":[],"recipientRoleIds":[]}'::jsonb`),
    evaluationMode: varchar('evaluation_mode', { length: 20 })
      .$type<ProjectRuleEvaluationMode>()
      .notNull()
      .default('continuous'),
    schedule: jsonb('schedule_config')
      .$type<ProjectRuleSchedule>()
      .notNull()
      .default(sql`'{"frequency":"monthly","timeZone":"UTC","userIds":[],"taskIds":[]}'::jsonb`),
    isEnabled: boolean('is_enabled').notNull().default(true),
    conditionMet: boolean('condition_met').notNull().default(false),
    lastTriggeredAt: timestamp('last_triggered_at'),
    lastEvaluatedPeriod: varchar('last_evaluated_period', { length: 160 }),
    configVersion: integer('config_version').notNull().default(0),
    createdBy: varchar('created_by', { length: 50 }).references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp('updated_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index('idx_project_rules_project_id').on(table.projectId),
    index('idx_project_rules_enabled').on(table.isEnabled),
    index('idx_project_rules_condition_met').on(table.conditionMet),
    index('idx_project_rules_evaluation_mode').on(table.evaluationMode),
  ],
);
