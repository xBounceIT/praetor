import type React from 'react';
import { useState } from 'react';

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
  settingsLabel: string;
  documentationLabel: string;
  logoutLabel: string;
  switchRoleLabel: string;
  version: string;
  companyName?: string | null;
  logoUrl?: string | null;
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
  settingsLabel,
  documentationLabel,
  logoutLabel,
  switchRoleLabel,
  version,
  companyName,
  logoUrl,
  onViewChange,
  onLogout,
  onSwitchRole,
  ...props
}: AppSidebarProps) {
  // The server serves GET /api/branding/logo as a 404 ("behave as no logo") when the stored file
  // is missing on disk, but the client only has the cached logoUrl. Without a fallback the browser
  // paints its broken-image glyph, so on load failure we drop back to the bundled favicon. Tracking
  // the failed URL (rather than a boolean + reset effect) means a later logoUrl change is retried
  // automatically and a failing favicon can't loop.
  const [failedLogoUrl, setFailedLogoUrl] = useState<string | null>(null);
  const resolvedLogoUrl = logoUrl && logoUrl !== failedLogoUrl ? logoUrl : praetorFaviconUrl;
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
                  src={resolvedLogoUrl}
                  alt=""
                  className="size-full rounded-lg object-cover"
                  aria-hidden="true"
                  onError={() => {
                    if (logoUrl) setFailedLogoUrl(logoUrl);
                  }}
                />
              </div>
              <div className="grid flex-1 text-left text-sm leading-[var(--text-sm--line-height)] text-sidebar-foreground">
                <span className="truncate font-semibold italic">PRAETOR</span>
                <span className="truncate text-sm leading-[var(--text-sm--line-height)] text-sidebar-foreground/80">
                  {companyName || 'PRAETOR'}
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
          documentationLabel={documentationLabel}
          logoutLabel={logoutLabel}
          switchRoleLabel={switchRoleLabel}
          onSettings={() => onViewChange('settings')}
          onDocumentation={() => onViewChange('docs')}
          onLogout={onLogout}
          onSwitchRole={onSwitchRole}
        />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
