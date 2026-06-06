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
 * `floating` lifts the button into the field's top-right gutter (above the
 * control, consuming no inline width) for the dense desktop line-item grids;
 * omit it for the inline placement used in stacked/mobile layouts. The owning
 * cell must be `position: relative` and reserve top room (e.g. `pt-5`).
 */
const QuickViewLinkButton: React.FC<{
  href: string;
  label: string;
  floating?: boolean;
}> = ({ href, label, floating }) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <Button
        asChild
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={label}
        className={cn(
          'shrink-0 text-muted-foreground hover:text-primary',
          floating && 'absolute right-1 -top-1 z-10 h-6 w-6 -translate-y-full',
        )}
      >
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={label}
          onClick={(e) => e.stopPropagation()}
        >
          <i
            className={cn(
              'fa-solid fa-up-right-from-square',
              floating ? 'text-[10px]' : 'text-[11px]',
            )}
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
