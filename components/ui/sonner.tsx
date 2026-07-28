import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import type * as React from 'react';
import { Toaster as Sonner, type ToasterProps } from 'sonner';
import { cn } from '@/lib/utils';
import { resolveSonnerTheme } from './sonner-presets';
import { getShadcnThemeClassName, useResolvedShadcnTheme } from './use-shadcn-theme';

const Toaster = ({ className, theme, ...props }: ToasterProps) => {
  const resolvedTheme = useResolvedShadcnTheme();
  const themeClassName = getShadcnThemeClassName(resolvedTheme);

  return (
    <div
      data-shadcn-theme-scope=""
      data-shadcn-theme={resolvedTheme}
      className={cn('shadcn-theme-bridge', themeClassName)}
    >
      <Sonner
        theme={resolveSonnerTheme(resolvedTheme, theme)}
        className={cn('toaster group', className)}
        icons={{
          success: <CircleCheckIcon className="size-4" />,
          info: <InfoIcon className="size-4" />,
          warning: <TriangleAlertIcon className="size-4" />,
          error: <OctagonXIcon className="size-4" />,
          loading: <Loader2Icon className="size-4 animate-spin" />,
        }}
        style={
          {
            '--normal-bg': 'var(--popover)',
            '--normal-text': 'var(--popover-foreground)',
            '--normal-border': 'var(--border)',
            '--border-radius': 'var(--radius)',
          } as React.CSSProperties
        }
        {...props}
      />
    </div>
  );
};

export { Toaster };
