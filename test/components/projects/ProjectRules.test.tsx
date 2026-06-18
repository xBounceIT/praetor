import { beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { ProjectRule, ProjectRuleRecipientOptions } from '../../../types';
import { installI18nMock } from '../../helpers/i18n';
import { clearSpyStateAfterAll } from '../../helpers/mockCleanup';
import { render } from '../../helpers/render';

installI18nMock();

const listMock = mock();
const recipientsMock = mock();
const createMock = mock();
const updateMock = mock();
const deleteMock = mock();
const toastSuccessMock = mock();
const toastErrorMock = mock();

mock.module('../../../services/api/projectRules', () => ({
  projectRulesApi: {
    list: listMock,
    getRecipients: recipientsMock,
    create: createMock,
    update: updateMock,
    delete: deleteMock,
  },
}));

mock.module('../../../utils/toast', () => ({
  toastSuccess: toastSuccessMock,
  toastError: toastErrorMock,
}));

mock.module('../../../components/projects/ProjectRuleFormModal', () => ({
  default: ({
    open,
    rule,
    onSubmit,
  }: {
    open: boolean;
    rule?: ProjectRule | null;
    onSubmit: (payload: unknown) => Promise<void>;
  }) =>
    open ? (
      <button
        type="button"
        onClick={() =>
          void onSubmit({
            name: rule ? 'Edited rule' : 'New rule',
            field: 'revenue',
            operator: 'gte',
            value: '1000',
            conditionLogic: 'and',
            conditions: [
              { field: 'revenue', operator: 'gte', value: '1000', valueType: 'literal' },
            ],
            actionType: 'notify',
            actionConfig: {
              recipientUserIds: ['u1'],
              recipientRoleIds: [],
              webhookIds: ['webhook-1'],
              actions: [
                { type: 'notify', recipientType: 'user', recipientUserIds: ['u1'] },
                { type: 'webhook', webhookId: 'webhook-1' },
              ],
            },
            isEnabled: true,
          })
        }
      >
        {rule ? 'submit-edit-rule' : 'submit-create-rule'}
      </button>
    ) : null,
}));

clearSpyStateAfterAll();

const ProjectRules = (await import('../../../components/projects/ProjectRules')).default;

const RULE: ProjectRule = {
  id: 'pr-1',
  projectId: 'p1',
  name: 'Budget warning',
  field: 'revenue',
  operator: 'gte',
  value: '1000',
  conditionLogic: 'and',
  conditions: [{ field: 'revenue', operator: 'gte', value: '1000', valueType: 'literal' }],
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
  createdBy: 'u-admin',
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
};

const deferValue = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
};

const renderProjectRules = (permissions: string[]) =>
  render(<ProjectRules projectId="p1" permissions={permissions} />);

beforeEach(() => {
  for (const fn of [
    listMock,
    recipientsMock,
    createMock,
    updateMock,
    deleteMock,
    toastSuccessMock,
    toastErrorMock,
  ]) {
    fn.mockReset();
  }
  listMock.mockResolvedValue([]);
  recipientsMock.mockResolvedValue({
    users: [{ id: 'u1', name: 'Alice', username: 'alice', avatarInitials: 'AL' }],
    roles: [{ id: 'manager', name: 'Manager' }],
    webhooks: [{ id: 'webhook-1', name: 'Slack' }],
  });
  createMock.mockResolvedValue({ ...RULE, id: 'pr-created', name: 'New rule' });
  updateMock.mockImplementation(
    (_projectId: string, _ruleId: string, payload: Partial<ProjectRule>) =>
      Promise.resolve({ ...RULE, ...payload }),
  );
  deleteMock.mockResolvedValue(undefined);
});

describe('<ProjectRules />', () => {
  test('hides the section without projects.rules.view', () => {
    renderProjectRules([]);

    expect(screen.queryByText('projects:detail.rules.title')).not.toBeInTheDocument();
    expect(listMock).not.toHaveBeenCalled();
  });

  test('renders empty state and hides add without create permission', async () => {
    renderProjectRules(['projects.rules.view']);

    expect(await screen.findByText('projects:detail.rules.empty.title')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'projects:detail.rules.actions.add' }),
    ).not.toBeInTheDocument();
  });

  test('shows loading state while rules and recipients are pending', async () => {
    const pendingRules = deferValue<ProjectRule[]>();
    const pendingRecipients = deferValue<ProjectRuleRecipientOptions>();
    listMock.mockReturnValue(pendingRules.promise);
    recipientsMock.mockReturnValue(pendingRecipients.promise);

    renderProjectRules(['projects.rules.view', 'projects.rules.create']);

    const addButton = screen.getByRole('button', {
      name: 'projects:detail.rules.actions.add',
    });
    expect(addButton).toBeDisabled();
    expect(screen.queryByText('projects:detail.rules.empty.title')).not.toBeInTheDocument();

    pendingRules.resolve([]);
    pendingRecipients.resolve({ users: [], roles: [], webhooks: [] });

    await waitFor(() => expect(addButton).not.toBeDisabled());
  });

  test('renders an error state and can retry loading rules', async () => {
    const consoleError = spyOn(console, 'error').mockImplementation(() => {});
    let loadCount = 0;
    listMock.mockImplementation(() => {
      loadCount += 1;
      return loadCount === 1 ? Promise.reject(new Error('boom')) : Promise.resolve([]);
    });
    try {
      renderProjectRules(['projects.rules.view']);

      expect(
        await screen.findByText('projects:detail.rules.errors.loadFailed'),
      ).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'common:buttons.refresh' }));

      expect(await screen.findByText('projects:detail.rules.empty.title')).toBeInTheDocument();
      expect(listMock).toHaveBeenCalledTimes(2);
    } finally {
      consoleError.mockRestore();
    }
  });

  test('creates a rule through the form modal callback', async () => {
    renderProjectRules(['projects.rules.view', 'projects.rules.create']);

    fireEvent.click(
      await screen.findByRole('button', { name: 'projects:detail.rules.actions.add' }),
    );
    fireEvent.click(screen.getByText('submit-create-rule'));

    await waitFor(() => expect(createMock).toHaveBeenCalled());
    expect(createMock).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({
        name: 'New rule',
        actionType: 'notify',
        actionConfig: expect.objectContaining({ webhookIds: ['webhook-1'] }),
      }),
    );
  });

  test('renders webhook action summaries', async () => {
    listMock.mockResolvedValue([
      {
        ...RULE,
        actionConfig: {
          recipientUserIds: [],
          recipientRoleIds: [],
          webhookIds: ['webhook-1'],
          actions: [{ type: 'webhook', webhookId: 'webhook-1' }],
        },
      },
    ]);
    renderProjectRules(['projects.rules.view']);

    expect(
      await screen.findByText('projects:detail.rules.actionSummary.webhooks'),
    ).toBeInTheDocument();
  });

  test('hides edit and delete controls, and disables toggle without matching permissions', async () => {
    listMock.mockResolvedValue([RULE]);
    renderProjectRules(['projects.rules.view']);

    expect(await screen.findByText('Budget warning')).toBeInTheDocument();
    expect(
      screen.getByRole('switch', { name: 'projects:detail.rules.actions.toggle' }),
    ).toBeDisabled();
    expect(
      screen.queryByRole('button', { name: 'projects:detail.rules.actions.edit' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'projects:detail.rules.actions.delete' }),
    ).not.toBeInTheDocument();
  });

  test('edits and toggles an existing rule when update permission is present', async () => {
    listMock.mockResolvedValue([RULE]);
    renderProjectRules(['projects.rules.view', 'projects.rules.update']);

    expect(await screen.findByText('Budget warning')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'projects:detail.rules.actions.edit' }));
    fireEvent.click(screen.getByText('submit-edit-rule'));

    await waitFor(() =>
      expect(updateMock).toHaveBeenCalledWith(
        'p1',
        'pr-1',
        expect.objectContaining({ name: 'Edited rule' }),
      ),
    );

    fireEvent.click(screen.getByRole('switch', { name: 'projects:detail.rules.actions.toggle' }));
    await waitFor(() =>
      expect(updateMock).toHaveBeenCalledWith('p1', 'pr-1', { isEnabled: false }),
    );
  });

  test('deletes a rule after confirmation', async () => {
    listMock.mockResolvedValue([RULE]);
    renderProjectRules(['projects.rules.view', 'projects.rules.delete']);

    expect(await screen.findByText('Budget warning')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'projects:detail.rules.actions.delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.delete' }));

    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith('p1', 'pr-1'));
  });

  test('prevents duplicate delete submits while deletion is pending', async () => {
    const pendingDelete = deferValue<void>();
    listMock.mockResolvedValue([RULE]);
    deleteMock.mockReturnValue(pendingDelete.promise);
    renderProjectRules(['projects.rules.view', 'projects.rules.delete']);

    expect(await screen.findByText('Budget warning')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'projects:detail.rules.actions.delete' }));
    const confirmButton = screen.getByRole('button', { name: 'common:buttons.delete' });
    fireEvent.click(confirmButton);

    await waitFor(() => expect(confirmButton).toBeDisabled());
    fireEvent.click(confirmButton);
    expect(deleteMock).toHaveBeenCalledTimes(1);

    pendingDelete.resolve(undefined);
    await waitFor(() =>
      expect(toastSuccessMock).toHaveBeenCalledWith('projects:detail.rules.toasts.deleted'),
    );
  });

  test('disables update controls for cost-derived rules without cost permission', async () => {
    listMock.mockResolvedValue([
      {
        ...RULE,
        field: 'budget_used_pct',
        conditions: [
          { field: 'budget_used_pct', operator: 'gte', value: '1000', valueType: 'literal' },
        ],
      },
    ]);
    renderProjectRules(['projects.rules.view', 'projects.rules.update']);

    expect(await screen.findByText('Budget warning')).toBeInTheDocument();
    expect(
      screen.getByRole('switch', { name: 'projects:detail.rules.actions.toggle' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'projects:detail.rules.actions.edit' }),
    ).toBeDisabled();
  });
});
