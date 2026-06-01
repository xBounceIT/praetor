import { describe, expect, mock, test } from 'bun:test';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { ProjectRule, ProjectRuleRecipientOptions } from '../../../types';
import { installI18nMock } from '../../helpers/i18n';
import { render } from '../../helpers/render';

installI18nMock();

const ProjectRuleFormModal = (await import('../../../components/projects/ProjectRuleFormModal'))
  .default;

const recipients: ProjectRuleRecipientOptions = {
  users: [{ id: 'u1', name: 'Alice', username: 'alice', avatarInitials: 'AL' }],
  roles: [{ id: 'manager', name: 'Manager' }],
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
  actionConfig: { recipientUserIds: ['u1'], recipientRoleIds: [] },
  isEnabled: true,
  conditionMet: false,
  lastTriggeredAt: null,
  createdBy: 'admin',
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
};

describe('<ProjectRuleFormModal />', () => {
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
    fireEvent.change(screen.getAllByRole('spinbutton')[1], { target: { value: '2500' } });

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
        actionConfig: { recipientUserIds: ['u1'], recipientRoleIds: [] },
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
});
