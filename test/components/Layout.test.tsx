import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type React from 'react';
import type { Role, User } from '../../types';
import { applyTheme, THEME_STORAGE_KEY } from '../../utils/theme';
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

  test('main content is scoped to the selected shadcn theme', async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    const { container } = renderLayout();

    const main = container.querySelector('[data-slot="sidebar-inset"]');
    expect(main?.hasAttribute('data-shadcn-theme-scope')).toBe(true);
    expect(main?.className).toContain('shadcn-theme-bridge');
    expect(main?.className).toContain('text-foreground');
    await waitFor(() => expect(main?.getAttribute('data-shadcn-theme')).toBe('dark'));
  });

  test('sidebar navigation text uses shadcn sidebar color tokens', () => {
    const { container } = renderLayout();

    const sidebarContainer = container.querySelector('[data-slot="sidebar-container"]');
    const activeButton = container.querySelector(
      '[data-sidebar="menu-button"][data-active="true"]',
    );
    const brandButton = screen.getByText('PRAETOR').closest('[data-sidebar="menu-button"]');
    const brandLogo = brandButton?.querySelector('svg')?.parentElement;
    const brandSubtitle = screen.getByText('roles.manager workspace');
    const avatarFallback = screen.getByText('TU');

    expect(sidebarContainer?.className).toContain('border-sidebar-border');
    expect(sidebarContainer?.className).not.toContain('border-zinc-200');
    expect(activeButton?.className).toContain('text-sidebar-foreground');
    expect(activeButton?.className).toContain('data-[active=true]:text-sidebar-accent-foreground');
    expect(activeButton?.className).not.toContain('text-black');
    expect(brandButton?.className).toContain('text-sidebar-foreground');
    expect(brandButton?.className).toContain('hover:text-sidebar-foreground');
    expect(brandLogo?.className).toContain('text-sidebar-foreground');
    expect(brandLogo?.className).not.toContain('text-white');
    expect(brandLogo?.className).not.toContain('bg-praetor');
    expect(brandSubtitle.className).toContain('text-sm');
    expect(brandSubtitle.className).toContain('leading-[var(--text-sm--line-height)]');
    expect(brandSubtitle.className).toContain('text-sidebar-foreground/80');
    expect(avatarFallback.className).toContain('text-sm');
    expect(avatarFallback.className).toContain('leading-[var(--text-sm--line-height)]');
    expect(avatarFallback.className).toContain('text-sidebar-foreground');
    expect(avatarFallback.className).not.toContain('text-white');
  });

  test('account dropdown uses the scoped shadcn dark theme and sidebar text tokens', async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    const user = userEvent.setup();
    const { container } = renderLayout();

    const trigger = screen.getByRole('button', { name: 'TU Test User roles.manager' });
    await user.click(trigger);
    await screen.findByRole('menu');

    const dropdownContent = document.body.querySelector('[data-slot="dropdown-menu-content"]');
    const dropdownIdentity = dropdownContent?.querySelector('.text-popover-foreground');
    const dropdownRole = dropdownContent?.querySelector('.text-muted-foreground');

    expect(trigger.className).toContain('text-sidebar-foreground');
    expect(dropdownContent?.className).toContain('dark');
    expect(dropdownContent?.className).not.toContain('border-zinc-200');
    expect(dropdownContent?.className).toContain('border-border');
    expect(dropdownContent?.getAttribute('data-shadcn-theme')).toBe('dark');
    expect(dropdownIdentity).not.toBeNull();
    expect(dropdownRole).not.toBeNull();
    expect(container.ownerDocument.documentElement.classList.contains('dark')).toBe(false);
  });

  test('open account dropdown updates when shadcn theme changes', async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    const user = userEvent.setup();
    renderLayout();

    const trigger = screen.getByRole('button', { name: 'TU Test User roles.manager' });
    await user.click(trigger);
    await screen.findByRole('menu');

    const dropdownContent = document.body.querySelector('[data-slot="dropdown-menu-content"]');
    expect(dropdownContent?.getAttribute('data-shadcn-theme')).toBe('light');
    expect(dropdownContent?.className).not.toContain('dark');

    act(() => {
      applyTheme('dark');
    });

    await waitFor(() => expect(dropdownContent?.getAttribute('data-shadcn-theme')).toBe('dark'));
    expect(dropdownContent?.className).toContain('dark');
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

  test('mobile user menu settings closes the sidebar sheet', async () => {
    isMobileViewport = true;
    const onViewChange = mock(() => {});
    const user = userEvent.setup();
    renderLayout({ onViewChange });

    fireEvent.click(screen.getByRole('button', { name: 'Toggle Sidebar' }));
    expect(screen.getByRole('dialog')).toBeDefined();

    await user.click(screen.getByRole('button', { name: 'TU Test User roles.manager' }));
    await user.click(await screen.findByRole('menuitem', { name: 'menu.settings' }));

    expect(onViewChange).toHaveBeenCalledWith('settings');
    expect(screen.queryByRole('dialog')).toBeNull();
    isMobileViewport = false;
  });

  test('account dropdown documentation item navigates to frontend docs', async () => {
    const onViewChange = mock(() => {});
    const user = userEvent.setup();
    renderLayout({ onViewChange });

    await user.click(screen.getByRole('button', { name: 'TU Test User roles.manager' }));
    await user.click(await screen.findByRole('menuitem', { name: 'menu.documentation' }));

    expect(onViewChange).toHaveBeenCalledWith('docs/frontend');
  });
});
