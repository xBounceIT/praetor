import { describe, expect, mock, test } from 'bun:test';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { FC } from 'react';
import type { ProjectRuleFormModalProps } from '../../../components/projects/ProjectRuleFormModal';
import type { ProjectRule, ProjectRuleRecipientOptions } from '../../../types';
import { installI18nMock } from '../../helpers/i18n';
import { render } from '../../helpers/render';

installI18nMock();

// ProjectRules.test.tsx replaces this module with a stub via `mock.module`. Bun's module
// registry is shared process-wide and keyed by resolved path, so when that file loads first
// this SUT would otherwise resolve to the stub — a failure that depends on test-file load
// order (which differs between local and CI). A `?real` query suffix resolves to a fresh,
// unmocked instance, so we always exercise the real component regardless of load order.
// tsc cannot resolve a query-suffixed specifier, which is intentional here.
// @ts-expect-error -- query-suffixed specifier is unresolvable to tsc by design (see note above)
const realModalModule = await import('../../../components/projects/ProjectRuleFormModal.tsx?real');
const ProjectRuleFormModal = realModalModule.default as FC<ProjectRuleFormModalProps>;

const recipients: ProjectRuleRecipientOptions = {
  users: [{ id: 'u1', name: 'Alice', username: 'alice', avatarInitials: 'AL' }],
  roles: [{ id: 'manager', name: 'Manager' }],
  webhooks: [{ id: 'webhook-1', name: 'Slack' }],
};

const rule: ProjectRule = {
  id: 'rule-1',
  projectId: 'project-1',
  name: 'Revenue warning',
  field: 'revenue',
  operator: 'gt',
  value: '1000',
  conditionLogic: 'and',
  conditions: [{ field: 'revenue', operator: 'gt', value: '1000', valueType: 'literal' }],
  actionType: 'notify',
  actionConfig: {
    recipientUserIds: ['u1'],
    recipientRoleIds: [],
    webhookIds: [],
    actions: [{ type: 'notify', recipientType: 'user', recipientUserIds: ['u1'] }],
  },
  isEnabled: true,
  conditionMet: false,
  lastTriggeredAt: null,
  createdBy: 'admin',
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
};

const redactedMixedWebhookRule: ProjectRule = {
  ...rule,
  actionType: 'webhook',
};

describe('<ProjectRuleFormModal />', () => {
  test('keeps tall recipient selections inside a scrollable modal', () => {
    render(
      <ProjectRuleFormModal
        open
        onOpenChange={() => {}}
        rule={rule}
        recipients={recipients}
        permissions={['projects.rules.update']}
        onSubmit={() => Promise.resolve()}
      />,
    );

    expect(document.querySelector('[data-slot="dialog-content"]')).toHaveClass(
      'max-h-[calc(100vh-2rem)]',
      'overflow-y-auto',
    );
  });

  test('renders chained conditions as compact rows in one grouped list', () => {
    render(
      <ProjectRuleFormModal
        open
        onOpenChange={() => {}}
        rule={rule}
        recipients={recipients}
        permissions={['projects.rules.update']}
        onSubmit={() => Promise.resolve()}
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'projects:detail.rules.actions.addCondition' }),
    );

    const rowContainer = document.querySelector('.divide-y.divide-border');
    expect(rowContainer?.children).toHaveLength(2);
    expect(rowContainer?.parentElement).toHaveClass('rounded-md', 'border', 'border-border');
    expect(rowContainer?.previousElementSibling).toHaveClass('hidden', 'md:grid');
    for (const label of document.querySelectorAll('[for^="project-rule-field-"]')) {
      expect(label).toHaveClass('md:sr-only');
    }
  });

  test('renders project rule actions as addable rows', () => {
    render(
      <ProjectRuleFormModal
        open
        onOpenChange={() => {}}
        rule={rule}
        recipients={recipients}
        permissions={['projects.rules.update']}
        onSubmit={() => Promise.resolve()}
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'projects:detail.rules.actions.addAction' }),
    );

    const actionLabels = screen.getAllByText('projects:detail.rules.form.action');
    expect(actionLabels).toHaveLength(3);
    const actionHeader = actionLabels[0].parentElement;
    expect(actionHeader).toHaveClass('hidden', 'md:grid', 'border-b');
    expect(actionHeader?.parentElement).toHaveClass('rounded-md', 'border', 'border-border');
    expect(actionHeader?.nextElementSibling).toHaveClass('divide-y', 'divide-border');
    expect(actionHeader?.nextElementSibling?.children).toHaveLength(2);
    for (const label of document.querySelectorAll('[for^="project-rule-action-type-"]')) {
      expect(label).toHaveClass('md:sr-only');
    }
    expect(
      screen.getAllByRole('button', { name: 'projects:detail.rules.actions.removeAction' }),
    ).toHaveLength(2);
  });

  test('submits chained conditions with OR logic', async () => {
    const onSubmit = mock(() => Promise.resolve());

    render(
      <ProjectRuleFormModal
        open
        onOpenChange={() => {}}
        rule={rule}
        recipients={recipients}
        permissions={['projects.rules.update']}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(screen.getAllByRole('combobox')[0]);
    fireEvent.click(
      await screen.findByRole('option', {
        name: 'projects:detail.rules.conditionLogic.or',
      }),
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'projects:detail.rules.actions.addCondition' }),
    );
    fireEvent.change(document.getElementById('project-rule-value-1') as HTMLInputElement, {
      target: { value: '2500' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.save' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        field: 'revenue',
        operator: 'gt',
        value: '1000',
        conditionLogic: 'or',
        conditions: [
          { field: 'revenue', operator: 'gt', value: '1000', valueType: 'literal' },
          { field: 'revenue', operator: 'gt', value: '2500', valueType: 'literal' },
        ],
        actionType: 'notify',
        actionConfig: {
          recipientUserIds: ['u1'],
          recipientRoleIds: [],
          webhookIds: [],
          actions: [{ type: 'notify', recipientType: 'user', recipientUserIds: ['u1'] }],
        },
      }),
    );
  });

  test('preserves localized negative literal thresholds', async () => {
    const onSubmit = mock(() => Promise.resolve());
    render(
      <ProjectRuleFormModal
        open
        onOpenChange={() => {}}
        rule={rule}
        recipients={recipients}
        permissions={['projects.rules.update']}
        onSubmit={onSubmit}
      />,
    );

    const valueInput = document.getElementById('project-rule-value-0') as HTMLInputElement;
    fireEvent.change(valueInput, { target: { value: '-25,5' } });
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.save' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        value: '-25.5',
        conditions: [{ field: 'revenue', operator: 'gt', value: '-25.5', valueType: 'literal' }],
      }),
    );
  });

  test('submits a condition that compares against another field', async () => {
    const onSubmit = mock(() => Promise.resolve());

    render(
      <ProjectRuleFormModal
        open
        onOpenChange={() => {}}
        rule={rule}
        recipients={recipients}
        permissions={['projects.rules.update']}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(screen.getAllByRole('combobox')[3]);
    fireEvent.click(
      await screen.findByRole('option', { name: 'projects:detail.rules.valueTypes.field' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.save' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        field: 'revenue',
        operator: 'gt',
        value: 'hours_to_date',
        conditions: [
          { field: 'revenue', operator: 'gt', value: 'hours_to_date', valueType: 'field' },
        ],
      }),
    );
  });

  test('does not submit and shows an error when a notification action has no users', async () => {
    const onSubmit = mock(() => Promise.resolve());

    render(
      <ProjectRuleFormModal
        open
        onOpenChange={() => {}}
        rule={{
          ...rule,
          actionConfig: { recipientUserIds: [], recipientRoleIds: [], webhookIds: [], actions: [] },
        }}
        recipients={recipients}
        permissions={['projects.rules.update']}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.save' }));

    expect(
      await screen.findByText('projects:detail.rules.errors.usersRequired'),
    ).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test('submits edits for a redacted webhook-only rule without visible recipients', async () => {
    const onSubmit = mock(() => Promise.resolve());
    const redactedWebhookRule: ProjectRule = {
      ...rule,
      actionType: 'webhook',
      actionConfig: { recipientUserIds: [], recipientRoleIds: [], webhookIds: [], actions: [] },
    };

    render(
      <ProjectRuleFormModal
        open
        onOpenChange={() => {}}
        rule={redactedWebhookRule}
        recipients={{ ...recipients, webhooks: [] }}
        permissions={['projects.rules.update']}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.change(document.getElementById('project-rule-name') as HTMLInputElement, {
      target: { value: 'Renamed webhook rule' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.save' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Renamed webhook rule',
        actionType: 'webhook',
        actionConfig: {
          recipientUserIds: [],
          recipientRoleIds: [],
          webhookIds: [],
          actions: [],
        },
      }),
    );
  });

  test('can remove the last visible action from a redacted mixed webhook rule', async () => {
    const onSubmit = mock(() => Promise.resolve());
    render(
      <ProjectRuleFormModal
        open
        onOpenChange={() => {}}
        rule={redactedMixedWebhookRule}
        recipients={{ ...recipients, webhooks: [] }}
        permissions={['projects.rules.update']}
        onSubmit={onSubmit}
      />,
    );

    const removeButton = screen.getByRole('button', {
      name: 'projects:detail.rules.actions.removeAction',
    });
    expect(removeButton).not.toBeDisabled();
    fireEvent.click(removeButton);
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.save' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: 'webhook',
        actionConfig: {
          recipientUserIds: [],
          recipientRoleIds: [],
          webhookIds: [],
          actions: [],
        },
      }),
    );
  });

  test('can clear the last visible action from a redacted mixed webhook rule', async () => {
    const onSubmit = mock(() => Promise.resolve());
    render(
      <ProjectRuleFormModal
        open
        onOpenChange={() => {}}
        rule={redactedMixedWebhookRule}
        recipients={{ ...recipients, webhooks: [] }}
        permissions={['projects.rules.update']}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(
      document.getElementById('project-rule-action-recipient-0') as HTMLButtonElement,
    );
    fireEvent.click(await screen.findByRole('option', { name: 'Alice (alice)' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.save' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: 'webhook',
        actionConfig: {
          recipientUserIds: [],
          recipientRoleIds: [],
          webhookIds: [],
          actions: [],
        },
      }),
    );
  });

  test('hides the webhook action type without administration.webhooks.view', async () => {
    render(
      <ProjectRuleFormModal
        open
        onOpenChange={() => {}}
        rule={rule}
        recipients={{ ...recipients, webhooks: [] }}
        permissions={['projects.rules.update']}
        onSubmit={() => Promise.resolve()}
      />,
    );

    fireEvent.click(document.getElementById('project-rule-action-type-0') as HTMLButtonElement);

    expect(
      await screen.findByRole('option', {
        name: 'projects:detail.rules.form.actionTypes.notify',
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('option', {
        name: 'projects:detail.rules.form.actionTypes.webhook',
      }),
    ).not.toBeInTheDocument();
  });

  test('submits a notification action addressed to a role', async () => {
    const onSubmit = mock(() => Promise.resolve());
    const roleRule: ProjectRule = {
      ...rule,
      actionConfig: {
        recipientUserIds: [],
        recipientRoleIds: ['manager'],
        webhookIds: [],
        actions: [{ type: 'notify', recipientType: 'role', recipientRoleIds: ['manager'] }],
      },
    };

    render(
      <ProjectRuleFormModal
        open
        onOpenChange={() => {}}
        rule={roleRule}
        recipients={recipients}
        permissions={['projects.rules.update']}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.save' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        actionConfig: {
          recipientUserIds: [],
          recipientRoleIds: ['manager'],
          webhookIds: [],
          actions: [{ type: 'notify', recipientType: 'role', recipientRoleIds: ['manager'] }],
        },
      }),
    );
  });

  test('submits a webhook action', async () => {
    const onSubmit = mock(() => Promise.resolve());
    const webhookRule: ProjectRule = {
      ...rule,
      actionType: 'webhook',
      actionConfig: {
        recipientUserIds: [],
        recipientRoleIds: [],
        webhookIds: ['webhook-1'],
        actions: [{ type: 'webhook', webhookId: 'webhook-1' }],
      },
    };

    render(
      <ProjectRuleFormModal
        open
        onOpenChange={() => {}}
        rule={webhookRule}
        recipients={recipients}
        permissions={['projects.rules.update', 'administration.webhooks.view']}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.save' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: 'webhook',
        actionConfig: {
          recipientUserIds: [],
          recipientRoleIds: [],
          webhookIds: ['webhook-1'],
          actions: [{ type: 'webhook', webhookId: 'webhook-1' }],
        },
      }),
    );
  });

  test('does not submit and shows an error when a literal value is invalid', async () => {
    const onSubmit = mock(() => Promise.resolve());

    render(
      <ProjectRuleFormModal
        open
        onOpenChange={() => {}}
        rule={rule}
        recipients={recipients}
        permissions={['projects.rules.update']}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.change(document.getElementById('project-rule-value-0') as HTMLInputElement, {
      target: { value: '' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.save' }));

    expect(
      await screen.findByText('projects:detail.rules.errors.valueInvalid'),
    ).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test('hides the "compare against another field" option for enum fields without a peer', async () => {
    const enumRule: ProjectRule = {
      ...rule,
      field: 'billing_type',
      operator: 'eq',
      value: 'time_and_materials',
      conditions: [
        {
          field: 'billing_type',
          operator: 'eq',
          value: 'time_and_materials',
          valueType: 'literal',
        },
      ],
    };

    render(
      <ProjectRuleFormModal
        open
        onOpenChange={() => {}}
        rule={enumRule}
        recipients={recipients}
        permissions={['projects.rules.update']}
        onSubmit={mock(() => Promise.resolve())}
      />,
    );

    // The "Compare against" select is the 4th combobox (after logic, field, operator).
    fireEvent.click(screen.getAllByRole('combobox')[3]);

    expect(
      await screen.findByRole('option', { name: 'projects:detail.rules.valueTypes.literal' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('option', { name: 'projects:detail.rules.valueTypes.field' }),
    ).not.toBeInTheDocument();
  });
});
