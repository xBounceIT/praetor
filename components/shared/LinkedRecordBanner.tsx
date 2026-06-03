import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface LinkedRecordBannerAction {
  /** Already-translated button label, e.g. "View quote". */
  label: string;
  onClick: () => void;
}

export interface LinkedRecordBannerProps {
  /**
   * Already-translated eyebrow/relationship label, e.g. "Source quote" or
   * "Linked order". Rendered uppercase.
   */
  label: string;
  /** The linked record reference, e.g. "Q0001" or "Offer #O0001". */
  value: ReactNode;
  /** Optional secondary hint, e.g. "(Order details are read-only)". */
  note?: ReactNode;
  /** FontAwesome icon suffix for the leading badge. Defaults to `fa-link`. */
  icon?: string;
  /** Primary action button. Omit to render the banner without an action. */
  action?: LinkedRecordBannerAction;
  className?: string;
}

/**
 * Banner that surfaces a record linked to the one being edited (the source
 * quote of an offer, the order behind a task, etc.) alongside a primary action
 * to navigate to it. Standardises the previously hand-rolled banners that had
 * drifted across the sales/accounting/projects dialogs.
 */
export function LinkedRecordBanner({
  label,
  value,
  note,
  icon = 'fa-link',
  action,
  className,
}: LinkedRecordBannerProps) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-3 rounded-md border border-border bg-muted/30 p-4',
        className,
      )}
    >
      <div className="flex items-center gap-3">
        <div className="flex size-9 items-center justify-center rounded-md border border-border bg-background text-primary">
          <i className={cn('fa-solid text-sm', icon)} aria-hidden="true"></i>
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
            {label}
          </p>
          <p className="text-sm font-semibold text-foreground">{value}</p>
          {note ? <p className="mt-0.5 text-[10px] text-muted-foreground">{note}</p> : null}
        </div>
      </div>
      {action ? (
        <Button type="button" size="sm" onClick={action.onClick}>
          {action.label}
          <i className="fa-solid fa-arrow-right text-[10px]" aria-hidden="true"></i>
        </Button>
      ) : null}
    </div>
  );
}
