import type React from 'react';

export type StatusType =
  | 'active'
  | 'disabled'
  | 'inherited'
  | 'expired'
  | 'pending'
  | 'draft'
  | 'sent'
  | 'accepted'
  | 'denied'
  | 'confirmed'
  | 'paid'
  | 'overdue'
  | 'cancelled'
  | 'supply'
  | 'service'
  | 'consulting'
  | 'item'
  | 'internal'
  | 'external'
  | 'app_user'
  | 'experimental'
  | 'company'
  | 'individual'
  | 'office'
  | 'customer_premise'
  | 'remote'
  | 'transfer'
  | 'recurrence'
  | 'role_admin'
  | 'role_top_manager'
  | 'role_manager'
  | 'role_custom'
  | 'role_user';

export interface StatusBadgeProps {
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
      container: 'bg-zinc-50 text-zinc-400 border-zinc-100',
      icon: 'fa-ban',
    },
    inherited: {
      container: 'bg-zinc-50 text-zinc-500 border-zinc-100',
      icon: 'fa-triangle-exclamation',
    },
    expired: {
      container: 'bg-red-50 text-red-600 border-red-100',
      icon: 'fa-clock',
    },
    pending: {
      container: 'bg-amber-50 text-amber-500 border-amber-100',
      icon: 'fa-hourglass-half',
    },
    draft: {
      container: 'bg-amber-50 text-amber-700 border-amber-100',
      icon: 'fa-file-lines',
    },
    sent: {
      container: 'bg-blue-50 text-blue-700 border-blue-100',
      icon: 'fa-paper-plane',
    },
    accepted: {
      container: 'bg-emerald-50 text-emerald-700 border-emerald-100',
      icon: 'fa-check-double',
    },
    denied: {
      container: 'bg-red-50 text-red-700 border-red-100',
      icon: 'fa-xmark',
    },
    confirmed: {
      container: 'bg-emerald-50 text-emerald-700 border-emerald-100',
      icon: 'fa-circle-check',
    },
    paid: {
      container: 'bg-emerald-50 text-emerald-700 border-emerald-100',
      icon: 'fa-circle-check',
    },
    overdue: {
      container: 'bg-red-50 text-red-700 border-red-100',
      icon: 'fa-clock',
    },
    cancelled: {
      container: 'bg-zinc-50 text-zinc-500 border-zinc-100',
      icon: 'fa-ban',
    },
    supply: {
      container: 'bg-emerald-50 text-emerald-600 border-emerald-100',
      icon: 'fa-box-archive',
    },
    service: {
      container: 'bg-blue-50 text-blue-600 border-blue-100',
      icon: 'fa-gears',
    },
    consulting: {
      container: 'bg-purple-50 text-purple-600 border-purple-100',
      icon: 'fa-user-tie',
    },
    item: {
      container: 'bg-amber-50 text-amber-600 border-amber-100',
      icon: 'fa-cube',
    },
    internal: {
      container: 'bg-emerald-50 text-emerald-700 border-emerald-100',
      icon: 'fa-user-tie',
    },
    external: {
      container: 'bg-amber-50 text-amber-700 border-amber-100',
      icon: 'fa-user-clock',
    },
    app_user: {
      container: 'bg-blue-50 text-blue-700 border-blue-100',
      icon: 'fa-user',
    },
    experimental: {
      container: 'bg-purple-50 text-purple-600 border-purple-100',
      icon: 'fa-flask',
    },
    company: {
      container: 'bg-blue-50 text-blue-600 border-blue-100',
      icon: 'fa-building',
    },
    individual: {
      container: 'bg-amber-50 text-amber-600 border-amber-100',
      icon: 'fa-user',
    },
    office: {
      container: 'bg-blue-50 text-blue-600 border-blue-100',
      icon: 'fa-building',
    },
    customer_premise: {
      container: 'bg-amber-50 text-amber-600 border-amber-100',
      icon: 'fa-building-user',
    },
    remote: {
      container: 'bg-purple-50 text-purple-600 border-purple-100',
      icon: 'fa-laptop-house',
    },
    transfer: {
      container: 'bg-teal-50 text-teal-600 border-teal-100',
      icon: 'fa-car',
    },
    recurrence: {
      container: 'bg-zinc-50 text-praetor border-zinc-200',
      icon: 'fa-repeat',
    },
    role_admin: {
      container: 'bg-zinc-800 text-white border-zinc-700',
      icon: 'fa-shield-halved',
    },
    role_top_manager: {
      container: 'bg-amber-50 text-amber-700 border-amber-200',
      icon: 'fa-crown',
    },
    role_manager: {
      container: 'bg-blue-50 text-blue-700 border-blue-200',
      icon: 'fa-briefcase',
    },
    role_custom: {
      container: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      icon: 'fa-user',
    },
    role_user: {
      container: 'bg-zinc-100 text-zinc-600 border-zinc-200',
      icon: 'fa-user',
    },
  };

  const currentStyle = styles[type];

  return (
    <span
      data-status-badge
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[10px] font-black uppercase tracking-wider transition-all duration-200 ${currentStyle.container} ${className}`}
    >
      <i className={`fa-solid ${currentStyle.icon}`}></i>
      {label}
    </span>
  );
};

export default StatusBadge;
