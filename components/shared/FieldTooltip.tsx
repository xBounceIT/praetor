import type React from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export interface FieldTooltipProps {
  description: string;
  status: string;
  statusLabel?: string;
  className?: string;
}

const TooltipIcon = () => (
  <i className="fa-solid fa-circle-question text-zinc-300 hover:text-zinc-500 text-[10px] cursor-help transition-colors" />
);

const FieldTooltip: React.FC<FieldTooltipProps> = ({
  description,
  status,
  statusLabel = 'Status:',
  className = '',
}) => {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={`inline-flex ${className}`}>
          <TooltipIcon />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">
        <div className="space-y-1">
          <div>{description}</div>
          <div className="opacity-70">
            {statusLabel} {status}
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
};

export default FieldTooltip;
