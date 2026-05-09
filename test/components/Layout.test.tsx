import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { fireEvent, render, screen } from '@testing-library/react';
import type React from 'react';
import type { Role, User } from '../../types';
import { installI18nMock } from '../helpers/i18n';

installI18nMock();

let isMobileViewport = false;

window.matchMedia = () =>
  ({
    matches: isMobileViewport,
    media: '',
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }) as MediaQueryList;

const Layout = (await import('../../components/Layout')).default;

const mockUser: User = {
  id: 'u1',
  name: 'Test User',
  role: 'manager',
  avatarInitials: 'TU',
  username: 'testuser',
  permissions: ['timesheets.tracker.view', 'timesheets.recurring.view', 'crm.clients.view'],
};

const mockRoles: Role[] = [];

const renderLayout = (props?: Partial<React.ComponentProps<typeof Layout>>) =>
  render(
    <Layout
      activeView="timesheets/tracker"
      onViewChange={() => {}}
      currentUser={mockUser}
      onLogout={() => {}}
      onSwitchRole={() => {}}
      roles={mockRoles}
      {...props}
    >
      <div>content</div>
    </Layout>,
  );

describe('<Layout />', () => {
  beforeEach(() => {
    isMobileViewport = false;
    localStorage.clear();
    document.documentElement.classList.remove('dark');
  });

  test('header sits at z-40 so it paints above the table sticky-right cells (z-20)', () => {
    const { container } = renderLayout();

    const header = container.querySelector('header');
    expect(header).not.toBeNull();
    const classes = header?.className.split(/\s+/) ?? [];
    expect(classes).toContain('z-40');
    expect(classes).not.toContain('z-20');
  });

  test('renders the shadcn sidebar shell and active menu state', () => {
    const { container } = renderLayout();

    const wrapper = container.querySelector('[data-slot="sidebar-wrapper"]');
    const sidebar = container.querySelector('[data-slot="sidebar"]');
    const shadcnThemeScope = container.querySelector('[data-shadcn-theme-scope]');
    const activeButtons = container.querySelectorAll(
      '[data-sidebar="menu-button"][data-active="true"]',
    );

    expect(wrapper).not.toBeNull();
    expect(sidebar).not.toBeNull();
    expect(shadcnThemeScope).not.toBeNull();
    expect(sidebar?.getAttribute('data-state')).toBe('expanded');
    expect(activeButtons.length).toBeGreaterThan(0);
    expect(screen.getAllByText('routes.timeTracker').length).toBeGreaterThan(0);
  });

  test('sidebar navigation text uses shadcn sidebar color tokens', () => {
    const { container } = renderLayout();

    const activeButton = container.querySelector(
      '[data-sidebar="menu-button"][data-active="true"]',
    );

    expect(activeButton?.className).toContain('text-sidebar-foreground');
    expect(activeButton?.className).toContain('data-[active=true]:text-sidebar-accent-foreground');
    expect(activeButton?.className).not.toContain('text-black');
  });

  test('account dropdown uses the scoped shadcn dark theme and sidebar text tokens', () => {
    localStorage.setItem('praetor_theme', 'dark');
    const { container } = renderLayout();

    const trigger = screen.getByRole('button', { name: 'TU Test User roles.manager' });
    fireEvent.pointerDown(trigger);

    const dropdownContent = document.body.querySelector('[data-slot="dropdown-menu-content"]');
    const dropdownIdentity = dropdownContent?.querySelector('.text-popover-foreground');
    const dropdownRole = dropdownContent?.querySelector('.text-muted-foreground');

    expect(trigger.className).toContain('text-sidebar-foreground');
    expect(dropdownContent?.className).toContain('dark');
    expect(dropdownContent?.className).not.toContain('border-zinc-200');
    expect(dropdownContent?.getAttribute('data-shadcn-theme')).toBe('dark');
    expect(dropdownIdentity).not.toBeNull();
    expect(dropdownRole).not.toBeNull();
    expect(container.ownerDocument.documentElement.classList.contains('dark')).toBe(false);
  });

  test('sidebar trigger toggles desktop icon-collapse state', () => {
    isMobileViewport = false;
    const { container } = renderLayout();

    const sidebar = container.querySelector('[data-slot="sidebar"]') as HTMLElement;
    const trigger = container.querySelector('[data-sidebar="trigger"]') as HTMLButtonElement;

    expect(sidebar).not.toBeNull();
    expect(trigger).not.toBeNull();
    expect(sidebar.getAttribute('data-state')).toBe('expanded');

    fireEvent.click(trigger);

    expect(sidebar.getAttribute('data-state')).toBe('collapsed');
    expect(sidebar.getAttribute('data-collapsible')).toBe('icon');
  });

  test('permission-filtered modules hide inaccessible routes', () => {
    isMobileViewport = false;
    renderLayout();

    expect(screen.getByText('modules.timesheets')).toBeDefined();
    expect(screen.getByText('modules.crm')).toBeDefined();
    expect(screen.getAllByText('routes.timeTracker').length).toBeGreaterThan(0);
    expect(screen.queryByText('routes.suppliers')).toBeNull();
    expect(screen.queryByText('modules.accounting')).toBeNull();
  });

  test('active module expands when active view changes', () => {
    isMobileViewport = false;
    const { rerender } = renderLayout();

    fireEvent.click(screen.getByRole('button', { name: 'modules.timesheets' }));

    rerender(
      <Layout
        activeView="crm/clients"
        onViewChange={() => {}}
        currentUser={mockUser}
        onLogout={() => {}}
        onSwitchRole={() => {}}
        roles={mockRoles}
      >
        <div>content</div>
      </Layout>,
    );

    expect(screen.getByRole('button', { name: 'modules.crm' }).getAttribute('data-state')).toBe(
      'open',
    );
  });

  test('mobile route click closes the sidebar sheet', () => {
    isMobileViewport = true;
    const onViewChange = mock(() => {});
    renderLayout({ onViewChange });

    fireEvent.click(screen.getByRole('button', { name: 'Toggle Sidebar' }));
    expect(screen.getByRole('dialog')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'routes.recurringTasks' }));

    expect(onViewChange).toHaveBeenCalledWith('timesheets/recurring');
    expect(screen.queryByRole('dialog')).toBeNull();
    isMobileViewport = false;
  });

  test('mobile user menu settings closes the sidebar sheet', () => {
    isMobileViewport = true;
    const onViewChange = mock(() => {});
    renderLayout({ onViewChange });

    fireEvent.click(screen.getByRole('button', { name: 'Toggle Sidebar' }));
    expect(screen.getByRole('dialog')).toBeDefined();

    fireEvent.pointerDown(screen.getByRole('button', { name: 'TU Test User roles.manager' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'menu.settings' }));

    expect(onViewChange).toHaveBeenCalledWith('settings');
    expect(screen.queryByRole('dialog')).toBeNull();
    isMobileViewport = false;
  });
});
