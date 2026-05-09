import { Check, ChevronsUpDown, LogOut, Settings, ShieldCheck } from 'lucide-react';

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
  logoutLabel: string;
  switchRoleLabel: string;
  onSettings: () => void;
  onLogout: () => void;
  onSwitchRole: (roleId: string) => void;
}

interface UserIdentityBlockProps {
  user: User;
  roleLabel: string;
}

function UserIdentityBlock({ user, roleLabel }: UserIdentityBlockProps) {
  return (
    <>
      <Avatar className="h-8 w-8 rounded-lg">
        <AvatarFallback className="rounded-lg bg-praetor text-xs font-semibold text-white">
          {user.avatarInitials}
        </AvatarFallback>
      </Avatar>
      <div className="grid flex-1 text-left text-sm leading-tight">
        <span className="truncate font-medium">{user.name}</span>
        <span className="truncate text-xs">{roleLabel}</span>
      </div>
    </>
  );
}

export function NavUser({
  user,
  roleLabel,
  roles,
  settingsLabel,
  logoutLabel,
  switchRoleLabel,
  onSettings,
  onLogout,
  onSwitchRole,
}: NavUserProps) {
  const { isMobile } = useSidebar();
  const availableRoles = user.availableRoles ?? roles;
  const canSwitchRole = availableRoles.length > 1;

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <UserIdentityBlock user={user} roleLabel={roleLabel} />
              <ChevronsUpDown className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="profile-menu-content w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side={isMobile ? 'bottom' : 'right'}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <UserIdentityBlock user={user} roleLabel={roleLabel} />
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
                            if (!isActive) onSwitchRole(role.id);
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
              <DropdownMenuItem onSelect={onSettings}>
                <Settings />
                <span>{settingsLabel}</span>
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={onLogout}>
              <LogOut />
              <span>{logoutLabel}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
