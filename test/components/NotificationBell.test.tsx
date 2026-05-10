import { describe, expect, mock, test } from 'bun:test';
import { fireEvent, render, screen } from '@testing-library/react';
import type { Notification } from '../../types';
import { installI18nMock } from '../helpers/i18n';

installI18nMock();

// NotificationBell receives data via props, but the project convention is to
// stub services/api in component tests so transitive imports never hit the
// network.
mock.module('../../services/api', () => ({
  default: {
    notifications: {
      list: mock(() => Promise.resolve([] as Notification[])),
      markAsRead: mock(() => Promise.resolve()),
      markAllAsRead: mock(() => Promise.resolve()),
      delete: mock(() => Promise.resolve()),
    },
  },
  getAuthToken: () => null,
  setAuthToken: () => {},
}));

const NotificationBell = (await import('../../components/shared/NotificationBell')).default;

const NOW = 1_700_000_000_000;

const sampleNotifications: Notification[] = [
  {
    id: 'n1',
    userId: 'u1',
    type: 'new_projects',
    title: 'Original title',
    isRead: false,
    createdAt: NOW - 5 * 60 * 1000,
    data: { projectNames: ['Project A', 'Project B'], clientName: 'ACME' },
  },
  {
    id: 'n2',
    userId: 'u1',
    type: 'generic',
    title: 'A generic notification',
    isRead: true,
    createdAt: NOW - 2 * 60 * 60 * 1000,
  },
];

const baseProps = {
  notifications: sampleNotifications,
  unreadCount: 1,
  onMarkAsRead: () => {},
  onMarkAllAsRead: () => {},
  onDelete: () => {},
};

const openDropdown = () =>
  fireEvent.click(screen.getByRole('button', { name: 'notifications.title' }));

describe('<NotificationBell />', () => {
  test('renders the bell button and the unread count badge when unread > 0', () => {
    render(<NotificationBell {...baseProps} unreadCount={3} />);

    const bell = screen.getByRole('button', { name: 'notifications.title' });
    expect(bell).toBeInTheDocument();
    expect(bell.querySelector('i.fa-bell')).not.toBeNull();
    expect(screen.getByText('3')).toHaveClass('bg-destructive', 'text-background');
  });

  test('hides the unread badge when count is zero', () => {
    render(<NotificationBell {...baseProps} notifications={[]} unreadCount={0} />);
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  test('caps the badge at "99+" when unread count exceeds 99', () => {
    render(<NotificationBell {...baseProps} notifications={[]} unreadCount={150} />);
    expect(screen.getByText('99+')).toBeInTheDocument();
  });

  test('clicking the bell opens the dropdown and renders notifications', () => {
    render(<NotificationBell {...baseProps} />);

    expect(screen.queryByText('A generic notification')).not.toBeInTheDocument();

    openDropdown();

    expect(screen.getByText('notifications.newProjects')).toBeInTheDocument();
    expect(screen.getByText('A generic notification')).toBeInTheDocument();
  });

  test('notification rows use theme tokens instead of hardcoded light colors', () => {
    render(<NotificationBell {...baseProps} />);

    openDropdown();

    const unreadTitle = screen.getByText('notifications.newProjects');
    const unreadRow = unreadTitle.closest('.group');
    expect(unreadRow).not.toBeNull();
    expect(unreadRow).toHaveClass('bg-accent', 'text-accent-foreground', 'border-border');
    expect(unreadRow?.className).not.toContain('bg-blue-50/50');
    expect(unreadTitle).toHaveClass('text-accent-foreground', 'font-medium');
    expect(unreadTitle.className).not.toContain('text-zinc-800');

    const readTitle = screen.getByText('A generic notification');
    const readRow = readTitle.closest('.group');
    expect(readRow).not.toBeNull();
    expect(readRow).toHaveClass('bg-popover', 'text-popover-foreground', 'border-border');
    expect(readRow?.className).not.toContain('bg-white');
    expect(readTitle).toHaveClass('text-muted-foreground');
    expect(readTitle.className).not.toContain('text-zinc-600');
  });

  test('admin password warning notifications use the warning icon', () => {
    const warning: Notification = {
      id: 'admin-default-password-warning',
      userId: 'u1',
      type: 'admin_password_warning',
      title: 'Change the default admin password',
      isRead: false,
      createdAt: NOW,
    };

    const { container } = render(<NotificationBell {...baseProps} notifications={[warning]} />);

    openDropdown();

    expect(screen.getByText('Change the default admin password')).toBeInTheDocument();
    expect(container.querySelector('i.fa-triangle-exclamation')).not.toBeNull();
    expect(container.querySelector('i.fa-folder-tree')).toBeNull();
  });

  test('clicking a single-project notification uses the singular translation key', () => {
    const single: Notification = {
      id: 'n3',
      userId: 'u1',
      type: 'new_projects',
      title: 'fallback',
      isRead: false,
      createdAt: NOW,
      data: { projectNames: ['Solo'] },
    };

    render(<NotificationBell {...baseProps} notifications={[single]} />);

    openDropdown();
    expect(screen.getByText('notifications.newProject')).toBeInTheDocument();
  });

  test('empty notification list shows the noNotifications empty state', () => {
    render(<NotificationBell {...baseProps} notifications={[]} unreadCount={0} />);

    openDropdown();
    expect(screen.getByText('notifications.noNotifications')).toBeInTheDocument();
  });

  test('clicking an unread notification calls onMarkAsRead with its id', () => {
    const onMarkAsRead = mock((_id: string) => {});
    render(<NotificationBell {...baseProps} onMarkAsRead={onMarkAsRead} />);

    openDropdown();
    fireEvent.click(screen.getByText('notifications.newProjects'));

    expect(onMarkAsRead).toHaveBeenCalledWith('n1');
  });

  test('clicking an already-read notification does NOT call onMarkAsRead', () => {
    const onMarkAsRead = mock((_id: string) => {});
    render(<NotificationBell {...baseProps} onMarkAsRead={onMarkAsRead} />);

    openDropdown();
    fireEvent.click(screen.getByText('A generic notification'));

    expect(onMarkAsRead).not.toHaveBeenCalled();
  });

  test('"Mark all as read" button calls onMarkAllAsRead', () => {
    const onMarkAllAsRead = mock(() => {});
    render(<NotificationBell {...baseProps} unreadCount={2} onMarkAllAsRead={onMarkAllAsRead} />);

    openDropdown();
    fireEvent.click(screen.getByText('notifications.markAllAsRead'));

    expect(onMarkAllAsRead).toHaveBeenCalled();
  });

  test('"Mark all as read" is hidden when unreadCount is zero', () => {
    render(<NotificationBell {...baseProps} unreadCount={0} />);

    openDropdown();
    expect(screen.queryByText('notifications.markAllAsRead')).not.toBeInTheDocument();
  });

  test('per-notification delete button calls onDelete and stops propagation', () => {
    const onDelete = mock((_id: string) => {});
    const onMarkAsRead = mock((_id: string) => {});
    render(<NotificationBell {...baseProps} onMarkAsRead={onMarkAsRead} onDelete={onDelete} />);

    openDropdown();

    const deleteButtons = screen.getAllByRole('button', { name: 'notifications.delete' });
    expect(deleteButtons.length).toBeGreaterThan(0);
    fireEvent.click(deleteButtons[0]);

    expect(onDelete).toHaveBeenCalledWith('n1');
    // Propagation must be stopped, otherwise the row's mark-as-read fires too.
    expect(onMarkAsRead).not.toHaveBeenCalled();
  });

  test('clicking outside the dropdown closes it', () => {
    render(
      <div>
        <div data-testid="outside">outside</div>
        <NotificationBell {...baseProps} />
      </div>,
    );

    openDropdown();
    expect(screen.getByText('A generic notification')).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByTestId('outside'));

    expect(screen.queryByText('A generic notification')).not.toBeInTheDocument();
  });

  test('"Show projects" toggle expands and collapses the project list', () => {
    render(<NotificationBell {...baseProps} />);

    openDropdown();

    fireEvent.click(screen.getByText('notifications.showProjects'));
    expect(screen.getByText('notifications.hideProjects')).toBeInTheDocument();

    fireEvent.click(screen.getByText('notifications.hideProjects'));
    expect(screen.getByText('notifications.showProjects')).toBeInTheDocument();
  });

  test('clicking the bell again closes the dropdown', () => {
    render(<NotificationBell {...baseProps} />);
    const bell = screen.getByRole('button', { name: 'notifications.title' });

    fireEvent.click(bell);
    expect(screen.getByText('A generic notification')).toBeInTheDocument();

    fireEvent.click(bell);
    expect(screen.queryByText('A generic notification')).not.toBeInTheDocument();
  });
});
