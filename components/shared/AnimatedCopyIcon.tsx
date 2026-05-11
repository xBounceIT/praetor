import { Check, Copy } from 'lucide-react';

import { cn } from '@/lib/utils';

interface AnimatedCopyIconProps {
  copied: boolean;
  className?: string;
  copiedClassName?: string;
}

const iconTransition =
  'absolute inset-0 h-full w-full transition-[opacity,transform] duration-200 ease-out';

const visibleState = 'scale-100 rotate-0 opacity-100';
const hiddenCopyState = 'scale-75 -rotate-12 opacity-0';
const hiddenCheckState = 'scale-75 rotate-12 opacity-0';

export const AnimatedCopyIcon = ({ copied, className, copiedClassName }: AnimatedCopyIconProps) => (
  <span className={cn('relative inline-flex size-4 shrink-0', className)} aria-hidden="true">
    <Copy
      data-copy-feedback-icon="copy"
      data-visible={!copied}
      className={cn(iconTransition, copied ? hiddenCopyState : visibleState)}
    />
    <Check
      data-copy-feedback-icon="check"
      data-visible={copied}
      className={cn(iconTransition, copied ? visibleState : hiddenCheckState, copiedClassName)}
    />
  </span>
);
