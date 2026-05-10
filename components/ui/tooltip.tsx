import { Tooltip as TooltipPrimitive } from 'radix-ui';
import type * as React from 'react';

import { cn } from '@/lib/utils';
import { getShadcnThemeClassName, useResolvedShadcnTheme } from './use-shadcn-theme';

function TooltipProvider({
  delayDuration = 0,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  );
}

type TooltipProps = React.ComponentProps<typeof TooltipPrimitive.Root> & {
  disabled?: boolean;
};

function Tooltip({ disabled = false, open, ...props }: TooltipProps) {
  return (
    <TooltipProvider>
      <TooltipPrimitive.Root
        key={disabled ? 'disabled' : 'enabled'}
        data-slot="tooltip"
        open={disabled ? false : open}
        {...props}
      />
    </TooltipProvider>
  );
}

function TooltipTrigger({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

function TooltipContent({
  className,
  sideOffset = 0,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  const resolvedTheme = useResolvedShadcnTheme();
  const themeClassName = getShadcnThemeClassName(resolvedTheme);

  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-shadcn-theme-scope
        data-slot="tooltip-content"
        data-shadcn-theme={resolvedTheme}
        sideOffset={sideOffset}
        className={cn(
          'z-[70] w-fit max-w-72 origin-(--radix-tooltip-content-transform-origin) animate-in whitespace-normal rounded-md bg-primary px-3 py-1.5 text-xs text-balance text-primary-foreground fade-in-0 zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
          themeClassName,
          className,
        )}
        {...props}
      >
        {children}
        <TooltipPrimitive.Arrow className="z-[70] size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-[2px] bg-primary fill-primary" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
