import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import type { User } from '../../../types';
import { installI18nMock } from '../../helpers/i18n';

installI18nMock();

const UserManagement = (await import('../../../components/administration/UserManagement')).default;

const updatePermission = 'administration.user_management.update';
const deletePermission = 'administration.user_management.delete';

const users: User[] = [
  {
    id: 'u1',
    name: 'Alice Admin',
    role: 'admin',
    avatarInitials: 'AA',
    username: 'alice.admin',
    email: 'alice@example.com',
  },
  {
    id: 'u2',
    name: 'Bob Brown',
    role: 'manager',
    avatarInitials: 'BB',
    username: 'bob.brown',
  },
];

const renderUserManagement = (overrides: Partial<ComponentProps<typeof UserManagement>> = {}) => {
  const props: ComponentProps<typeof UserManagement> = {
    users,
    clients: [],
    projects: [],
    tasks: [],
    onAddUser: mock(async () => ({ success: true })),
    onDeleteUser: mock(() => {}),
    onUpdateUser: mock(() => {}),
    onUpdateUserRoles: mock(async () => {}),
    currentUserId: 'u1',
    permissions: [updatePermission, deletePermission],
    roles: [],
    currency: '$',
    ...overrides,
  };

  render(<UserManagement {...props} />);
  return props;
};

const getRowFor = (text: string) => {
  const row = screen.getByText(text).closest('tr');
  if (!row) throw new Error(`Could not find row for ${text}`);
  return row;
};

describe('<UserManagement />', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test('renders user details through StandardTable columns', () => {
    renderUserManagement();

    expect(screen.getByText('Alice Admin')).toBeInTheDocument();
    expect(screen.getByText('alice.admin')).toBeInTheDocument();
    expect(screen.getByText('alice@example.com')).toBeInTheDocument();
    expect(screen.getByText('manager')).toBeInTheDocument();
    expect(screen.getByText('common:common.none')).toBeInTheDocument();
    expect(screen.getAllByText('common:common.active')).toHaveLength(2);
  });

  test('filters users with the external search input', () => {
    renderUserManagement();

    fireEvent.change(screen.getByPlaceholderText('hr:workforce.searchUsers'), {
      target: { value: 'alice' },
    });

    expect(screen.getByText('Alice Admin')).toBeInTheDocument();
    expect(screen.queryByText('Bob Brown')).not.toBeInTheDocument();
  });

  test('opens edit modal when an editable row is clicked', () => {
    renderUserManagement();

    fireEvent.click(screen.getByText('Bob Brown'));

    expect(screen.getByText('hr:workforce.editUser')).toBeInTheDocument();
  });

  test('action button does not also trigger row edit', () => {
    const props = renderUserManagement();
    const bobRow = getRowFor('Bob Brown');
    const disableButton = bobRow.querySelector('.fa-ban')?.closest('button');
    if (!disableButton) throw new Error('Could not find disable button');

    fireEvent.click(disableButton);

    expect(props.onUpdateUser).toHaveBeenCalledWith('u2', { isDisabled: true });
    expect(screen.queryByText('hr:workforce.editUser')).not.toBeInTheDocument();
  });

  test('shows empty state when no users match the search', () => {
    renderUserManagement();

    fireEvent.change(screen.getByPlaceholderText('hr:workforce.searchUsers'), {
      target: { value: 'nobody' },
    });

    expect(screen.getByText('hr:workforce.noUsers')).toBeInTheDocument();
    expect(screen.queryByText('Alice Admin')).not.toBeInTheDocument();
    expect(screen.queryByText('Bob Brown')).not.toBeInTheDocument();
  });
});
