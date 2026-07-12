import { ChevronRight, type LucideIcon } from 'lucide-react';
import { useState } from 'react';

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from '@/components/ui/sidebar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { View } from '@/types';

export interface SidebarRouteItem {
  title: string;
  view: View;
  icon: LucideIcon;
  isActive: boolean;
  disabled?: boolean;
  disabledTooltip?: string;
}

export interface SidebarModuleItem {
  id: string;
  title: string;
  icon: LucideIcon;
  isActive: boolean;
  items: SidebarRouteItem[];
}

interface NavMainProps {
  items: SidebarModuleItem[];
  label: string;
  onViewChange: (view: View) => void;
}

export function NavMain({ items, label, onViewChange }: NavMainProps) {
  const { isMobile, setOpenMobile } = useSidebar();
  const [openOverrides, setOpenOverrides] = useState(() => new Map<string, boolean>());

  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarMenu>
        {items.map((item) => (
          <Collapsible
            key={item.id}
            asChild
            open={openOverrides.get(item.id) ?? item.isActive}
            onOpenChange={(isOpen) => {
              setOpenOverrides((current) => {
                const next = new Map(current);
                next.set(item.id, isOpen);
                return next;
              });
            }}
            className="group/collapsible"
          >
            <SidebarMenuItem>
              <CollapsibleTrigger asChild>
                <SidebarMenuButton
                  tooltip={item.title}
                  isActive={item.isActive}
                  className="font-normal! text-sidebar-foreground hover:text-sidebar-accent-foreground data-[active=true]:font-normal! data-[active=true]:text-sidebar-accent-foreground [&_span]:font-normal! [&>svg]:text-sidebar-foreground/70"
                >
                  <item.icon />
                  <span>{item.title}</span>
                  <ChevronRight className="ml-auto transition-transform duration-150 group-data-[state=open]/collapsible:rotate-90" />
                </SidebarMenuButton>
              </CollapsibleTrigger>
              <CollapsibleContent className="sidebar-entry-content">
                <SidebarMenuSub className="py-1">
                  {item.items.map((subItem) => {
                    const routeButton = (
                      <SidebarMenuSubButton
                        asChild
                        isActive={subItem.isActive}
                        className="font-normal! text-sidebar-foreground hover:text-sidebar-accent-foreground data-[active=true]:font-normal! data-[active=true]:text-sidebar-accent-foreground [&_span]:font-normal! [&>svg]:text-sidebar-foreground/70"
                      >
                        <button
                          type="button"
                          disabled={subItem.disabled}
                          onClick={() => {
                            onViewChange(subItem.view);
                            if (isMobile) setOpenMobile(false);
                          }}
                          className="w-full text-left"
                        >
                          <subItem.icon />
                          <span>{subItem.title}</span>
                        </button>
                      </SidebarMenuSubButton>
                    );

                    return (
                      <SidebarMenuSubItem key={subItem.view}>
                        {subItem.disabled && subItem.disabledTooltip ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="block">{routeButton}</span>
                            </TooltipTrigger>
                            <TooltipContent side="right">{subItem.disabledTooltip}</TooltipContent>
                          </Tooltip>
                        ) : (
                          routeButton
                        )}
                      </SidebarMenuSubItem>
                    );
                  })}
                </SidebarMenuSub>
              </CollapsibleContent>
            </SidebarMenuItem>
          </Collapsible>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  );
}
