import { XIcon } from 'lucide-react';
import type React from 'react';
import { Button } from '@/components/ui/button';
import { DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { getShadcnThemeClassName, useResolvedShadcnTheme } from '@/components/ui/use-shadcn-theme';
import { cn } from '@/lib/utils';
import type { ResolvedTheme } from '@/utils/theme';
import { useModalTheme } from './ModalThemeContext';

const modalSizeClassName = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-2xl',
  '2xl': 'max-w-4xl',
  '6xl': 'max-w-6xl',
  // Widest tier, used by the document line-item modals (quotes/offers/orders/invoices and the
  // supplier equivalents). The cap is intentionally wide (1600px) so the dense line-item grid —
  // notably the narrow numeric columns like Costo / Costo Totale — has room to render full values
  // on large displays. `ModalContent` is `w-full` inside a `max-w-[calc(100vw-2rem)]` wrapper, so
  // it still shrinks to fit smaller viewports and never overflows the screen.
  full: 'max-w-[100rem]',
} as const;

export type ModalLayoutSize = keyof typeof modalSizeClassName;

type ModalContentProps = React.ComponentProps<'div'> & {
  children: React.ReactNode;
  size?: ModalLayoutSize;
};

function ModalContentShell({
  children,
  className,
  resolvedTheme,
  size = 'md',
  ...props
}: ModalContentProps & {
  resolvedTheme: ResolvedTheme;
}) {
  return (
    <div
      data-slot="modal-content"
      data-shadcn-theme-scope
      data-shadcn-theme={resolvedTheme}
      className={cn(
        'shadcn-theme-bridge flex max-h-[90vh] w-full flex-col overflow-hidden rounded-lg border border-border bg-background text-foreground shadow-lg animate-in zoom-in-95 duration-200',
        getShadcnThemeClassName(resolvedTheme),
        modalSizeClassName[size],
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

function ModalContentWithResolvedTheme(props: ModalContentProps) {
  const resolvedTheme = useResolvedShadcnTheme();
  return <ModalContentShell {...props} resolvedTheme={resolvedTheme} />;
}

export function ModalContent(props: ModalContentProps) {
  const resolvedTheme = useModalTheme();

  if (!resolvedTheme) {
    return <ModalContentWithResolvedTheme {...props} />;
  }

  return <ModalContentShell {...props} resolvedTheme={resolvedTheme} />;
}

export function ModalHeader({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex items-start justify-between gap-4 border-b border-border bg-muted/30 px-6 py-4',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function ModalTitle({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <DialogTitle className={cn('flex items-center gap-2 text-lg font-semibold', className)}>
      {children}
    </DialogTitle>
  );
}

export function ModalDescription({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <DialogDescription className={cn('mt-1 text-sm text-muted-foreground', className)}>
      {children}
    </DialogDescription>
  );
}

export function ModalCloseButton({
  onClick,
  className,
  disabled,
}: {
  onClick: () => void;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className={cn('shrink-0 text-muted-foreground', className)}
      onClick={onClick}
      disabled={disabled}
    >
      <XIcon className="size-4" />
      <span className="sr-only">Close</span>
    </Button>
  );
}

export function ModalBody({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn('overflow-y-auto px-6 py-5', className)}>{children}</div>;
}

export function ModalFooter({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col-reverse gap-2 border-t border-border bg-muted/30 px-6 py-4 sm:flex-row sm:justify-end',
        className,
      )}
    >
      {children}
    </div>
  );
}
