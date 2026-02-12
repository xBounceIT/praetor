import type React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Notification, Role, User, View } from '../types';
import { buildPermission, hasPermission, VIEW_PERMISSION_MAP } from '../utils/permissions';
import NotificationBell from './shared/NotificationBell';
import StatusBadge from './shared/StatusBadge';
import Tooltip from './shared/Tooltip';

interface Module {
  id: string;
  name: string;
  icon: string;
  active: boolean;
}

const moduleRoutes: Record<string, View[]> = {
  timesheets: ['timesheets/tracker', 'timesheets/recurring'],
  crm: ['crm/clients', 'crm/suppliers'],
  sales: ['sales/client-quotes'],
  catalog: ['catalog/internal-listing', 'catalog/external-listing', 'catalog/special-bids'],
  projects: ['projects/manage', 'projects/tasks'],
  accounting: ['accounting/clients-orders', 'accounting/clients-invoices'],
  finances: ['finances/payments', 'finances/expenses'],
  suppliers: ['suppliers/manage', 'suppliers/quotes'],
  hr: ['hr/internal', 'hr/external'],
  reports: ['reports/ai-reporting'],
  administration: [
    'administration/authentication',
    'administration/general',
    'administration/user-management',
    'administration/work-units',
    'administration/roles',
    'administration/email',
    'administration/logs',
  ],
};

// Get module from route
const getModuleFromRoute = (route: View): string => {
  if (route.startsWith('timesheets/')) return 'timesheets';
  if (route.startsWith('crm/')) return 'crm';
  if (route.startsWith('sales/')) return 'sales';
  if (route.startsWith('catalog/')) return 'catalog';
  if (route.startsWith('hr/')) return 'hr';
  if (route.startsWith('projects/')) return 'projects';
  if (route.startsWith('accounting/')) return 'accounting';
  if (route.startsWith('finances/')) return 'finances';
  if (route.startsWith('suppliers/')) return 'suppliers';
  if (route.startsWith('reports/')) return 'reports';
  if (route.startsWith('administration/')) return 'administration';
  return 'timesheets'; // default
};

export interface LayoutProps {
  children: React.ReactNode;
  activeView: View;
  onViewChange: (view: View) => void;
  currentUser: User;
  onLogout: () => void;
  onSwitchRole: (roleId: string) => void;
  roles: Role[];
  isNotFound?: boolean;
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
  notifications = [],
  unreadNotificationCount = 0,
  onMarkNotificationAsRead,
  onMarkAllNotificationsAsRead,
  onDeleteNotification,
}) => {
  const { t, i18n } = useTranslation(['layout', 'hr']);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [isRoleSubmenuOpen, setIsRoleSubmenuOpen] = useState(false);
  const roleSubmenuTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  /* Removed module switcher state and refs */
  const menuRef = useRef<HTMLDivElement>(null);

  // Create modules array with localized names
  const modules: Module[] = useMemo(
    () => [
      { id: 'timesheets', name: t('modules.timesheets'), icon: 'fa-clock', active: true },
      { id: 'crm', name: t('modules.crm'), icon: 'fa-handshake', active: false },
      { id: 'sales', name: t('modules.sales'), icon: 'fa-file-invoice-dollar', active: false },
      { id: 'catalog', name: t('modules.catalog'), icon: 'fa-box-open', active: false },
      { id: 'projects', name: t('modules.projects'), icon: 'fa-folder-tree', active: false },
      { id: 'accounting', name: t('modules.accounting'), icon: 'fa-calculator', active: false },
      { id: 'finances', name: t('modules.finances'), icon: 'fa-coins', active: false },
      { id: 'hr', name: t('modules.hr'), icon: 'fa-users-gear', active: false },
      { id: 'reports', name: t('modules.reports'), icon: 'fa-chart-simple', active: false },
      { id: 'administration', name: t('modules.administration'), icon: 'fa-gears', active: false },
    ],
    [t],
  ).sort((a, b) => a.name.localeCompare(b.name, i18n.language));

  const canAccessView = (view: View) => {
    const permission = VIEW_PERMISSION_MAP[view];
    return permission ? hasPermission(currentUser.permissions, permission) : false;
  };

  const roleLabel = useMemo(() => {
    const fromAvailable = currentUser.availableRoles?.find((r) => r.id === currentUser.role);
    if (fromAvailable?.name) return fromAvailable.name;
    const role = roles.find((item) => item.id === currentUser.role);
    return (
      role?.name || t(`roles.${currentUser.role}`, { ns: 'hr', defaultValue: currentUser.role })
    );
  }, [currentUser.availableRoles, currentUser.role, roles, t]);

  const canViewNotifications = hasPermission(
    currentUser.permissions,
    buildPermission('notifications', 'view'),
  );

  // Compute active module from current route
  const activeModule = modules.find((m) => m.id === getModuleFromRoute(activeView)) || modules[0];

  const accessibleModules = modules.filter((m) => {
    const routes = moduleRoutes[m.id] || [];
    return routes.some((route) => canAccessView(route));
  });

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsProfileMenuOpen(false);
        setIsRoleSubmenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const [expandedModuleId, setExpandedModuleId] = useState<string | null>(null);
  const [prevActiveModuleId, setPrevActiveModuleId] = useState<string | null>(null);

  // Sync expanded module with active module activeModule changes
  if (activeModule.id !== prevActiveModuleId) {
    setPrevActiveModuleId(activeModule.id);
    setExpandedModuleId(activeModule.id);
  }

  const handleModuleSwitch = (module: Module) => {
    if (expandedModuleId === module.id) {
      // Toggle collapse if clicking the already expanded module
      setExpandedModuleId(null);
    } else {
      // Expand and navigate if clicking a different module
      setExpandedModuleId(module.id);

      // Navigate to default route if we're not already in this module
      // This ensures that expanding a module also shows its content if we were elsewhere
      if (activeModule.id !== module.id) {
        const routes = moduleRoutes[module.id] || [];
        const defaultRoute = routes.find((route) => canAccessView(route)) || routes[0];
        if (defaultRoute) onViewChange(defaultRoute);
      }
    }
  };

  const toggleSidebar = () => setIsCollapsed(!isCollapsed);
  /* Removed module switcher state and refs */
  const toggleMobileMenu = () => setIsMobileMenuOpen(!isMobileMenuOpen);

  const renderModuleNavItems = (moduleId: string) => {
    switch (moduleId) {
      case 'timesheets':
        return (
          <>
            {canAccessView('timesheets/tracker') && (
              <NavItem
                icon="fa-list-check"
                label={t('routes.timeTracker')}
                active={activeView === 'timesheets/tracker'}
                isCollapsed={isCollapsed}
                onClick={() => {
                  onViewChange('timesheets/tracker');
                  setIsMobileMenuOpen(false);
                }}
              />
            )}

            {canAccessView('timesheets/recurring') && (
              <NavItem
                icon="fa-repeat"
                label={t('routes.recurringTasks')}
                active={activeView === 'timesheets/recurring'}
                isCollapsed={isCollapsed}
                onClick={() => {
                  onViewChange('timesheets/recurring');
                  setIsMobileMenuOpen(false);
                }}
              />
            )}
          </>
        );
      case 'crm':
        return (
          <>
            {canAccessView('crm/clients') && (
              <NavItem
                icon="fa-building"
                label={t('routes.clients')}
                active={activeView === 'crm/clients'}
                isCollapsed={isCollapsed}
                onClick={() => {
                  onViewChange('crm/clients');
                  setIsMobileMenuOpen(false);
                }}
              />
            )}
            {canAccessView('crm/suppliers') && (
              <NavItem
                icon="fa-truck"
                label={t('routes.suppliers')}
                active={activeView === 'crm/suppliers'}
                isCollapsed={isCollapsed}
                onClick={() => {
                  onViewChange('crm/suppliers');
                  setIsMobileMenuOpen(false);
                }}
              />
            )}
          </>
        );
      case 'sales':
        return (
          <>
            {canAccessView('sales/client-quotes') && (
              <NavItem
                icon="fa-file-invoice"
                label={t('routes.clientQuotes')}
                active={activeView === 'sales/client-quotes'}
                isCollapsed={isCollapsed}
                onClick={() => {
                  onViewChange('sales/client-quotes');
                  setIsMobileMenuOpen(false);
                }}
              />
            )}
          </>
        );
      case 'accounting':
        return (
          <>
            {canAccessView('accounting/clients-orders') && (
              <NavItem
                icon="fa-cart-shopping"
                label={t('routes.clientsOrders')}
                active={activeView === 'accounting/clients-orders'}
                isCollapsed={isCollapsed}
                onClick={() => {
                  onViewChange('accounting/clients-orders');
                  setIsMobileMenuOpen(false);
                }}
              />
            )}
            {canAccessView('accounting/clients-invoices') && (
              <NavItem
                icon="fa-file-invoice-dollar"
                label={t('routes.clientsInvoices')}
                active={activeView === 'accounting/clients-invoices'}
                isCollapsed={isCollapsed}
                onClick={() => {
                  onViewChange('accounting/clients-invoices');
                  setIsMobileMenuOpen(false);
                }}
              />
            )}
          </>
        );
      case 'catalog':
        return (
          <>
            {canAccessView('catalog/internal-listing') && (
              <NavItem
                icon="fa-box"
                label={t('routes.internalListing')}
                active={activeView === 'catalog/internal-listing'}
                isCollapsed={isCollapsed}
                onClick={() => {
                  onViewChange('catalog/internal-listing');
                  setIsMobileMenuOpen(false);
                }}
              />
            )}
            {canAccessView('catalog/external-listing') && (
              <NavItem
                icon="fa-boxes-stacked"
                label={t('routes.externalProducts')}
                active={activeView === 'catalog/external-listing'}
                isCollapsed={isCollapsed}
                onClick={() => {
                  onViewChange('catalog/external-listing');
                  setIsMobileMenuOpen(false);
                }}
              />
            )}
            {canAccessView('catalog/special-bids') && (
              <NavItem
                icon="fa-tags"
                label={t('routes.externalListing')}
                active={activeView === 'catalog/special-bids'}
                isCollapsed={isCollapsed}
                onClick={() => {
                  onViewChange('catalog/special-bids');
                  setIsMobileMenuOpen(false);
                }}
              />
            )}
          </>
        );
      case 'hr':
        return (
          <>
            {canAccessView('hr/internal') && (
              <NavItem
                icon="fa-user-tie"
                label={t('routes.internalEmployees')}
                active={activeView === 'hr/internal'}
                isCollapsed={isCollapsed}
                onClick={() => {
                  onViewChange('hr/internal');
                  setIsMobileMenuOpen(false);
                }}
              />
            )}
            {canAccessView('hr/external') && (
              <NavItem
                icon="fa-user-clock"
                label={t('routes.externalEmployees')}
                active={activeView === 'hr/external'}
                isCollapsed={isCollapsed}
                onClick={() => {
                  onViewChange('hr/external');
                  setIsMobileMenuOpen(false);
                }}
              />
            )}
          </>
        );
      case 'projects':
        return (
          <>
            {canAccessView('projects/manage') && (
              <NavItem
                icon="fa-folder-tree"
                label={t('routes.projects')}
                active={activeView === 'projects/manage'}
                isCollapsed={isCollapsed}
                onClick={() => {
                  onViewChange('projects/manage');
                  setIsMobileMenuOpen(false);
                }}
              />
            )}

            {canAccessView('projects/tasks') && (
              <NavItem
                icon="fa-tasks"
                label={t('routes.tasks')}
                active={activeView === 'projects/tasks'}
                isCollapsed={isCollapsed}
                onClick={() => {
                  onViewChange('projects/tasks');
                  setIsMobileMenuOpen(false);
                }}
              />
            )}
          </>
        );
      case 'finances':
        return (
          <>
            {canAccessView('finances/payments') && (
              <NavItem
                icon="fa-money-bill-wave"
                label={t('routes.payments')}
                active={activeView === 'finances/payments'}
                isCollapsed={isCollapsed}
                onClick={() => {
                  onViewChange('finances/payments');
                  setIsMobileMenuOpen(false);
                }}
              />
            )}
            {canAccessView('finances/expenses') && (
              <NavItem
                icon="fa-receipt"
                label={t('routes.expenses')}
                active={activeView === 'finances/expenses'}
                isCollapsed={isCollapsed}
                onClick={() => {
                  onViewChange('finances/expenses');
                  setIsMobileMenuOpen(false);
                }}
              />
            )}
          </>
        );
      case 'suppliers':
        return (
          <>
            {canAccessView('suppliers/manage') && (
              <NavItem
                icon="fa-industry"
                label={t('routes.suppliers')}
                active={activeView === 'suppliers/manage'}
                isCollapsed={isCollapsed}
                onClick={() => {
                  onViewChange('suppliers/manage');
                  setIsMobileMenuOpen(false);
                }}
              />
            )}
            {canAccessView('suppliers/quotes') && (
              <NavItem
                icon="fa-file-invoice"
                label={t('routes.supplierQuotes')}
                active={activeView === 'suppliers/quotes'}
                isCollapsed={isCollapsed}
                onClick={() => {
                  onViewChange('suppliers/quotes');
                  setIsMobileMenuOpen(false);
                }}
              />
            )}
          </>
        );
      case 'administration':
        return (
          <>
            {canAccessView('administration/authentication') && (
              <NavItem
                icon="fa-shield-halved"
                label={t('routes.authentication')}
                active={activeView === 'administration/authentication'}
                isCollapsed={isCollapsed}
                onClick={() => {
                  onViewChange('administration/authentication');
                  setIsMobileMenuOpen(false);
                }}
              />
            )}

            {canAccessView('administration/general') && (
              <NavItem
                icon="fa-sliders"
                label={t('routes.general')}
                active={activeView === 'administration/general'}
                isCollapsed={isCollapsed}
                onClick={() => {
                  onViewChange('administration/general');
                  setIsMobileMenuOpen(false);
                }}
              />
            )}

            {canAccessView('administration/user-management') && (
              <NavItem
                icon="fa-users"
                label={t('routes.userManagement')}
                active={activeView === 'administration/user-management'}
                isCollapsed={isCollapsed}
                onClick={() => {
                  onViewChange('administration/user-management');
                  setIsMobileMenuOpen(false);
                }}
              />
            )}

            {canAccessView('administration/work-units') && (
              <NavItem
                icon="fa-sitemap"
                label={t('routes.workUnits')}
                active={activeView === 'administration/work-units'}
                isCollapsed={isCollapsed}
                onClick={() => {
                  onViewChange('administration/work-units');
                  setIsMobileMenuOpen(false);
                }}
              />
            )}

            {canAccessView('administration/roles') && (
              <NavItem
                icon="fa-user-shield"
                label={t('routes.roles')}
                active={activeView === 'administration/roles'}
                isCollapsed={isCollapsed}
                onClick={() => {
                  onViewChange('administration/roles');
                  setIsMobileMenuOpen(false);
                }}
              />
            )}

            {canAccessView('administration/email') && (
              <NavItem
                icon="fa-envelope"
                label={t('routes.email')}
                active={activeView === 'administration/email'}
                isCollapsed={isCollapsed}
                onClick={() => {
                  onViewChange('administration/email');
                  setIsMobileMenuOpen(false);
                }}
              />
            )}

            {canAccessView('administration/logs') && (
              <NavItem
                icon="fa-clipboard-list"
                label={t('routes.logs')}
                active={activeView === 'administration/logs'}
                isCollapsed={isCollapsed}
                onClick={() => {
                  onViewChange('administration/logs');
                  setIsMobileMenuOpen(false);
                }}
              />
            )}
          </>
        );
      case 'reports':
        return (
          <>
            {canAccessView('reports/ai-reporting') && (
              <NavItem
                iconElement={
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    className="w-4 h-4"
                    role="img"
                    aria-label="AI sparkle"
                  >
                    <title>AI sparkle</title>
                    <path d="M12 2L13.5 8.5L20 10L13.5 11.5L12 18L10.5 11.5L4 10L10.5 8.5Z" />
                    <path d="M19 14L19.75 16.25L22 17L19.75 17.75L19 20L18.25 17.75L16 17L18.25 16.25Z" />
                    <path d="M5 2L5.5 3.5L7 4L5.5 4.5L5 6L4.5 4.5L3 4L4.5 3.5Z" />
                    <path d="M6 18L6.5 19.5L8 20L6.5 20.5L6 22L5.5 20.5L4 20L5.5 19.5Z" />
                  </svg>
                }
                label={t('routes.aiReporting')}
                active={activeView === 'reports/ai-reporting'}
                isCollapsed={isCollapsed}
                onClick={() => {
                  onViewChange('reports/ai-reporting');
                  setIsMobileMenuOpen(false);
                }}
                suffix={<StatusBadge type="experimental" label="EXPERIMENTAL" />}
              />
            )}
          </>
        );
      default:
        return null;
    }
  };

  return (
    <div className="h-screen flex flex-col md:flex-row bg-slate-50 overflow-hidden">
      <nav
        className={`bg-praetor text-white/90 flex flex-col border-r border-white/10 shrink-0 transition-all duration-300 ease-in-out relative z-30
          ${isCollapsed ? 'md:w-20' : 'md:w-64'}
          w-full`}
      >
        <div
          className={`p-6 flex items-center justify-between ${isCollapsed ? 'md:justify-center' : ''}`}
        >
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center shrink-0 shadow-lg shadow-slate-900/20">
              <i className="fa-solid fa-clock text-praetor text-lg"></i>
            </div>
            {!isCollapsed && (
              <h1 className="text-2xl font-black italic tracking-tighter text-white whitespace-nowrap animate-in fade-in slide-in-from-left-2 duration-300">
                PRAETOR
              </h1>
            )}
          </div>

          <button
            onClick={toggleMobileMenu}
            className="md:hidden p-2 text-white/70 hover:text-white"
          >
            <i className={`fa-solid ${isMobileMenuOpen ? 'fa-xmark' : 'fa-bars'} text-xl`}></i>
          </button>

          <button
            onClick={toggleSidebar}
            className={`hidden md:flex absolute -right-3 top-12 w-6 h-6 bg-praetor border border-white/20 rounded-full items-center justify-center text-white/70 hover:text-white hover:bg-praetor transition-all z-40
              ${isCollapsed ? 'rotate-180' : ''}`}
          >
            <i className="fa-solid fa-chevron-left text-[10px]"></i>
          </button>
        </div>

        {!isCollapsed && (
          <div className="px-6 mb-4 animate-in fade-in duration-300 hidden md:block">
            <div className="text-[10px] font-bold text-white/50 uppercase tracking-widest whitespace-nowrap">
              {roleLabel} {t('workspace')}
            </div>
          </div>
        )}

        <div
          className={`flex-1 px-3 space-y-1 overflow-y-auto ${isMobileMenuOpen ? 'block' : 'hidden md:block'}`}
        >
          {accessibleModules.map((module) => (
            <div key={module.id} className="space-y-1 mb-2">
              <Tooltip
                label={module.name}
                position="right"
                disabled={!isCollapsed}
                wrapperClassName="w-full"
              >
                {() => (
                  <button
                    onClick={() => handleModuleSwitch(module)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200
                      ${
                        activeModule.id === module.id
                          ? 'bg-white text-praetor shadow-lg shadow-black/10'
                          : 'text-white/60 hover:bg-white/10 hover:text-white'
                      }
                      ${isCollapsed ? 'justify-center' : ''}`}
                  >
                    <div
                      className={`flex items-center justify-center transition-colors ${activeModule.id === module.id ? 'text-praetor' : ''}`}
                    >
                      <i className={`fa-solid ${module.icon} text-lg w-6 text-center`}></i>
                    </div>

                    {!isCollapsed && (
                      <>
                        <span className="font-bold text-sm tracking-wide flex-1 text-left uppercase">
                          {module.name}
                        </span>
                        <i
                          className={`fa-solid fa-chevron-down text-[10px] transition-transform duration-200 ${expandedModuleId === module.id ? 'rotate-180' : ''}`}
                        ></i>
                      </>
                    )}
                  </button>
                )}
              </Tooltip>

              {/* Module Sub-items */}
              {expandedModuleId === module.id && !isCollapsed && (
                <div
                  className={`animate-in slide-in-from-top-2 duration-200 space-y-1 mt-1 pb-2 ${isCollapsed ? '' : 'bg-black/10 rounded-xl p-2'}`}
                >
                  {renderModuleNavItems(module.id)}
                </div>
              )}
            </div>
          ))}
        </div>

        <div
          className={`p-6 border-t border-white/10 transition-opacity duration-300 ${isCollapsed ? 'md:opacity-0 overflow-hidden' : 'opacity-100'}`}
        >
          <div className="text-[10px] text-white/40 font-medium whitespace-nowrap">
            Praetor v{import.meta.env.VITE_APP_VERSION} · {import.meta.env.VITE_BUILD_DATE}
          </div>
        </div>
      </nav>

      <main className="flex-1 overflow-y-auto">
        <header className="sticky top-0 z-20 bg-white/80 backdrop-blur-md border-b border-slate-200 px-8 py-4 flex justify-between items-center">
          <h2 className="text-lg font-semibold text-slate-800 capitalize flex items-center gap-3">
            <span className="md:hidden w-2 h-6 bg-praetor rounded-full"></span>
            {isNotFound
              ? t('notFound')
              : activeView === 'administration/authentication'
                ? t('titles.authSettings')
                : activeView === 'administration/general'
                  ? t('titles.generalAdmin')
                  : activeView === 'administration/roles'
                    ? t('titles.roles')
                    : activeView === 'administration/logs'
                      ? t('titles.logs')
                      : activeView === 'projects/manage'
                        ? t('titles.projects')
                        : activeView === 'projects/tasks'
                          ? t('titles.tasks')
                          : activeView === 'catalog/external-listing'
                            ? t('titles.externalProducts')
                            : activeView === 'catalog/special-bids'
                              ? t('titles.externalListing')
                              : activeView === 'suppliers/manage'
                                ? t('titles.suppliers')
                                : activeView === 'suppliers/quotes'
                                  ? t('titles.supplierQuotes')
                                  : activeView === 'hr/internal'
                                    ? t('titles.internalEmployees')
                                    : activeView === 'hr/external'
                                      ? t('titles.externalEmployees')
                                      : t(
                                          `routes.${activeView
                                            .split('/')
                                            .pop()
                                            ?.replace(/-([a-z])/g, (g) => g[1].toUpperCase())}`,
                                          {
                                            defaultValue:
                                              activeView.split('/').pop()?.replace('-', ' ') ||
                                              activeView,
                                          },
                                        )}
          </h2>
          <div className="flex items-center gap-6">
            <span className="text-sm text-slate-400 font-medium hidden lg:inline">
              {new Date().toLocaleDateString(i18n.language, {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
              })}
            </span>

            {/* Notification Bell */}
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

            <div className="relative" ref={menuRef}>
              <button
                onClick={() => {
                  setIsProfileMenuOpen(!isProfileMenuOpen);
                  setIsRoleSubmenuOpen(false);
                }}
                className="group flex items-center gap-3 p-1 pr-3 rounded-full bg-slate-50 border border-slate-200 hover:border-slate-300 hover:bg-white transition-all focus:outline-none"
              >
                <div className="w-8 h-8 rounded-full bg-praetor text-white flex items-center justify-center font-bold text-xs shadow-md group-hover:scale-105 transition-transform">
                  {currentUser.avatarInitials}
                </div>
                <div className="text-left hidden sm:block">
                  <p className="text-[10px] font-black text-slate-400 uppercase leading-none mb-0.5">
                    {roleLabel}
                  </p>
                  <p className="text-xs font-bold text-slate-700 leading-none">
                    {currentUser.name}
                  </p>
                </div>
                <i
                  className={`fa-solid fa-chevron-down text-[10px] text-slate-300 transition-transform ${isProfileMenuOpen ? 'rotate-180' : ''}`}
                ></i>
              </button>

              {isProfileMenuOpen && (
                <div className="absolute right-0 mt-3 w-56 bg-white rounded-2xl shadow-xl border border-slate-200 py-2 z-30 animate-in fade-in zoom-in-95 duration-200 origin-top-right">
                  <div className="px-4 py-3 border-b border-slate-100 mb-1 sm:hidden">
                    <p className="text-sm font-bold text-slate-800">{currentUser.name}</p>
                    <p className="text-xs text-slate-500 capitalize">{roleLabel}</p>
                  </div>

                  {!!currentUser.availableRoles && currentUser.availableRoles.length > 1 && (
                    <div
                      className="relative"
                      onMouseEnter={() => {
                        if (roleSubmenuTimeout.current) clearTimeout(roleSubmenuTimeout.current);
                        setIsRoleSubmenuOpen(true);
                      }}
                      onMouseLeave={() => {
                        roleSubmenuTimeout.current = setTimeout(
                          () => setIsRoleSubmenuOpen(false),
                          150,
                        );
                      }}
                    >
                      <button
                        className={`w-full text-left px-4 py-2.5 text-sm flex items-center gap-3 transition-colors ${isRoleSubmenuOpen ? 'bg-slate-50' : 'text-slate-700 hover:bg-slate-50'}`}
                      >
                        <i className="fa-solid fa-id-badge w-4 text-center"></i>
                        <span className="flex-1">{t('menu.switchRole')}</span>
                        <i className="fa-solid fa-chevron-left text-[10px] text-slate-400"></i>
                      </button>
                      {isRoleSubmenuOpen && (
                        <div className="absolute right-full top-0 mr-2 w-48 bg-white rounded-2xl shadow-xl border border-slate-200 py-2 animate-in fade-in zoom-in-95 duration-200 origin-top-right">
                          {currentUser.availableRoles.map((r) => {
                            const isActive = r.id === currentUser.role;
                            return (
                              <button
                                key={r.id}
                                onClick={() => {
                                  if (isActive) return;
                                  setIsRoleSubmenuOpen(false);
                                  setIsProfileMenuOpen(false);
                                  onSwitchRole(r.id);
                                }}
                                className={`w-full text-left px-4 py-2.5 text-sm flex items-center justify-between gap-2 transition-colors ${
                                  isActive
                                    ? 'bg-slate-100 text-praetor'
                                    : 'text-slate-700 hover:bg-slate-50 cursor-pointer'
                                }`}
                                disabled={isActive}
                              >
                                <span className="font-semibold truncate">{r.name}</span>
                                {isActive && (
                                  <i className="fa-solid fa-check text-[12px] text-praetor"></i>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  <button
                    onClick={() => {
                      setIsProfileMenuOpen(false);
                      onViewChange('settings');
                    }}
                    className={`w-full text-left px-4 py-2.5 text-sm flex items-center gap-3 transition-colors ${activeView === 'settings' ? 'bg-slate-100 text-praetor' : 'text-slate-700 hover:bg-slate-50'}`}
                  >
                    <i className="fa-solid fa-gear w-4 text-center"></i>
                    {t('menu.settings')}
                  </button>

                  <div className="border-t border-slate-100 mt-1 pt-1">
                    <button
                      onClick={onLogout}
                      className="w-full text-left px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 flex items-center gap-3 transition-colors"
                    >
                      <i className="fa-solid fa-right-from-bracket w-4 text-center"></i>
                      {t('menu.logout')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>
        <div className="p-4 md:p-8 mx-auto max-w-7xl">{children}</div>
      </main>
    </div>
  );
};

interface NavItemProps {
  icon?: string;
  iconElement?: React.ReactNode;
  label: string;
  active: boolean;
  isCollapsed: boolean;
  onClick: () => void;
  suffix?: React.ReactNode;
}

const NavItem: React.FC<NavItemProps> = ({
  icon,
  iconElement,
  label,
  active,
  isCollapsed,
  onClick,
  suffix,
}) => (
  <Tooltip label={label} position="right" disabled={!isCollapsed} wrapperClassName="w-full">
    {() => (
      <button
        onClick={onClick}
        className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 ${
          active
            ? 'bg-white/20 text-white shadow-lg shadow-black/10'
            : 'text-white/60 hover:bg-white/10 hover:text-white'
        } ${isCollapsed ? 'justify-center' : ''}`}
      >
        {iconElement ? (
          <span
            className={`w-5 text-center text-lg flex items-center justify-center ${active ? 'text-white' : 'text-white/60 group-hover:text-white'}`}
          >
            {iconElement}
          </span>
        ) : (
          <i
            className={`fa-solid ${icon} w-5 text-center text-lg ${active ? 'text-white' : 'text-white/60 group-hover:text-white'}`}
          ></i>
        )}
        {!isCollapsed && (
          <>
            <span className="font-semibold text-sm whitespace-nowrap overflow-hidden">{label}</span>
            {suffix}
          </>
        )}
      </button>
    )}
  </Tooltip>
);

export default Layout;
