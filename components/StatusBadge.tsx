import React from 'react';

export type StatusType = 'active' | 'disabled' | 'inherited';

interface StatusBadgeProps {
  type: StatusType;
  label: string;
  className?: string;
}

const StatusBadge: React.FC<StatusBadgeProps> = ({ type, label, className = '' }) => {
  const styles = {
    active: {
      container: 'bg-emerald-50 text-emerald-600 border-emerald-100',
      icon: 'fa-check',
    },
    disabled: {
      container: 'bg-slate-50 text-slate-400 border-slate-100',
      icon: 'fa-ban',
    },
    inherited: {
      container: 'bg-slate-50 text-slate-500 border-slate-100',
      icon: 'fa-triangle-exclamation',
    },
  };

  const currentStyle = styles[type];

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[10px] font-black uppercase tracking-wider transition-all duration-200 ${currentStyle.container} ${className}`}
    >
      <i className={`fa-solid ${currentStyle.icon}`}></i>
      {label}
    </span>
  );
};

export default StatusBadge;
