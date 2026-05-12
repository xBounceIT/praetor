import { describe, expect, mock, test } from 'bun:test';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { User, WorkUnit } from '../../../types';
import { installI18nMock } from '../../helpers/i18n';
import { render } from '../../helpers/render';

installI18nMock();

// Mock the sub-module the component imports so we don't hit the network.
mock.module('../../../services/api/workUnits', () => ({
  workUnitsApi: {
    getUsers: () => Promise.resolve([]),
    updateUsers: () => Promise.resolve(),
  },
}));

const WorkUnitsView = (await import('../../../components/WorkUnitsView')).default;

const USERS: User[] = [
  {
    id: 'u1',
    name: 'Alice',
    username: 'alice',
    role: 'admin',
    avatarInitials: 'AL',
  } as unknown as User,
];

const UNIT: WorkUnit = {
  id: 'wu-1',
  name: 'Engineering',
  managers: [{ id: 'u1', name: 'Alice' }],
  description: 'eng',
  userCount: 1,
};

const PERMISSIONS = [
  'hr.work_units.create',
  'hr.work_units.update',
  'hr.work_units.delete',
  'hr.work_units.view',
];

const renderWorkUnitsView = (overrides: {
  onAdd?: ReturnType<typeof mock>;
  onUpdate?: ReturnType<typeof mock>;
  onDelete?: ReturnType<typeof mock>;
  refresh?: ReturnType<typeof mock>;
  workUnits?: WorkUnit[];
} = {}) => {
  const onAdd = overrides.onAdd ?? mock(() => Promise.resolve());
  const onUpdate = overrides.onUpdate ?? mock(() => Promise.resolve());
  const onDelete = overrides.onDelete ?? mock(() => Promise.resolve());
  const refresh = overrides.refresh ?? mock(() => Promise.resolve());

  const utils = render(
    <WorkUnitsView
      workUnits={overrides.workUnits ?? [UNIT]}
      users={USERS}
      permissions={PERMISSIONS}
      onAddWorkUnit={onAdd as unknown as never}
      onUpdateWorkUnit={onUpdate as unknown as never}
      onDeleteWorkUnit={onDelete as unknown as never}
      refreshWorkUnits={refresh as unknown as never}
    />,
  );
  return { ...utils, onAdd, onUpdate, onDelete, refresh };
};

const findFormByHeading = (heading: string) => {
  // Prefer the heading rendered as an h3 (the modal title) to disambiguate
  // from any HeaderAddButton text that may share the same translation key.
  const headings = screen.getAllByText(heading);
  const headingEl = headings.find((el) => el.tagName === 'H3') ?? headings[0];
  if (!headingEl) throw new Error(`heading "${heading}" not found`);
  const form = headingEl.parentElement?.parentElement?.querySelector('form');
  if (!form) throw new Error(`form for "${heading}" not found`);
  return form as HTMLFormElement;
};

describe('<WorkUnitsView /> double-submit guards', () => {
  test('handleCreate: rapid submits call onAddWorkUnit only once', async () => {
    let resolveAdd: (() => void) | undefined;
    const onAdd = mock(
      () =>
        new Promise<void>((resolve) => {
          resolveAdd = () => resolve();
        }),
    );

    const { onAdd: addMock } = renderWorkUnitsView({ onAdd, workUnits: [] });
    const user = userEvent.setup();

    // Open the create modal.
    await user.click(screen.getByRole('button', { name: /hr:workUnits\.newWorkUnit/ }));

    // Fill the unit name (the first required text input in the form).
    const form = findFormByHeading('hr:workUnits.newWorkUnit');
    const nameInput = form.querySelector('input[type="text"]') as HTMLInputElement;
    if (!nameInput) throw new Error('unit name input not found');
    fireEvent.change(nameInput, { target: { value: 'New Unit' } });

    // Select a manager.
    const managerButton = screen
      .getAllByRole('button')
      .find((b) => b.textContent?.includes('hr:workUnits.selectManagers'));
    if (!managerButton) throw new Error('manager select trigger not found');
    await user.click(managerButton);
    const aliceOption = await screen.findByRole('option', { name: 'Alice' });
    await user.click(aliceOption);

    fireEvent.submit(form);
    fireEvent.submit(form);
    fireEvent.submit(form);

    // The fix awaits onAddWorkUnit before closing — the modal stays open
    // (the form must remain in the document while the await is pending).
    expect(form.isConnected).toBe(true);

    await act(async () => {
      resolveAdd?.();
    });

    expect(addMock).toHaveBeenCalledTimes(1);
  });

  test('handleUpdate: rapid submits call onUpdateWorkUnit only once', async () => {
    let resolveUpdate: (() => void) | undefined;
    const onUpdate = mock(
      () =>
        new Promise<void>((resolve) => {
          resolveUpdate = () => resolve();
        }),
    );

    const { onUpdate: updateMock } = renderWorkUnitsView({ onUpdate });

    // Open the edit modal via the per-row Edit button (single Edit button per unit).
    const editButtons = screen.getAllByRole('button').filter((btn) => {
      const icon = btn.querySelector('i.fa-solid.fa-pen');
      return icon !== null && !btn.querySelector('i.fa-trash-can');
    });
    if (editButtons.length === 0) throw new Error('edit button not found');
    fireEvent.click(editButtons[0]);

    const form = findFormByHeading('hr:workUnits.editWorkUnit');

    fireEvent.submit(form);
    fireEvent.submit(form);
    fireEvent.submit(form);

    // While the update is in flight, the form should still be mounted.
    expect(form.isConnected).toBe(true);

    await act(async () => {
      resolveUpdate?.();
    });

    expect(updateMock).toHaveBeenCalledTimes(1);
  });

  test('handleDelete: rapid clicks call onDeleteWorkUnit only once', async () => {
    let resolveDelete: (() => void) | undefined;
    const onDelete = mock(
      () =>
        new Promise<void>((resolve) => {
          resolveDelete = () => resolve();
        }),
    );

    const { onDelete: deleteMock } = renderWorkUnitsView({ onDelete });

    // Open delete confirm via the per-row Delete (trash) button.
    const deleteButtons = screen
      .getAllByRole('button')
      .filter((btn) => btn.querySelector('i.fa-trash-can'));
    if (deleteButtons.length === 0) throw new Error('delete button not found');
    fireEvent.click(deleteButtons[0]);

    // Confirm dialog: find the Yes-delete button.
    const confirm = await screen.findByRole('button', { name: 'hr:workUnits.yesDelete' });

    fireEvent.click(confirm);
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    // While delete is in flight, the confirmation button must still be mounted.
    expect(confirm.isConnected).toBe(true);

    await act(async () => {
      resolveDelete?.();
    });

    expect(deleteMock).toHaveBeenCalledTimes(1);
  });

  test('close controls are inert while a create submit is in flight', async () => {
    let resolveAdd: (() => void) | undefined;
    const onAdd = mock(
      () =>
        new Promise<void>((resolve) => {
          resolveAdd = () => resolve();
        }),
    );

    renderWorkUnitsView({ onAdd, workUnits: [] });
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /hr:workUnits\.newWorkUnit/ }));

    const form = findFormByHeading('hr:workUnits.newWorkUnit');
    const nameInput = form.querySelector('input[type="text"]') as HTMLInputElement;
    if (!nameInput) throw new Error('unit name input not found');
    fireEvent.change(nameInput, { target: { value: 'New Unit' } });

    // Select a manager.
    const managerButton = screen
      .getAllByRole('button')
      .find((b) => b.textContent?.includes('hr:workUnits.selectManagers'));
    if (!managerButton) throw new Error('manager select trigger not found');
    await user.click(managerButton);
    await user.click(await screen.findByRole('option', { name: 'Alice' }));

    fireEvent.submit(form);

    // Cancel button (inside the modal form) must be disabled while submit is in flight.
    const cancel = Array.from(form.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'common:buttons.cancel',
    ) as HTMLButtonElement | undefined;
    if (!cancel) throw new Error('cancel button not found inside form');
    expect(cancel.disabled).toBe(true);

    fireEvent.click(cancel);
    // The form is still mounted because closing is blocked while submitting.
    expect(form.isConnected).toBe(true);

    await act(async () => {
      resolveAdd?.();
    });
    await waitFor(() => {
      expect(form.isConnected).toBe(false);
    });
  });
});
