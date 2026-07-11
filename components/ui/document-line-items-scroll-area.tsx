import type React from 'react';
import { cn } from '@/lib/utils';

type DocumentLineItemsScrollAreaProps = React.ComponentProps<'section'> & {
  contentClassName?: string;
  'aria-label': string;
};

const DocumentLineItemsScrollArea: React.FC<DocumentLineItemsScrollAreaProps> = ({
  'aria-label': ariaLabel,
  children,
  className,
  contentClassName,
  ...props
}) => (
  <section
    aria-label={ariaLabel}
    className={cn('w-full overflow-x-auto overscroll-x-contain pb-2', className)}
    {...props}
  >
    <div className={cn('min-w-0 lg:min-w-[76rem]', contentClassName)}>{children}</div>
  </section>
);

export default DocumentLineItemsScrollArea;
