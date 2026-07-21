import type React from 'react';
import { cn } from '@/lib/utils';

export function ModalReadOnlyStatusBanner({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'inline-flex w-fit max-w-full shrink-0 items-center rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1',
        className,
      )}
    >
      <span className="truncate text-xs font-medium text-amber-700 dark:text-amber-300">
        {children}
      </span>
    </div>
  );
}
