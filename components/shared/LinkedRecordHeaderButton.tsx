import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface LinkedRecordHeaderButtonProps {
  /** Already-translated button label, e.g. "View quote". */
  label: string;
  onClick: () => void;
  className?: string;
}

/**
 * Compact pill button for navigating to a linked record from a modal header.
 * Replaces the full LinkedRecordBanner when only the navigation action is needed.
 */
export function LinkedRecordHeaderButton({
  label,
  onClick,
  className,
}: LinkedRecordHeaderButtonProps) {
  return (
    <Button
      type="button"
      size="sm"
      variant="secondary"
      className={cn('rounded-full bg-background text-foreground shadow-xs', className)}
      onClick={onClick}
    >
      {label}
      <i className="fa-solid fa-arrow-right text-[10px]" aria-hidden="true"></i>
    </Button>
  );
}
