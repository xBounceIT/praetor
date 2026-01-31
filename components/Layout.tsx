import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { View, User, Notification } from '../types';
import NotificationBell from './shared/NotificationBell';

interface Module {
  id: string;
  name: string;
  icon: string;
  active: boolean;
}

// Default route for each module
const moduleDefaultRoutes: Record<string, View> = {
  timesheets: 'timesheets/tracker',
  crm: 'crm/clients',
  catalog: 'catalog/internal-listing',
  projects: 'projects/manage',
  accounting: 'accounting/clients-orders',
  finances: 'finances/payments',
  suppliers: 'suppliers/manage',
  hr: 'hr/internal-employees',
  configuration: 'configuration/authentication',
};

// Get module from route
const getModuleFromRoute = (route: View): string => {
  if (route.startsWith('timesheets/')) return 'timesheets';
  if (route.startsWith('crm/')) return 'crm';
  if (route.startsWith('catalog/')) return 'catalog';
  if (route.startsWith('hr/')) return 'hr';
  if (route.startsWith('projects/')) return 'projects';
  if (route.startsWith('accounting/')) return 'accounting';
  if (route.startsWith('finances/')) return 'finances';
  if (route.startsWith('suppliers/')) return 'suppliers';
  if (route.startsWith('configuration/')) return 'configuration';
  return 'timesheets'; // default
};

interface LayoutProps {
  children: React.ReactNode;
  activeView: View;
  onViewChange: (view: View) => void;
  currentUser: User;
  onLogout: () => void;
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
  isNotFound,
  notifications = [],
  unreadNotificationCount = 0,
  onMarkNotificationAsRead,
  onMarkAllNotificationsAsRead,
  onDeleteNotification,
}) => {
  const { t, i18n } = useTranslation(['layout', 'hr']);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  /* Removed module switcher state and refs */
  const menuRef = useRef<HTMLDivElement>(null);

  // Create modules array with localized names
  const modules: Module[] = useMemo(
    () => [
      { id: 'timesheets', name: t('modules.timesheets'), icon: 'fa-clock', active: true },
      { id: 'crm', name: t('modules.crm'), icon: 'fa-handshake', active: false },
      { id: 'catalog', name: t('modules.catalog'), icon: 'fa-box-open', active: false },
      { id: 'projects', name: t('modules.projects'), icon: 'fa-folder-tree', active: false },
      { id: 'accounting', name: t('modules.accounting'), icon: 'fa-calculator', active: false },
      { id: 'finances', name: t('modules.finances'), icon: 'fa-coins', active: false },
      { id: 'hr', name: t('modules.hr'), icon: 'fa-users-gear', active: false },
      { id: 'configuration', name: t('modules.administration'), icon: 'fa-gears', active: false },
    ],
    [t],
  ).sort((a, b) => a.name.localeCompare(b.name, i18n.language));

  // Compute active module from current route
  const activeModule = modules.find((m) => m.id === getModuleFromRoute(activeView)) || modules[0];

  // Filter modules based on user role
  const accessibleModules = modules.filter((m) => {
    // Admin only access to Configuration (Administration)
    if (m.id === 'configuration') return currentUser.role === 'admin';

    // Timesheets access for managers and users
    if (m.id === 'timesheets') return currentUser.role === 'manager' || currentUser.role === 'user';

    // Manager only access (Admin and users excluded as requested)
    if (m.id === 'crm' || m.id === 'catalog' || m.id === 'accounting' || m.id === 'finances') {
      return currentUser.role === 'manager';
    }

    // HR module: manager only access
    if (m.id === 'hr') return currentUser.role === 'manager';

    // Projects module: accessible to manager and user (read-only for user)
    if (m.id === 'projects') {
      return currentUser.role === 'manager' || currentUser.role === 'user';
    }

    return true;
  });

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsProfileMenuOpen(false);
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
        const defaultRoute = moduleDefaultRoutes[module.id];
        if (defaultRoute) {
          onViewChange(defaultRoute);
        }
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
          </>
        );
      case 'crm':
        return (
          <>
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
            <NavItem
              icon="fa-file-invoice"
              label={t('routes.quotes')}
              active={activeView === 'crm/quotes'}
              isCollapsed={isCollapsed}
              onClick={() => {
                onViewChange('crm/quotes');
                setIsMobileMenuOpen(false);
              }}
            />
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
          </>
        );
      case 'accounting':
        return (
          <>
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
          </>
        );
      case 'catalog':
        return (
          <>
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
            <NavItem
              icon="fa-tags"
              label={t('routes.externalListing')}
              active={activeView === 'catalog/external-listing'}
              isCollapsed={isCollapsed}
              onClick={() => {
                onViewChange('catalog/external-listing');
                setIsMobileMenuOpen(false);
              }}
            />
          </>
        );
      case 'hr':
        return (
          <>
            <NavItem
              icon="fa-user-tie"
              label={t('routes.internalEmployees')}
              active={activeView === 'hr/internal-employees'}
              isCollapsed={isCollapsed}
              onClick={() => {
                onViewChange('hr/internal-employees');
                setIsMobileMenuOpen(false);
              }}
            />
            <NavItem
              icon="fa-user-clock"
              label={t('routes.externalEmployees')}
              active={activeView === 'hr/external-employees'}
              isCollapsed={isCollapsed}
              onClick={() => {
                onViewChange('hr/external-employees');
                setIsMobileMenuOpen(false);
              }}
            />
          </>
        );
      case 'projects':
        return (
          <>
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
          </>
        );
      case 'finances':
        return (
          <>
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
            <NavItem
              icon="fa-chart-line"
              label={t('routes.reports')}
              active={activeView === 'finances/reports'}
              isCollapsed={isCollapsed}
              onClick={() => {
                onViewChange('finances/reports');
                setIsMobileMenuOpen(false);
              }}
            />
          </>
        );
      case 'suppliers':
        return (
          <>
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
          </>
        );
      case 'configuration':
        return (
          <>
            <NavItem
              icon="fa-shield-halved"
              label={t('routes.authentication')}
              active={activeView === 'configuration/authentication'}
              isCollapsed={isCollapsed}
              onClick={() => {
                onViewChange('configuration/authentication');
                setIsMobileMenuOpen(false);
              }}
            />

            <NavItem
              icon="fa-sliders"
              label={t('routes.general')}
              active={activeView === 'configuration/general'}
              isCollapsed={isCollapsed}
              onClick={() => {
                onViewChange('configuration/general');
                setIsMobileMenuOpen(false);
              }}
            />

            <NavItem
              icon="fa-users"
              label={t('routes.userManagement')}
              active={activeView === 'configuration/user-management'}
              isCollapsed={isCollapsed}
              onClick={() => {
                onViewChange('configuration/user-management');
                setIsMobileMenuOpen(false);
              }}
            />

            {isManagement && (
              <NavItem
                icon="fa-sitemap"
                label={t('routes.workUnits')}
                active={activeView === 'configuration/work-units'}
                isCollapsed={isCollapsed}
                onClick={() => {
                  onViewChange('configuration/work-units');
                  setIsMobileMenuOpen(false);
                }}
              />
            )}
          </>
        );
      default:
        return null;
    }
  };

  const isManagement = currentUser.role === 'admin' || currentUser.role === 'manager';

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
              {t(`roles.${currentUser.role}`, { ns: 'hr' })} {t('workspace')}
            </div>
          </div>
        )}

        <div
          className={`flex-1 px-3 space-y-1 overflow-y-auto ${isMobileMenuOpen ? 'block' : 'hidden md:block'}`}
        >
          {accessibleModules.map((module) => (
            <div key={module.id} className="space-y-1 mb-2">
              <button
                onClick={() => handleModuleSwitch(module)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 group
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

                {/* Tooltip for collapsed state */}
                {isCollapsed && (
                  <div className="absolute left-full ml-4 px-3 py-1 bg-slate-800 text-white text-xs font-bold rounded opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity whitespace-nowrap z-50 shadow-xl border border-slate-700 top-1/2 -translate-y-1/2">
                    {module.name}
                    <div className="absolute -left-1 top-1/2 -translate-y-1/2 w-2 h-2 bg-slate-800 border-l border-b border-slate-700 rotate-45"></div>
                  </div>
                )}
              </button>

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
              : activeView === 'configuration/authentication'
                ? t('titles.authSettings')
                : activeView === 'configuration/general'
                  ? t('titles.generalAdmin')
                  : activeView === 'projects/manage'
                    ? t('titles.projects')
                    : activeView === 'projects/tasks'
                      ? t('titles.tasks')
                      : activeView === 'catalog/external-listing'
                        ? t('titles.externalListing')
                        : activeView === 'suppliers/manage'
                          ? t('titles.suppliers')
                          : activeView === 'suppliers/quotes'
                            ? t('titles.supplierQuotes')
                            : activeView === 'hr/internal-employees'
                              ? t('titles.internalEmployees')
                              : activeView === 'hr/external-employees'
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

            {/* Notification Bell - only for managers */}
            {currentUser.role === 'manager' &&
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
                onClick={() => setIsProfileMenuOpen(!isProfileMenuOpen)}
                className="group flex items-center gap-3 p-1 pr-3 rounded-full bg-slate-50 border border-slate-200 hover:border-slate-300 hover:bg-white transition-all focus:outline-none"
              >
                <div className="w-8 h-8 rounded-full bg-praetor text-white flex items-center justify-center font-bold text-xs shadow-md group-hover:scale-105 transition-transform">
                  {currentUser.avatarInitials}
                </div>
                <div className="text-left hidden sm:block">
                  <p className="text-[10px] font-black text-slate-400 uppercase leading-none mb-0.5">
                    {t(`roles.${currentUser.role}`, { ns: 'hr' })}
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
                    <p className="text-xs text-slate-500 capitalize">
                      {t(`roles.${currentUser.role}`, { ns: 'hr' })}
                    </p>
                  </div>

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
        <div
          className={`p-4 md:p-8 mx-auto ${activeView === 'catalog/internal-listing' ? 'max-w-[96%]' : 'max-w-7xl'}`}
        >
          {children}
        </div>
      </main>
    </div>
  );
};

interface NavItemProps {
  icon: string;
  label: string;
  active: boolean;
  isCollapsed: boolean;
  onClick: () => void;
}

const NavItem: React.FC<NavItemProps> = ({ icon, label, active, isCollapsed, onClick }) => (
  <button
    onClick={onClick}
    className={`group relative w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 ${
      active
        ? 'bg-white/20 text-white shadow-lg shadow-black/10'
        : 'text-white/60 hover:bg-white/10 hover:text-white'
    } ${isCollapsed ? 'justify-center' : ''}`}
  >
    <i
      className={`fa-solid ${icon} w-5 text-center text-lg ${active ? 'text-white' : 'text-white/60 group-hover:text-white'}`}
    ></i>
    {!isCollapsed && (
      <span className="font-semibold text-sm whitespace-nowrap overflow-hidden">{label}</span>
    )}

    {isCollapsed && (
      <div className="absolute left-full ml-4 px-3 py-1 bg-slate-800 text-white text-xs font-bold rounded opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity whitespace-nowrap z-50 shadow-xl border border-slate-700">
        {label}
        <div className="absolute -left-1 top-1/2 -translate-y-1/2 w-2 h-2 bg-slate-800 border-l border-b border-slate-700 rotate-45"></div>
      </div>
    )}
  </button>
);

export default Layout;
