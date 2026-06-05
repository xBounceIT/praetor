import type * as React from 'react';

import { cn } from '@/lib/utils';
import { inputBaseClassName } from './inputStyles';

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        inputBaseClassName,
        'selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}

export { Input };
