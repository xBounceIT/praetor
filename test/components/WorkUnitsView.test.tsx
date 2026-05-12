import { afterEach, describe, expect, mock, test } from 'bun:test';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { User, WorkUnit } from '../../types';
import { installI18nMock } from '../helpers/i18n';

installI18nMock();

// Modal renders via createPortal which is unreliable in happy-dom + React 19; replace
// with a passthrough that flattens children when isOpen.
mock.module('../../components/shared/Modal', () => ({
  default: ({ isOpen, children }: { isOpen: boolean; children: ReactNode }) =>
    isOpen ? <div data-testid="modal">{children}</div> : null,
}));

// Stub workUnitsApi at the sub-module level. WorkUnitsView imports workUnitsApi from this
// path, which sidesteps any pollution of the services/api umbrella mock from sibling tests.
const updateUsersMock = mock((_id: string, _ids: string[]) => Promise.resolve(undefined));
const getUsersMock = mock((_id: string) => Promise.resolve<string[]>([]));
mock.module('../../services/api/workUnits', () => ({
  workUnitsApi: {
    getUsers: (id: string) => getUsersMock(id),
    updateUsers: (id: string, ids: string[]) => updateUsersMock(id, ids),
  },
}));

const WorkUnitsView = (await import('../../components/WorkUnitsView')).default;

const user: User = {
  id: 'u-1',
  name: 'Test Manager',
  role: 'manager',
  avatarInitials: 'TM',
  username: 'tmanager',
};

const unit: WorkUnit = {
  id: 'wu-1',
  name: 'Engineering',
  managers: [{ id: 'u-1', name: 'Test Manager' }],
  description: 'Engineering team',
  userCount: 5,
};

const allPermissions = [
  'hr.work_units.view',
  'hr.work_units.create',
  'hr.work_units.update',
  'hr.work_units.delete',
];

afterEach(() => {
  document.body.style.overflow = '';
  updateUsersMock.mockClear();
  getUsersMock.mockClear();
});

describe('<WorkUnitsView /> double-submit prevention', () => {
  test('handleCreate: rapidly clicking submit calls onAddWorkUnit only once', async () => {
    let resolveAdd: (() => void) | undefined;
    const onAddWorkUnit = mock(
      (_data: { name: string; managerIds: string[]; description: string }) =>
        new Promise<void>((resolve) => {
          resolveAdd = resolve;
        }),
    );

    render(
      <WorkUnitsView
        workUnits={[]}
        users={[user]}
        permissions={allPermissions}
        onAddWorkUnit={onAddWorkUnit}
        onUpdateWorkUnit={() => Promise.resolve()}
        onDeleteWorkUnit={() => Promise.resolve()}
        refreshWorkUnits={() => Promise.resolve()}
      />,
    );

    // Open create modal
    fireEvent.click(screen.getByText('hr:workUnits.newWorkUnit'));

    // Fill in form: name input + pick a manager via the real CustomSelect.
    const nameInput = document.querySelector('input[type="text"]') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'New Unit' } });

    // The select trigger is a button rendered by CustomSelect; open it then click the option.
    const modal = screen.getByTestId('modal');
    const selectTriggers = modal.querySelectorAll('button[type="button"]');
    // The first button is the X close, the second is the CustomSelect trigger.
    const selectTrigger = Array.from(selectTriggers).find((b) =>
      b.textContent?.includes('hr:workUnits.selectManagers'),
    ) as HTMLButtonElement;
    fireEvent.click(selectTrigger);
    fireEvent.click(screen.getByText(user.name));

    // Find submit button (Create Unit) - the form's submit button. Its text changes
    // between "createUnit" and "saving" when isSubmitting toggles, so we look it up via
    // type="submit" each time.
    const form = modal.querySelector('form') as HTMLFormElement;
    const findSubmit = () => form.querySelector('button[type="submit"]') as HTMLButtonElement;

    await waitFor(() => {
      expect(findSubmit().disabled).toBe(false);
    });

    // Submit the form three times rapidly. The first call fires the async handler;
    // subsequent submits should be no-ops because isSubmitting is true.
    fireEvent.submit(form);
    fireEvent.submit(form);
    fireEvent.submit(form);

    await waitFor(() => {
      expect(findSubmit().disabled).toBe(true);
    });

    // Resolve the in-flight call
    resolveAdd?.();

    await waitFor(() => {
      expect(onAddWorkUnit).toHaveBeenCalledTimes(1);
    });
  });

  test('handleDelete: rapidly clicking confirm calls onDeleteWorkUnit only once', async () => {
    let resolveDel: (() => void) | undefined;
    const onDeleteWorkUnit = mock(
      (_id: string) =>
        new Promise<void>((resolve) => {
          resolveDel = resolve;
        }),
    );

    render(
      <WorkUnitsView
        workUnits={[unit]}
        users={[user]}
        permissions={allPermissions}
        onAddWorkUnit={() => Promise.resolve()}
        onUpdateWorkUnit={() => Promise.resolve()}
        onDeleteWorkUnit={onDeleteWorkUnit}
        refreshWorkUnits={() => Promise.resolve()}
      />,
    );

    // Locate the delete trigger button on the unit card (icon button -> opens confirm modal)
    // The delete trigger has a `<i className="fa-solid fa-trash-can" />` inside.
    const trashIcons = document.querySelectorAll('i.fa-trash-can');
    expect(trashIcons.length).toBeGreaterThan(0);
    const trashButton = trashIcons[0]?.closest('button') as HTMLButtonElement;
    fireEvent.click(trashButton);

    // Now the delete confirm modal is open. The confirm button's text toggles between
    // "yesDelete" and "saving" while in-flight; find it by being inside the visible modal
    // and using the red styling. Two modals render: one for assignments (closed) and one
    // for delete confirm (open). The yesDelete button is unique by its initial text.
    const initialConfirm = screen.getByText('hr:workUnits.yesDelete') as HTMLButtonElement;
    expect(initialConfirm.disabled).toBe(false);
    // Find a stable handle: the parent <div className="flex gap-3 pt-2"> contains both the
    // cancel and confirm buttons in the delete modal. Keep a reference to that container so
    // we can re-query the confirm button after re-render.
    const buttonsContainer = initialConfirm.parentElement as HTMLElement;
    const findConfirm = () =>
      Array.from(buttonsContainer.querySelectorAll('button')).find(
        (b) => b.className.includes('bg-red-600') || b.className.includes('opacity-50'),
      ) as HTMLButtonElement;

    fireEvent.click(initialConfirm);
    fireEvent.click(initialConfirm);
    fireEvent.click(initialConfirm);

    await waitFor(() => {
      expect(findConfirm().disabled).toBe(true);
    });

    resolveDel?.();

    await waitFor(() => {
      expect(onDeleteWorkUnit).toHaveBeenCalledTimes(1);
    });
  });
});
