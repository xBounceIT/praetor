import type React from 'react';

import { NavMain, type SidebarModuleItem } from '@/components/nav-main';
import { NavUser } from '@/components/nav-user';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/sidebar';
import praetorFaviconUrl from '@/praetor-favicon.png';
import type { Role, User, View } from '@/types';

interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {
  navItems: SidebarModuleItem[];
  currentUser: User;
  roleLabel: string;
  roles: Role[];
  navigationLabel: string;
  workspaceLabel: string;
  settingsLabel: string;
  logoutLabel: string;
  switchRoleLabel: string;
  version: string;
  onViewChange: (view: View) => void;
  onLogout: () => void;
  onSwitchRole: (roleId: string) => void;
}

export function AppSidebar({
  navItems,
  currentUser,
  roleLabel,
  roles,
  navigationLabel,
  workspaceLabel,
  settingsLabel,
  logoutLabel,
  switchRoleLabel,
  version,
  onViewChange,
  onLogout,
  onSwitchRole,
  ...props
}: AppSidebarProps) {
  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              className="cursor-default text-sidebar-foreground hover:bg-transparent hover:text-sidebar-foreground"
            >
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg border border-sidebar-border bg-background text-sidebar-foreground">
                <img
                  src={praetorFaviconUrl}
                  alt=""
                  className="size-full rounded-lg object-cover"
                  aria-hidden="true"
                />
              </div>
              <div className="grid flex-1 text-left text-sm leading-[var(--text-sm--line-height)] text-sidebar-foreground">
                <span className="truncate font-semibold italic">PRAETOR</span>
                <span className="truncate text-sm leading-[var(--text-sm--line-height)] text-sidebar-foreground/80">
                  {roleLabel} {workspaceLabel}
                </span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={navItems} label={navigationLabel} onViewChange={onViewChange} />
      </SidebarContent>
      <SidebarFooter>
        <div className="px-2 text-sm leading-[var(--text-sm--line-height)] text-sidebar-foreground/60 group-data-[collapsible=icon]:hidden">
          Praetor v{version}
        </div>
        <NavUser
          user={currentUser}
          roleLabel={roleLabel}
          roles={roles}
          settingsLabel={settingsLabel}
          logoutLabel={logoutLabel}
          switchRoleLabel={switchRoleLabel}
          onSettings={() => onViewChange('settings')}
          onLogout={onLogout}
          onSwitchRole={onSwitchRole}
        />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
