import { BookOpen, Check, ChevronsUpDown, LogOut, Settings, ShieldCheck } from 'lucide-react';

import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar';
import type { Role, User } from '@/types';

interface NavUserProps {
  user: User;
  roleLabel: string;
  roles: Role[];
  settingsLabel: string;
  documentationLabel: string;
  logoutLabel: string;
  switchRoleLabel: string;
  onSettings: () => void;
  onDocumentation: () => void;
  onLogout: () => void;
  onSwitchRole: (roleId: string) => void;
}

interface UserIdentityBlockProps {
  user: User;
  roleLabel: string;
  context?: 'sidebar' | 'popover';
}

function UserIdentityBlock({ user, roleLabel, context = 'sidebar' }: UserIdentityBlockProps) {
  const isPopover = context === 'popover';

  return (
    <>
      <Avatar className="h-8 w-8 rounded-lg">
        <AvatarFallback className="rounded-lg bg-sidebar-accent text-sm leading-[var(--text-sm--line-height)] font-semibold text-sidebar-foreground">
          {user.avatarInitials}
        </AvatarFallback>
      </Avatar>
      <div
        className={`grid flex-1 text-left text-sm leading-[var(--text-sm--line-height)] ${
          isPopover
            ? 'text-popover-foreground'
            : 'text-sidebar-foreground group-data-[state=open]/menu-button:text-sidebar-accent-foreground'
        }`}
      >
        <span className="truncate font-medium">{user.name}</span>
        <span
          className={`truncate text-sm leading-[var(--text-sm--line-height)] ${
            isPopover
              ? 'text-muted-foreground'
              : 'text-sidebar-foreground/80 group-data-[state=open]/menu-button:text-sidebar-accent-foreground/80'
          }`}
        >
          {roleLabel}
        </span>
      </div>
    </>
  );
}

export function NavUser({
  user,
  roleLabel,
  roles,
  settingsLabel,
  documentationLabel,
  logoutLabel,
  switchRoleLabel,
  onSettings,
  onDocumentation,
  onLogout,
  onSwitchRole,
}: NavUserProps) {
  const { isMobile, setOpenMobile } = useSidebar();
  const availableRoles = user.availableRoles ?? roles;
  const canSwitchRole = availableRoles.length > 1;
  const closeMobileSidebar = () => {
    if (isMobile) setOpenMobile(false);
  };

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="group/menu-button text-sidebar-foreground focus-visible:ring-0 focus-visible:ring-offset-0 data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground [&>svg]:text-sidebar-foreground/70 data-[state=open]:[&>svg]:text-sidebar-accent-foreground/70"
            >
              <UserIdentityBlock user={user} roleLabel={roleLabel} />
              <ChevronsUpDown className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg border border-border outline-none"
            side={isMobile ? 'bottom' : 'right'}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm leading-[var(--text-sm--line-height)]">
                <UserIdentityBlock user={user} roleLabel={roleLabel} context="popover" />
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              {canSwitchRole && (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <ShieldCheck />
                    <span>{switchRoleLabel}</span>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="min-w-48">
                    {availableRoles.map((role) => {
                      const isActive = role.id === user.role;
                      return (
                        <DropdownMenuItem
                          key={role.id}
                          disabled={isActive}
                          onSelect={() => {
                            if (isActive) return;
                            onSwitchRole(role.id);
                            closeMobileSidebar();
                          }}
                        >
                          <span className="truncate">{role.name}</span>
                          {isActive && <Check className="ml-auto" />}
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              )}
              <DropdownMenuItem
                onSelect={() => {
                  onSettings();
                  closeMobileSidebar();
                }}
              >
                <Settings />
                <span>{settingsLabel}</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  onDocumentation();
                  closeMobileSidebar();
                }}
              >
                <BookOpen />
                <span>{documentationLabel}</span>
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => {
                onLogout();
                closeMobileSidebar();
              }}
            >
              <LogOut />
              <span>{logoutLabel}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
