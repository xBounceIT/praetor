import { cva, type VariantProps } from 'class-variance-authority';
import type * as React from 'react';

import { cn } from '@/lib/utils';

const alertVariants = cva(
  'relative w-full rounded-md border px-4 py-3 text-sm flex items-start gap-3',
  {
    variants: {
      variant: {
        default: 'bg-card text-card-foreground',
        destructive:
          'border-destructive/30 bg-destructive/10 text-destructive dark:text-destructive [&_[data-slot=alert-description]]:text-destructive/90',
        warning:
          'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300 [&_[data-slot=alert-description]]:text-amber-700/90 dark:[&_[data-slot=alert-description]]:text-amber-300/90',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  );
}

function AlertIcon({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot="alert-icon"
      aria-hidden="true"
      className={cn(
        'inline-flex shrink-0 items-center justify-center self-start pt-0.5 text-base leading-none text-current',
        className,
      )}
      {...props}
    />
  );
}

function AlertContent({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-content"
      className={cn('flex min-w-0 flex-1 flex-col gap-1', className)}
      {...props}
    />
  );
}

function AlertTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-title"
      className={cn('min-w-0 flex-1 font-medium tracking-tight', className)}
      {...props}
    />
  );
}

function AlertDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div data-slot="alert-description" className={cn('min-w-0 text-sm', className)} {...props} />
  );
}

function AlertAction({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-action"
      className={cn('ml-auto flex shrink-0 items-center gap-2 self-center', className)}
      {...props}
    />
  );
}

export { Alert, AlertAction, AlertContent, AlertDescription, AlertIcon, AlertTitle };
