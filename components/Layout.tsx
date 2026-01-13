
import React, { useState, useEffect, useRef } from 'react';
import { View, User } from '../types';

interface Module {
  id: string;
  name: string;
  icon: string;
  active: boolean;
}

const modules: Module[] = [
  { id: 'tempo', name: 'Tempo', icon: 'fa-clock', active: true },
  { id: 'crm', name: 'CRM', icon: 'fa-handshake', active: false },
  { id: 'dipendenti', name: 'Dipendenti', icon: 'fa-user-tie', active: false },
  { id: 'fornitori', name: 'Fornitori', icon: 'fa-truck', active: false },
  { id: 'configurazione', name: 'Configurazione', icon: 'fa-gears', active: false },
];

interface LayoutProps {
  children: React.ReactNode;
  activeView: View;
  onViewChange: (view: View) => void;
  currentUser: User;
  onLogout: () => void;
  isNotFound?: boolean;
}

const Layout: React.FC<LayoutProps> = ({ children, activeView, onViewChange, currentUser, onLogout, isNotFound }) => {
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isModuleSwitcherOpen, setIsModuleSwitcherOpen] = useState(false);
  const [activeModule, setActiveModule] = useState<Module>(modules[0]);
  const menuRef = useRef<HTMLDivElement>(null);
  const moduleSwitcherRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsProfileMenuOpen(false);
      }
      if (moduleSwitcherRef.current && !moduleSwitcherRef.current.contains(event.target as Node)) {
        setIsModuleSwitcherOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleModuleSwitch = (module: Module) => {
    setActiveModule(module);
    setIsModuleSwitcherOpen(false);
    // Future: Handle navigation to different modules
    if (module.id !== 'tempo') {
      // Placeholder for future module navigation
      console.log(`Switching to module: ${module.name}`);
    }
  };

  const toggleSidebar = () => setIsCollapsed(!isCollapsed);
  const toggleMobileMenu = () => setIsMobileMenuOpen(!isMobileMenuOpen);

  const isManagement = currentUser.role === 'admin' || currentUser.role === 'manager';
  const isAdmin = currentUser.role === 'admin';

  return (
    <div className="h-screen flex flex-col md:flex-row bg-slate-50 overflow-hidden">
      <nav
        className={`bg-slate-900 text-slate-300 flex flex-col border-r border-slate-800 shrink-0 transition-all duration-300 ease-in-out relative z-30
          ${isCollapsed ? 'md:w-20' : 'md:w-64'} 
          w-full`}
      >
        <div className={`p-6 flex items-center justify-between ${isCollapsed ? 'md:justify-center' : ''}`}>
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="w-8 h-8 bg-indigo-500 rounded-lg flex items-center justify-center shrink-0 shadow-lg shadow-indigo-500/20">
              <i className="fa-solid fa-clock text-white text-lg"></i>
            </div>
            {!isCollapsed && (
              <h1 className="text-2xl font-black italic tracking-tighter text-white whitespace-nowrap animate-in fade-in slide-in-from-left-2 duration-300">
                TEMPO
              </h1>
            )}
          </div>

          <button onClick={toggleMobileMenu} className="md:hidden p-2 text-slate-400 hover:text-white">
            <i className={`fa-solid ${isMobileMenuOpen ? 'fa-xmark' : 'fa-bars'} text-xl`}></i>
          </button>

          <button
            onClick={toggleSidebar}
            className={`hidden md:flex absolute -right-3 top-12 w-6 h-6 bg-slate-800 border border-slate-700 rounded-full items-center justify-center text-slate-400 hover:text-white hover:bg-indigo-600 transition-all z-40
              ${isCollapsed ? 'rotate-180' : ''}`}
          >
            <i className="fa-solid fa-chevron-left text-[10px]"></i>
          </button>
        </div>

        {!isCollapsed && (
          <div className="px-6 mb-4 animate-in fade-in duration-300 hidden md:block">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest whitespace-nowrap">
              {currentUser.role} Workspace
            </div>
          </div>
        )}

        <div className={`flex-1 px-4 space-y-2 overflow-y-auto ${isMobileMenuOpen ? 'block' : 'hidden md:block'}`}>
          {/* Module Switcher */}
          <div className="relative mb-4" ref={moduleSwitcherRef}>
            <button
              onClick={() => setIsModuleSwitcherOpen(!isModuleSwitcherOpen)}
              className={`group w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 
                bg-slate-800/50 border border-slate-700/50 hover:bg-slate-800 hover:border-indigo-500/30
                ${isCollapsed ? 'justify-center' : ''}`}
            >
              <div className="w-8 h-8 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-lg flex items-center justify-center shrink-0 shadow-lg shadow-indigo-500/20">
                <i className="fa-solid fa-grid-2 text-white text-sm"></i>
              </div>
              {!isCollapsed && (
                <>
                  <div className="flex-1 text-left">
                    <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Modulo</div>
                    <div className="text-sm font-semibold text-white">{activeModule.name}</div>
                  </div>
                  <i className={`fa-solid fa-chevron-down text-[10px] text-slate-400 transition-transform duration-200 ${isModuleSwitcherOpen ? 'rotate-180' : ''}`}></i>
                </>
              )}
            </button>

            {isModuleSwitcherOpen && (
              <div className={`absolute z-50 mt-2 bg-slate-800 border border-slate-700 rounded-xl shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 origin-top
                ${isCollapsed ? 'left-full ml-2 top-0 w-56' : 'left-0 right-0'}`}
              >
                <div className="p-2 space-y-1">
                  {modules.map((module) => (
                    <button
                      key={module.id}
                      onClick={() => handleModuleSwitch(module)}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200
                        ${activeModule.id === module.id
                          ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-900/30'
                          : 'text-slate-300 hover:bg-slate-700 hover:text-white'}`}
                    >
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0
                        ${activeModule.id === module.id
                          ? 'bg-white/20'
                          : 'bg-slate-700'}`}
                      >
                        <i className={`fa-solid ${module.icon} text-sm`}></i>
                      </div>
                      <span className="font-medium text-sm">{module.name}</span>
                      {activeModule.id === module.id && (
                        <i className="fa-solid fa-check ml-auto text-xs"></i>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {isCollapsed && (
              <div className="absolute left-full ml-4 px-3 py-1 bg-slate-800 text-white text-xs font-bold rounded opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity whitespace-nowrap z-50 shadow-xl border border-slate-700 top-1/2 -translate-y-1/2">
                Moduli
                <div className="absolute -left-1 top-1/2 -translate-y-1/2 w-2 h-2 bg-slate-800 border-l border-b border-slate-700 rotate-45"></div>
              </div>
            )}
          </div>

          <NavItem
            icon="fa-list-check"
            label="Time Tracker"
            active={activeView === 'tracker'}
            isCollapsed={isCollapsed}
            onClick={() => { onViewChange('tracker'); setIsMobileMenuOpen(false); }}
          />

          <NavItem
            icon="fa-chart-pie"
            label="Reports"
            active={activeView === 'reports'}
            isCollapsed={isCollapsed}
            onClick={() => { onViewChange('reports'); setIsMobileMenuOpen(false); }}
          />

          {isManagement && (
            <NavItem
              icon="fa-building"
              label="Clients"
              active={activeView === 'clients'}
              isCollapsed={isCollapsed}
              onClick={() => { onViewChange('clients'); setIsMobileMenuOpen(false); }}
            />
          )}

          <NavItem
            icon="fa-folder-tree"
            label="Projects"
            active={activeView === 'projects'}
            isCollapsed={isCollapsed}
            onClick={() => { onViewChange('projects'); setIsMobileMenuOpen(false); }}
          />

          <NavItem
            icon="fa-tasks"
            label="Tasks"
            active={activeView === 'tasks'}
            isCollapsed={isCollapsed}
            onClick={() => { onViewChange('tasks'); setIsMobileMenuOpen(false); }}
          />

          {isManagement && (
            <NavItem
              icon="fa-users"
              label="Users"
              active={activeView === 'users'}
              isCollapsed={isCollapsed}
              onClick={() => { onViewChange('users'); setIsMobileMenuOpen(false); }}
            />
          )}

          <NavItem
            icon="fa-repeat"
            label="Recurring Tasks"
            active={activeView === 'recurring'}
            isCollapsed={isCollapsed}
            onClick={() => { onViewChange('recurring'); setIsMobileMenuOpen(false); }}
          />

          {isAdmin && (
            <>
              {!isCollapsed && (
                <div className="px-2 mt-6 mb-2">
                  <div className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">
                    Administration
                  </div>
                </div>
              )}
              {isCollapsed && <div className="h-4"></div>}

              <NavItem
                icon="fa-shield-halved"
                label="Authentication"
                active={activeView === 'admin-auth'}
                isCollapsed={isCollapsed}
                onClick={() => { onViewChange('admin-auth'); setIsMobileMenuOpen(false); }}
              />

              <NavItem
                icon="fa-sliders"
                label="General"
                active={activeView === 'administration-general'}
                isCollapsed={isCollapsed}
                onClick={() => { onViewChange('administration-general'); setIsMobileMenuOpen(false); }}
              />
            </>
          )}
        </div>

        <div className={`p-6 border-t border-slate-800 transition-opacity duration-300 ${isCollapsed ? 'md:opacity-0 overflow-hidden' : 'opacity-100'}`}>
          <div className="text-[10px] text-slate-500 font-medium whitespace-nowrap">
            Tempo v{import.meta.env.VITE_APP_VERSION}
          </div>
        </div>
      </nav>

      <main className="flex-1 overflow-y-auto">
        <header className="sticky top-0 z-20 bg-white/80 backdrop-blur-md border-b border-slate-200 px-8 py-4 flex justify-between items-center">
          <h2 className="text-lg font-semibold text-slate-800 capitalize flex items-center gap-3">
            <span className="md:hidden w-2 h-6 bg-indigo-500 rounded-full"></span>
            {isNotFound ? 'Page Not Found' :
              activeView === 'admin-auth' ? 'Authentication Settings' :
                activeView === 'administration-general' ? 'General Administration' :
                  activeView.replace('-', ' ')}
          </h2>
          <div className="flex items-center gap-6">
            <span className="text-sm text-slate-400 font-medium hidden lg:inline">
              {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
            </span>

            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setIsProfileMenuOpen(!isProfileMenuOpen)}
                className="group flex items-center gap-3 p-1 pr-3 rounded-full bg-slate-50 border border-slate-200 hover:border-indigo-200 hover:bg-white transition-all focus:outline-none"
              >
                <div className="w-8 h-8 rounded-full bg-indigo-600 text-white flex items-center justify-center font-bold text-xs shadow-md group-hover:scale-105 transition-transform">
                  {currentUser.avatarInitials}
                </div>
                <div className="text-left hidden sm:block">
                  <p className="text-[10px] font-black text-slate-400 uppercase leading-none mb-0.5">{currentUser.role}</p>
                  <p className="text-xs font-bold text-slate-700 leading-none">{currentUser.name}</p>
                </div>
                <i className={`fa-solid fa-chevron-down text-[10px] text-slate-300 transition-transform ${isProfileMenuOpen ? 'rotate-180' : ''}`}></i>
              </button>

              {isProfileMenuOpen && (
                <div className="absolute right-0 mt-3 w-56 bg-white rounded-2xl shadow-xl border border-slate-200 py-2 z-30 animate-in fade-in zoom-in-95 duration-200 origin-top-right">
                  <div className="px-4 py-3 border-b border-slate-100 mb-1 sm:hidden">
                    <p className="text-sm font-bold text-slate-800">{currentUser.name}</p>
                    <p className="text-xs text-slate-500 capitalize">{currentUser.role}</p>
                  </div>

                  <button
                    onClick={() => { setIsProfileMenuOpen(false); onViewChange('settings'); }}
                    className={`w-full text-left px-4 py-2.5 text-sm flex items-center gap-3 transition-colors ${activeView === 'settings' ? 'bg-indigo-50 text-indigo-600' : 'text-slate-700 hover:bg-slate-50'}`}
                  >
                    <i className="fa-solid fa-gear w-4 text-center"></i>
                    Settings
                  </button>

                  <div className="border-t border-slate-100 mt-1 pt-1">
                    <button
                      onClick={onLogout}
                      className="w-full text-left px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 flex items-center gap-3 transition-colors"
                    >
                      <i className="fa-solid fa-right-from-bracket w-4 text-center"></i>
                      Logout
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>
        <div className="p-4 md:p-8 max-w-7xl mx-auto">
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
    className={`group relative w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 ${active
      ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-900/40'
      : 'text-slate-400 hover:bg-slate-800 hover:text-white'
      } ${isCollapsed ? 'justify-center' : ''}`}
  >
    <i className={`fa-solid ${icon} w-5 text-center text-lg ${active ? 'text-white' : 'text-slate-500 group-hover:text-indigo-400'}`}></i>
    {!isCollapsed && <span className="font-semibold text-sm whitespace-nowrap overflow-hidden">{label}</span>}

    {isCollapsed && (
      <div className="absolute left-full ml-4 px-3 py-1 bg-slate-800 text-white text-xs font-bold rounded opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity whitespace-nowrap z-50 shadow-xl border border-slate-700">
        {label}
        <div className="absolute -left-1 top-1/2 -translate-y-1/2 w-2 h-2 bg-slate-800 border-l border-b border-slate-700 rotate-45"></div>
      </div>
    )}
  </button>
);

export default Layout;
