import { describe, expect, mock, test } from 'bun:test';
import { screen } from '@testing-library/react';
import UserAssignmentModal from '../../../components/shared/UserAssignmentModal';
import type { Role, User } from '../../../types';
import { installI18nMock } from '../../helpers/i18n';
import { render } from '../../helpers/render';

installI18nMock();

const users: User[] = [
  {
    id: 'u1',
    name: 'Marco Bianchi',
    username: 'mbianchi',
    role: 'manager',
    avatarInitials: 'MB',
  },
  {
    id: 'u2',
    name: 'Elena Rossi',
    username: 'erossi',
    role: 'designer',
    avatarInitials: 'ER',
  },
];

const roles: Role[] = [
  { id: 'manager', name: 'Manager', permissions: [], isAdmin: false, isSystem: true },
  { id: 'designer', name: 'Designer', permissions: [], isAdmin: false, isSystem: false },
];

const renderModal = () =>
  render(
    <UserAssignmentModal
      isOpen
      onClose={mock(() => {})}
      users={users}
      roles={roles}
      loadAssignedUserIds={mock(async () => [])}
      saveAssignedUserIds={mock(async () => {})}
      entityLabel="Progetto"
      entityName="Website Redesign"
    />,
  );

describe('<UserAssignmentModal /> dark-mode contrast', () => {
  test('renders role chips through the shared StatusBadge', async () => {
    renderModal();
    await screen.findByText('Marco Bianchi');

    const badges = screen.getAllByText(/^(Manager|Designer)$/);
    expect(badges.length).toBe(2);
    for (const badge of badges) {
      const chip = badge.closest('[data-status-badge]');
      expect(chip).not.toBeNull();
      // StatusBadge supplies dark-mode variants so chips stay legible on dark surfaces.
      expect(chip?.className ?? '').toContain('dark:');
    }
  });

  test('uses theme tokens instead of bridge-fragile hardcoded colors', async () => {
    renderModal();
    await screen.findByText('Marco Bianchi');

    const dialog = screen.getByRole('dialog');
    const markup = dialog.innerHTML;

    // The removed hardcoded classes are invisible / wrong on the dark theme.
    expect(markup).not.toContain('border-zinc-200/60');
    expect(markup).not.toContain('bg-praetor/5');
    expect(markup).not.toContain('hover:bg-zinc-50');
    expect(markup).not.toContain('border-zinc-300');

    // Token-based replacements that adapt to the active theme.
    expect(markup).toContain('bg-card');
    expect(markup).toContain('border-border');
  });
});
