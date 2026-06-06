import type React from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/**
 * Per-line quick-view shortcut: opens a referenced record (supplier quote,
 * product, ...) on its own pre-filtered page in a new browser tab, so the
 * in-progress document dialog stays open and untouched.
 *
 * The button is always rendered so it reserves a stable slot in the line-item
 * grid (no jagged gaps between rows that do and don't reference a record). When
 * `href` is null there is nothing to open, so it renders disabled with the
 * `disabledLabel` tooltip instead of navigating. `aria-disabled` (not the native
 * `disabled` attribute) keeps it hoverable so the tooltip still surfaces.
 *
 * `floating` lifts the button into the field's top-right gutter (above the
 * control, consuming no inline width) on the dense desktop line-item grids, and
 * stays inline below `lg` for the stacked/mobile layouts that show a field label
 * above the control. So a single responsive cell can use the same prop as the
 * dedicated desktop blocks. The owning cell must be `position: relative` and the
 * row must reserve top room on `lg` (e.g. `pt-5` / `lg:pt-5`).
 */
const QuickViewLinkButton: React.FC<{
  href: string | null;
  label: string;
  disabledLabel: string;
  floating?: boolean;
}> = ({ href, label, disabledLabel, floating }) => {
  const positionClass = floating
    ? 'lg:absolute lg:right-1 lg:-top-1 lg:z-10 lg:h-6 lg:w-6 lg:-translate-y-full'
    : '';
  const iconClass = cn(
    'fa-solid fa-up-right-from-square',
    floating ? 'text-[11px] lg:text-[10px]' : 'text-[11px]',
  );
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {href ? (
          <Button
            asChild
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            className={cn('shrink-0 text-muted-foreground hover:text-primary', positionClass)}
          >
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={label}
              onClick={(e) => e.stopPropagation()}
            >
              <i className={iconClass} aria-hidden="true"></i>
              <span className="sr-only">{label}</span>
            </a>
          </Button>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-disabled="true"
            aria-label={disabledLabel}
            onClick={(e) => e.preventDefault()}
            className={cn(
              'shrink-0 cursor-not-allowed text-muted-foreground/40 hover:bg-transparent',
              positionClass,
            )}
          >
            <i className={iconClass} aria-hidden="true"></i>
            <span className="sr-only">{disabledLabel}</span>
          </Button>
        )}
      </TooltipTrigger>
      <TooltipContent side="top">{href ? label : disabledLabel}</TooltipContent>
    </Tooltip>
  );
};

export default QuickViewLinkButton;
