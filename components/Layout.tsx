import {
  BarChart3,
  Box,
  Building,
  Calculator,
  ClipboardList,
  Clock,
  FileSignature,
  FileText,
  Folder,
  FolderTree,
  GitFork,
  Handshake,
  ListChecks,
  ListTodo,
  type LucideIcon,
  Mail,
  PackageOpen,
  Receipt,
  Repeat,
  Settings,
  Shield,
  ShieldCheck,
  ShoppingCart,
  SlidersHorizontal,
  Sparkles,
  Truck,
  User,
  UserCheck,
  UserCog,
  Users,
} from 'lucide-react';
import type React from 'react';
import { useLayoutEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { AppSidebar } from '@/components/app-sidebar';
import type { SidebarModuleItem, SidebarRouteItem } from '@/components/nav-main';
import { Separator } from '@/components/ui/separator';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import type { Notification, User as PraetorUser, Role, View } from '../types';
import { buildPermission, hasPermission, VIEW_PERMISSION_MAP } from '../utils/permissions';
import { applyTheme, getTheme } from '../utils/theme';
import NotificationBell from './shared/NotificationBell';

interface Module {
  id: string;
  name: string;
  icon: LucideIcon;
  routes: RouteConfig[];
}

interface RouteConfig {
  view: View;
  label: string;
  icon: LucideIcon;
  title?: string;
}

const fallbackRouteTitleKey = (view: View) =>
  `routes.${view
    .split('/')
    .pop()
    ?.replace(/-([a-z])/g, (match) => match[1].toUpperCase())}`;

const getModuleFromRoute = (route: View): string => {
  if (route.startsWith('timesheets/')) return 'timesheets';
  if (route.startsWith('crm/')) return 'crm';
  if (route.startsWith('sales/')) return 'sales';
  if (route.startsWith('catalog/')) return 'catalog';
  if (route.startsWith('hr/')) return 'hr';
  if (route.startsWith('projects/')) return 'projects';
  if (route.startsWith('accounting/')) return 'accounting';
  if (route.startsWith('reports/')) return 'reports';
  if (route.startsWith('administration/')) return 'administration';
  return 'timesheets';
};

export interface LayoutProps {
  children: React.ReactNode;
  activeView: View;
  onViewChange: (view: View) => void;
  currentUser: PraetorUser;
  onLogout: () => void;
  onSwitchRole: (roleId: string) => void;
  roles: Role[];
  isNotFound?: boolean;
  isAiReportingEnabled?: boolean;
  notifications?: Notification[];
  unreadNotificationCount?: number;
  onMarkNotificationAsRead?: (id: string) => void;
  onMarkAllNotificationsAsRead?: () => void;
  onDeleteNotification?: (id: string) => void;
}

const Layout: React.FC<LayoutProps> = ({
  children,
  activeView,
  onViewChange,
  currentUser,
  onLogout,
  onSwitchRole,
  roles,
  isNotFound,
  isAiReportingEnabled = true,
  notifications = [],
  unreadNotificationCount = 0,
  onMarkNotificationAsRead,
  onMarkAllNotificationsAsRead,
  onDeleteNotification,
}) => {
  const { t, i18n } = useTranslation(['layout', 'hr']);

  useLayoutEffect(() => {
    applyTheme(getTheme());
  }, []);

  const modules: Module[] = useMemo(
    () => [
      {
        id: 'hr',
        name: t('modules.hr'),
        icon: Users,
        routes: [
          {
            view: 'hr/internal',
            label: t('routes.internalEmployees'),
            icon: UserCheck,
            title: t('titles.internalEmployees'),
          },
          {
            view: 'hr/external',
            label: t('routes.externalEmployees'),
            icon: User,
            title: t('titles.externalEmployees'),
          },
          { view: 'hr/work-units', label: t('routes.workUnits'), icon: GitFork },
        ],
      },
      {
        id: 'crm',
        name: t('modules.crm'),
        icon: Handshake,
        routes: [
          { view: 'crm/clients', label: t('routes.clients'), icon: Building },
          { view: 'crm/suppliers', label: t('routes.suppliers'), icon: Truck },
        ],
      },
      {
        id: 'catalog',
        name: t('modules.catalog'),
        icon: PackageOpen,
        routes: [
          { view: 'catalog/internal-listing', label: t('routes.internalListing'), icon: Box },
        ],
      },
      {
        id: 'sales',
        name: t('modules.sales'),
        icon: FileText,
        routes: [
          { view: 'sales/client-quotes', label: t('routes.clientQuotes'), icon: FileText },
          { view: 'sales/client-offers', label: t('routes.clientOffers'), icon: FileSignature },
          { view: 'sales/supplier-quotes', label: t('routes.supplierQuotes'), icon: FileText },
        ],
      },
      {
        id: 'accounting',
        name: t('modules.accounting'),
        icon: Calculator,
        routes: [
          {
            view: 'accounting/clients-orders',
            label: t('routes.clientsOrders'),
            icon: ShoppingCart,
          },
          {
            view: 'accounting/clients-invoices',
            label: t('routes.clientsInvoices'),
            icon: Receipt,
          },
          {
            view: 'accounting/supplier-orders',
            label: t('routes.supplierOrders'),
            icon: ShoppingCart,
          },
          {
            view: 'accounting/supplier-invoices',
            label: t('routes.supplierInvoices'),
            icon: Receipt,
          },
        ],
      },
      {
        id: 'projects',
        name: t('modules.projects'),
        icon: FolderTree,
        routes: [
          {
            view: 'projects/manage',
            label: t('routes.projects'),
            icon: Folder,
            title: t('titles.projects'),
          },
          {
            view: 'projects/tasks',
            label: t('routes.tasks'),
            icon: ListTodo,
            title: t('titles.tasks'),
          },
        ],
      },
      {
        id: 'timesheets',
        name: t('modules.timesheets'),
        icon: Clock,
        routes: [
          { view: 'timesheets/tracker', label: t('routes.timeTracker'), icon: ListChecks },
          { view: 'timesheets/recurring', label: t('routes.recurringTasks'), icon: Repeat },
        ],
      },
      {
        id: 'reports',
        name: t('modules.reports'),
        icon: BarChart3,
        routes: [{ view: 'reports/ai-reporting', label: t('routes.aiReporting'), icon: Sparkles }],
      },
      {
        id: 'administration',
        name: t('modules.administration'),
        icon: Settings,
        routes: [
          {
            view: 'administration/authentication',
            label: t('routes.authentication'),
            icon: Shield,
            title: t('titles.authSettings'),
          },
          {
            view: 'administration/general',
            label: t('routes.general'),
            icon: SlidersHorizontal,
            title: t('titles.generalAdmin'),
          },
          {
            view: 'administration/user-management',
            label: t('routes.userManagement'),
            icon: UserCog,
          },
          {
            view: 'administration/roles',
            label: t('routes.roles'),
            icon: ShieldCheck,
            title: t('titles.roles'),
          },
          { view: 'administration/email', label: t('routes.email'), icon: Mail },
          {
            view: 'administration/logs',
            label: t('routes.logs'),
            icon: ClipboardList,
            title: t('titles.logs'),
          },
        ],
      },
    ],
    [t],
  );

  const roleLabel = useMemo(() => {
    const fromAvailable = currentUser.availableRoles?.find((r) => r.id === currentUser.role);
    if (fromAvailable?.name) return fromAvailable.name;
    const role = roles.find((item) => item.id === currentUser.role);
    return (
      role?.name || t(`roles.${currentUser.role}`, { ns: 'hr', defaultValue: currentUser.role })
    );
  }, [currentUser.availableRoles, currentUser.role, roles, t]);

  const activeModuleId = getModuleFromRoute(activeView);

  const { activeRoute, navItems } = useMemo(() => {
    let matchedRoute: RouteConfig | undefined;
    const items: SidebarModuleItem[] = [];

    for (const module of modules) {
      const routes: SidebarRouteItem[] = [];

      for (const route of module.routes) {
        if (route.view === activeView) matchedRoute = route;
        if (route.view === 'reports/ai-reporting' && !isAiReportingEnabled) continue;

        const permission = VIEW_PERMISSION_MAP[route.view];
        if (!permission || !hasPermission(currentUser.permissions, permission)) continue;

        routes.push({
          title: route.label,
          view: route.view,
          icon: route.icon,
          isActive: activeView === route.view,
        });
      }

      if (routes.length > 0) {
        items.push({
          title: module.name,
          icon: module.icon,
          isActive: module.id === activeModuleId,
          items: routes,
        });
      }
    }

    return { activeRoute: matchedRoute, navItems: items };
  }, [activeModuleId, activeView, currentUser.permissions, isAiReportingEnabled, modules]);

  const canViewNotifications = hasPermission(
    currentUser.permissions,
    buildPermission('notifications', 'view'),
  );

  const pageTitle = isNotFound
    ? t('notFound')
    : (activeRoute?.title ??
      activeRoute?.label ??
      t(fallbackRouteTitleKey(activeView), {
        defaultValue: activeView.split('/').pop()?.replace('-', ' ') || activeView,
      }));

  return (
    <SidebarProvider>
      <AppSidebar
        data-shadcn-theme-scope
        navItems={navItems}
        currentUser={currentUser}
        roleLabel={roleLabel}
        roles={roles}
        navigationLabel={t('workspace')}
        workspaceLabel={t('workspace')}
        settingsLabel={t('menu.settings')}
        documentationLabel={t('menu.documentation')}
        logoutLabel={t('menu.logout')}
        switchRoleLabel={t('menu.switchRole')}
        version={import.meta.env.VITE_APP_VERSION ?? ''}
        onViewChange={onViewChange}
        onLogout={onLogout}
        onSwitchRole={onSwitchRole}
        className="z-50"
      />
      <SidebarInset
        data-shadcn-theme-scope
        className="shadcn-theme-bridge h-screen overflow-y-auto text-foreground"
      >
        <header className="sticky top-0 z-40 flex items-center justify-between border-b border-zinc-200 bg-white/80 px-4 py-4 backdrop-blur-md md:px-8">
          <div className="flex min-w-0 items-center gap-2">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
            <h2 className="truncate text-lg font-semibold capitalize text-zinc-800">{pageTitle}</h2>
          </div>
          <div className="flex items-center gap-6">
            <span className="hidden text-sm font-medium text-zinc-400 lg:inline">
              {new Date().toLocaleDateString(i18n.language, {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
              })}
            </span>

            {canViewNotifications &&
              onMarkNotificationAsRead &&
              onMarkAllNotificationsAsRead &&
              onDeleteNotification && (
                <NotificationBell
                  notifications={notifications}
                  unreadCount={unreadNotificationCount}
                  onMarkAsRead={onMarkNotificationAsRead}
                  onMarkAllAsRead={onMarkAllNotificationsAsRead}
                  onDelete={onDeleteNotification}
                />
              )}
          </div>
        </header>
        <div className="p-4 md:p-8">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
};

export default Layout;
