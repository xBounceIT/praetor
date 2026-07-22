import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface LinkedRecordHeaderButtonProps {
  /** Already-translated button label, e.g. "View quote". */
  label: string;
  onClick: () => void;
  className?: string;
}

/**
 * Compact header action for navigating to a linked record from a modal header.
 * Uses the standard shadcn outline button styling (`rounded-md`) used elsewhere in the app.
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
      variant="outline"
      className={className}
      data-skip-initial-focus
      onClick={onClick}
    >
      {label}
      <ArrowRight className="size-3.5" aria-hidden="true" />
    </Button>
  );
}
