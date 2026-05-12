import { Label as LabelPrimitive, Slot } from 'radix-ui';
import type * as React from 'react';

import { cn } from '@/lib/utils';

function Field({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="field"
      className={cn('group/field flex flex-col gap-2', className)}
      {...props}
    />
  );
}

function FieldGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="field-group"
      className={cn('grid gap-4 @container/field-group', className)}
      {...props}
    />
  );
}

function FieldLabel({
  className,
  asChild = false,
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root> & {
  asChild?: boolean;
}) {
  const Comp = asChild ? Slot.Root : LabelPrimitive.Root;

  return (
    <Comp
      data-slot="field-label"
      className={cn(
        'flex w-fit items-center gap-2 text-sm leading-none font-medium select-none group-data-[disabled=true]/field:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
        'group-data-[invalid=true]/field:text-destructive',
        className,
      )}
      {...props}
    />
  );
}

function FieldDescription({ className, ...props }: React.ComponentProps<'p'>) {
  return (
    <p
      data-slot="field-description"
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  );
}

function FieldError({
  className,
  children,
  errors,
  ...props
}: React.ComponentProps<'div'> & {
  errors?: Array<{ message?: string } | undefined>;
}) {
  const body = errors?.length
    ? errors
        .map((error) => error?.message)
        .filter(Boolean)
        .join(', ')
    : children;

  if (!body) return null;

  return (
    <div
      data-slot="field-error"
      className={cn('text-sm font-medium text-destructive', className)}
      {...props}
    >
      {body}
    </div>
  );
}

function FieldSet({ className, ...props }: React.ComponentProps<'fieldset'>) {
  return (
    <fieldset data-slot="field-set" className={cn('flex flex-col gap-4', className)} {...props} />
  );
}

function FieldLegend({
  className,
  variant = 'legend',
  ...props
}: React.ComponentProps<'legend'> & {
  variant?: 'legend' | 'label';
}) {
  return (
    <legend
      data-slot="field-legend"
      data-variant={variant}
      className={cn(
        variant === 'legend' ? 'text-base font-medium' : 'text-sm leading-none font-medium',
        className,
      )}
      {...props}
    />
  );
}

function FieldContent({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="field-content"
      className={cn('flex flex-1 flex-col gap-1.5', className)}
      {...props}
    />
  );
}

function FieldTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="field-title"
      className={cn('text-sm leading-none font-medium', className)}
      {...props}
    />
  );
}

function FieldSeparator({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="field-separator"
      className={cn('h-px w-full bg-border', className)}
      {...props}
    />
  );
}

export {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
  FieldTitle,
};
