import React from 'react';

type TooltipPosition = 'top' | 'right' | 'bottom' | 'left';

interface TooltipProps {
  label: React.ReactNode;
  position?: TooltipPosition;
  disabled?: boolean;
  wrapperClassName?: string;
  tooltipClassName?: string;
  children: () => React.ReactNode;
}

const positionClasses: Record<TooltipPosition, string> = {
  top: 'bottom-full mb-2 left-1/2 -translate-x-1/2',
  right: 'left-full ml-4 top-1/2 -translate-y-1/2',
  bottom: 'top-full mt-2 left-1/2 -translate-x-1/2',
  left: 'right-full mr-4 top-1/2 -translate-y-1/2',
};

const arrowClasses: Record<TooltipPosition, string> = {
  top: 'left-1/2 -translate-x-1/2 -bottom-1 border-l border-b',
  right: '-left-1 top-1/2 -translate-y-1/2 border-l border-b',
  bottom: 'left-1/2 -translate-x-1/2 -top-1 border-l border-b',
  left: '-right-1 top-1/2 -translate-y-1/2 border-r border-t',
};

const Tooltip: React.FC<TooltipProps> = ({
  label,
  position = 'top',
  disabled = false,
  wrapperClassName = '',
  tooltipClassName = '',
  children,
}) => {
  if (disabled || label === null || label === undefined || label === '') {
    return <>{children()}</>;
  }

  return (
    <div className={`relative group inline-flex ${wrapperClassName}`}>
      {children()}
      <div
        className={`absolute ${positionClasses[position]} px-3 py-1 bg-slate-800 text-white text-xs font-bold rounded opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity whitespace-nowrap z-50 shadow-xl border border-slate-700 ${tooltipClassName}`}
      >
        {label}
        <div
          className={`absolute w-2 h-2 bg-slate-800 border-slate-700 rotate-45 ${arrowClasses[position]}`}
        ></div>
      </div>
    </div>
  );
};

export default Tooltip;
