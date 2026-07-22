import { RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export function ModalRestoreToDraftButton({
  label,
  tooltip,
  disabled,
  onClick,
  testId,
}: {
  label: string;
  tooltip: string;
  disabled: boolean;
  onClick: () => void;
  testId: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            data-testid={testId}
            data-skip-initial-focus
            aria-label={label}
            onClick={() => {
              if (disabled) return;
              onClick();
            }}
            className="gap-1.5"
          >
            <RotateCcw className="size-3.5" aria-hidden="true" />
            {label}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}
