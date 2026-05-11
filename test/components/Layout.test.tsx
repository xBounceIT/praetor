import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type React from 'react';
import type { Role, User } from '../../types';
import { buildPermission } from '../../utils/permissions';
import { applyTheme, THEME_STORAGE_KEY } from '../../utils/theme';
import { installI18nMock } from '../helpers/i18n';

installI18nMock();

let isMobileViewport = false;
type MatchMediaListener = (event: MediaQueryListEvent) => void;
const mediaQueryListeners = new Map<string, Set<MatchMediaListener>>();

const getMediaMatches = (media: string) => {
  return media.includes('max-width') ? isMobileViewport : false;
};

const updateMediaQuery = (media: string) => {
  const event = { matches: getMediaMatches(media), media } as MediaQueryListEvent;
  for (const listener of mediaQueryListeners.get(media) ?? []) {
    listener(event);
  }
};

const setMobileViewport = (matches: boolean) => {
  isMobileViewport = matches;
  for (const media of mediaQueryListeners.keys()) {
    if (media.includes('max-width')) updateMediaQuery(media);
  }
};

window.matchMedia = (media: string) =>
  ({
    get matches() {
      return getMediaMatches(media);
    },
    media,
    onchange: null,
    addEventListener: (_type: string, callback: MatchMediaListener) => {
      const listeners = mediaQueryListeners.get(media) ?? new Set<MatchMediaListener>();
      listeners.add(callback);
      mediaQueryListeners.set(media, listeners);
    },
    removeEventListener: (_type: string, callback: MatchMediaListener) => {
      mediaQueryListeners.get(media)?.delete(callback);
    },
    addListener: (callback: MatchMediaListener) => {
      const listeners = mediaQueryListeners.get(media) ?? new Set<MatchMediaListener>();
      listeners.add(callback);
      mediaQueryListeners.set(media, listeners);
    },
    removeListener: (callback: MatchMediaListener) => {
      mediaQueryListeners.get(media)?.delete(callback);
    },
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
const aiReportingViewPermission = buildPermission('reports.ai_reporting', 'view');

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
    mediaQueryListeners.clear();
    setMobileViewport(false);
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

  test('desktop sidebar keeps the selected shadcn theme after a viewport remount', async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    const { container } = renderLayout();

    await waitFor(() =>
      expect(
        container
          .querySelector('[data-slot="sidebar-container"]')
          ?.getAttribute('data-shadcn-theme'),
      ).toBe('dark'),
    );

    act(() => setMobileViewport(true));
    await waitFor(() =>
      expect(container.querySelector('[data-slot="sidebar-container"]')).toBeNull(),
    );

    act(() => setMobileViewport(false));

    await waitFor(() => {
      const sidebarContainer = container.querySelector('[data-slot="sidebar-container"]');
      expect(sidebarContainer?.getAttribute('data-shadcn-theme')).toBe('dark');
      expect(sidebarContainer?.className).toContain('dark');
    });
  });

  test('sidebar navigation text uses shadcn sidebar color tokens', () => {
    const { container } = renderLayout();

    const sidebarContainer = container.querySelector('[data-slot="sidebar-container"]');
    const activeButton = container.querySelector(
      '[data-sidebar="menu-button"][data-active="true"]',
    );
    const brandButton = screen.getByText('PRAETOR').closest('[data-sidebar="menu-button"]');
    const brandLogoImage = brandButton?.querySelector('img');
    const brandLogo = brandLogoImage?.parentElement;
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
    expect(brandLogoImage?.className).toContain('size-full');
    expect(brandLogoImage?.className).toContain('object-cover');
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
    renderLayout();

    expect(screen.getByText('modules.timesheets')).toBeDefined();
    expect(screen.getByText('modules.crm')).toBeDefined();
    expect(screen.getAllByText('routes.timeTracker').length).toBeGreaterThan(0);
    expect(screen.queryByText('routes.suppliers')).toBeNull();
    expect(screen.queryByText('modules.accounting')).toBeNull();
  });

  test('all-scope client view permission exposes the CRM clients route', () => {
    renderLayout({
      currentUser: {
        ...mockUser,
        permissions: ['timesheets.tracker.view', 'crm.clients_all.view'],
      },
    });

    expect(screen.getByText('modules.crm')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'modules.crm' }));
    expect(screen.getByRole('button', { name: 'routes.clients' })).toBeDefined();
    expect(screen.queryByText('routes.suppliers')).toBeNull();
  });

  test('reports module stays visible with disabled AI reporting route when feature is off', async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    const onViewChange = mock(() => {});
    const user = userEvent.setup();
    renderLayout({
      onViewChange,
      isAiReportingEnabled: false,
      currentUser: {
        ...mockUser,
        permissions: [...(mockUser.permissions ?? []), aiReportingViewPermission],
      },
    });

    expect(screen.getByText('modules.reports')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'modules.reports' }));
    const aiReportingButton = screen.getByRole('button', { name: 'routes.aiReporting' });

    expect(aiReportingButton).toBeDisabled();

    fireEvent.click(aiReportingButton);

    expect(onViewChange).not.toHaveBeenCalled();

    await user.hover(aiReportingButton.parentElement as HTMLElement);

    expect(await screen.findAllByText('sidebar.aiReportingDisabled')).toHaveLength(2);
    const tooltipContent = document.body.querySelector('[data-slot="tooltip-content"]');
    expect(tooltipContent?.getAttribute('data-shadcn-theme')).toBe('dark');
    expect(tooltipContent?.className).toContain('dark');
    expect(tooltipContent?.className).toContain('bg-primary');
    expect(tooltipContent?.className).toContain('text-primary-foreground');
  });

  test('AI reporting route is disabled by default while feature settings are unresolved', () => {
    const onViewChange = mock(() => {});
    renderLayout({
      onViewChange,
      currentUser: {
        ...mockUser,
        permissions: [...(mockUser.permissions ?? []), aiReportingViewPermission],
      },
    });

    fireEvent.click(screen.getByRole('button', { name: 'modules.reports' }));
    const aiReportingButton = screen.getByRole('button', { name: 'routes.aiReporting' });

    expect(aiReportingButton).toBeDisabled();

    fireEvent.click(aiReportingButton);

    expect(onViewChange).not.toHaveBeenCalled();
  });

  test('AI reporting route remains clickable when feature is on', () => {
    const onViewChange = mock(() => {});
    renderLayout({
      onViewChange,
      isAiReportingEnabled: true,
      currentUser: {
        ...mockUser,
        permissions: [...(mockUser.permissions ?? []), aiReportingViewPermission],
      },
    });

    fireEvent.click(screen.getByRole('button', { name: 'modules.reports' }));
    const aiReportingButton = screen.getByRole('button', { name: 'routes.aiReporting' });

    expect(aiReportingButton).not.toBeDisabled();

    fireEvent.click(aiReportingButton);

    expect(onViewChange).toHaveBeenCalledWith('reports/ai-reporting');
  });

  test('active module expands when active view changes', () => {
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
    setMobileViewport(true);
    const onViewChange = mock(() => {});
    renderLayout({ onViewChange });

    fireEvent.click(screen.getByRole('button', { name: 'Toggle Sidebar' }));
    expect(screen.getByRole('dialog')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'routes.recurringTasks' }));

    expect(onViewChange).toHaveBeenCalledWith('timesheets/recurring');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('mobile user menu settings closes the sidebar sheet', async () => {
    setMobileViewport(true);
    const onViewChange = mock(() => {});
    const user = userEvent.setup();
    renderLayout({ onViewChange });

    fireEvent.click(screen.getByRole('button', { name: 'Toggle Sidebar' }));
    expect(screen.getByRole('dialog')).toBeDefined();

    await user.click(screen.getByRole('button', { name: 'TU Test User roles.manager' }));
    await user.click(await screen.findByRole('menuitem', { name: 'menu.settings' }));

    expect(onViewChange).toHaveBeenCalledWith('settings');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('account dropdown documentation item navigates to documentation hub', async () => {
    const onViewChange = mock(() => {});
    const user = userEvent.setup();
    renderLayout({ onViewChange });

    await user.click(screen.getByRole('button', { name: 'TU Test User roles.manager' }));
    await user.click(await screen.findByRole('menuitem', { name: 'menu.documentation' }));

    expect(onViewChange).toHaveBeenCalledWith('docs');
  });
});
