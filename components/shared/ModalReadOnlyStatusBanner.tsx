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
        'flex items-center gap-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-2.5',
        className,
      )}
    >
      <span className="text-xs font-medium text-amber-700 dark:text-amber-300">{children}</span>
    </div>
  );
}
