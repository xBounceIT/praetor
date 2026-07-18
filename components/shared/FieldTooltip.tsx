import type React from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export interface FieldTooltipProps {
  description: string;
  status?: string;
  statusLabel?: string;
  className?: string;
  icon?: 'info' | 'question';
}

const FieldTooltip: React.FC<FieldTooltipProps> = ({
  description,
  status,
  statusLabel = 'Status:',
  className = '',
  icon = 'question',
}) => {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={description}
          className={`size-5 cursor-help text-muted-foreground hover:text-foreground ${className}`}
        >
          <i className={`fa-solid fa-circle-${icon} text-[10px]`} aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-72">
        <div className="space-y-1">
          <div>{description}</div>
          {status && (
            <div className="opacity-70">
              {statusLabel} {status}
            </div>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
};

export default FieldTooltip;
