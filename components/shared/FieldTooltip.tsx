import type React from 'react';
import Tooltip from './Tooltip';

export interface FieldTooltipProps {
  description: string;
  status: string;
  statusLabel?: string;
  className?: string;
}

const FieldTooltip: React.FC<FieldTooltipProps> = ({
  description,
  status,
  statusLabel = 'Status:',
  className = '',
}) => {
  return (
    <Tooltip
      label={
        <div className="space-y-1">
          <div>{description}</div>
          <div className="opacity-70">
            {statusLabel} {status}
          </div>
        </div>
      }
      position="top"
      tooltipClassName="whitespace-normal max-w-56"
      wrapperClassName={className}
    >
      {() => (
        <i className="fa-solid fa-circle-question text-slate-300 hover:text-slate-500 text-[10px] cursor-help transition-colors" />
      )}
    </Tooltip>
  );
};

export default FieldTooltip;
