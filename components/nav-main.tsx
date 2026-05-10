import { ChevronRight, type LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';

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
import type { View } from '@/types';

export interface SidebarRouteItem {
  title: string;
  view: View;
  icon: LucideIcon;
  isActive: boolean;
  disabled?: boolean;
}

export interface SidebarModuleItem {
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
  const [openItems, setOpenItems] = useState(
    () => new Set(items.filter((item) => item.isActive).map((item) => item.title)),
  );

  useEffect(() => {
    setOpenItems((current) => {
      const next = new Set(current);
      for (const item of items) {
        if (item.isActive) next.add(item.title);
      }
      return next;
    });
  }, [items]);

  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarMenu>
        {items.map((item) => (
          <Collapsible
            key={item.title}
            asChild
            open={openItems.has(item.title)}
            onOpenChange={(isOpen) => {
              setOpenItems((current) => {
                const next = new Set(current);
                if (isOpen) {
                  next.add(item.title);
                } else {
                  next.delete(item.title);
                }
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
                  {item.items.map((subItem) => (
                    <SidebarMenuSubItem key={subItem.view}>
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
                    </SidebarMenuSubItem>
                  ))}
                </SidebarMenuSub>
              </CollapsibleContent>
            </SidebarMenuItem>
          </Collapsible>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  );
}
