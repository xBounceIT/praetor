import type React from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/**
 * Per-line quick-view shortcut: opens a referenced record (supplier quote,
 * product, ...) on its own pre-filtered page in a new browser tab, so the
 * in-progress document dialog stays open and untouched. Render it only when the
 * row actually references a record (i.e. the caller resolved a non-null href).
 *
 * `className` / `iconClassName` let each call site restyle/reposition the button
 * (e.g. float it above a field's top-right corner) without forking the markup.
 */
const QuickViewLinkButton: React.FC<{
  href: string;
  label: string;
  className?: string;
  iconClassName?: string;
}> = ({ href, label, className, iconClassName }) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <Button
        asChild
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={label}
        className={cn('shrink-0 text-muted-foreground hover:text-primary', className)}
      >
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={label}
          onClick={(e) => e.stopPropagation()}
        >
          <i
            className={cn('fa-solid fa-up-right-from-square text-[11px]', iconClassName)}
            aria-hidden="true"
          ></i>
          <span className="sr-only">{label}</span>
        </a>
      </Button>
    </TooltipTrigger>
    <TooltipContent side="top">{label}</TooltipContent>
  </Tooltip>
);

export default QuickViewLinkButton;
