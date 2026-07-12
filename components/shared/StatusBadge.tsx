import type React from 'react';
import { siOpenid } from 'simple-icons';

export type StatusType =
  | 'active'
  | 'disabled'
  | 'inherited'
  | 'expired'
  | 'pending'
  | 'draft'
  | 'sent'
  | 'offer'
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
  | 'role_user'
  | 'auth_local'
  | 'auth_ldap'
  | 'auth_oidc'
  | 'auth_saml';

export interface StatusBadgeProps {
  type: StatusType;
  label: string;
  className?: string;
}

const STATUS_BADGE_STYLES: Record<
  StatusType,
  { container: string; icon: string; svgPath?: string }
> = {
  active: {
    container:
      'bg-emerald-50 text-emerald-600 border-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900',
    icon: 'fa-check',
  },
  disabled: {
    container:
      'bg-zinc-50 text-zinc-400 border-zinc-100 dark:bg-zinc-800/60 dark:text-zinc-300 dark:border-zinc-700',
    icon: 'fa-ban',
  },
  inherited: {
    container:
      'bg-zinc-50 text-zinc-500 border-zinc-100 dark:bg-zinc-800/60 dark:text-zinc-300 dark:border-zinc-700',
    icon: 'fa-triangle-exclamation',
  },
  expired: {
    container:
      'bg-red-50 text-red-600 border-red-100 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900',
    icon: 'fa-clock',
  },
  pending: {
    container:
      'bg-amber-50 text-amber-500 border-amber-100 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900',
    icon: 'fa-hourglass-half',
  },
  draft: {
    container:
      'bg-amber-50 text-amber-700 border-amber-100 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900',
    icon: 'fa-file-lines',
  },
  sent: {
    container:
      'bg-blue-50 text-blue-700 border-blue-100 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900',
    icon: 'fa-paper-plane',
  },
  offer: {
    container:
      'bg-indigo-50 text-indigo-700 border-indigo-100 dark:bg-indigo-950/40 dark:text-indigo-300 dark:border-indigo-900',
    icon: 'fa-file-signature',
  },
  accepted: {
    container:
      'bg-emerald-50 text-emerald-700 border-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900',
    icon: 'fa-check-double',
  },
  denied: {
    container:
      'bg-red-50 text-red-700 border-red-100 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900',
    icon: 'fa-xmark',
  },
  confirmed: {
    container:
      'bg-emerald-50 text-emerald-700 border-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900',
    icon: 'fa-circle-check',
  },
  paid: {
    container:
      'bg-emerald-50 text-emerald-700 border-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900',
    icon: 'fa-circle-check',
  },
  overdue: {
    container:
      'bg-red-50 text-red-700 border-red-100 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900',
    icon: 'fa-clock',
  },
  cancelled: {
    container:
      'bg-zinc-50 text-zinc-500 border-zinc-100 dark:bg-zinc-800/60 dark:text-zinc-300 dark:border-zinc-700',
    icon: 'fa-ban',
  },
  supply: {
    container:
      'bg-emerald-50 text-emerald-600 border-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900',
    icon: 'fa-box-archive',
  },
  service: {
    container:
      'bg-blue-50 text-blue-600 border-blue-100 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900',
    icon: 'fa-gears',
  },
  consulting: {
    container:
      'bg-purple-50 text-purple-600 border-purple-100 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-900',
    icon: 'fa-user-tie',
  },
  item: {
    container:
      'bg-amber-50 text-amber-600 border-amber-100 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900',
    icon: 'fa-cube',
  },
  internal: {
    container:
      'bg-emerald-50 text-emerald-700 border-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900',
    icon: 'fa-user-tie',
  },
  external: {
    container:
      'bg-amber-50 text-amber-700 border-amber-100 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900',
    icon: 'fa-user-clock',
  },
  app_user: {
    container:
      'bg-blue-50 text-blue-700 border-blue-100 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900',
    icon: 'fa-user',
  },
  experimental: {
    container:
      'bg-purple-50 text-purple-600 border-purple-100 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-900',
    icon: 'fa-flask',
  },
  company: {
    container:
      'bg-blue-50 text-blue-600 border-blue-100 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900',
    icon: 'fa-building',
  },
  individual: {
    container:
      'bg-amber-50 text-amber-600 border-amber-100 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900',
    icon: 'fa-user',
  },
  office: {
    container:
      'bg-blue-50 text-blue-600 border-blue-100 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900',
    icon: 'fa-building',
  },
  customer_premise: {
    container:
      'bg-amber-50 text-amber-600 border-amber-100 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900',
    icon: 'fa-building-user',
  },
  remote: {
    container:
      'bg-purple-50 text-purple-600 border-purple-100 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-900',
    icon: 'fa-laptop-house',
  },
  transfer: {
    container:
      'bg-teal-50 text-teal-600 border-teal-100 dark:bg-teal-950/40 dark:text-teal-300 dark:border-teal-900',
    icon: 'fa-car',
  },
  recurrence: {
    container:
      'bg-zinc-50 text-praetor border-zinc-200 dark:bg-zinc-800/60 dark:text-zinc-100 dark:border-zinc-700',
    icon: 'fa-repeat',
  },
  role_admin: {
    container:
      'bg-zinc-800 text-white border-zinc-700 dark:bg-zinc-700 dark:text-zinc-100 dark:border-zinc-600',
    icon: 'fa-shield-halved',
  },
  role_top_manager: {
    container:
      'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900',
    icon: 'fa-crown',
  },
  role_manager: {
    container:
      'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900',
    icon: 'fa-briefcase',
  },
  role_custom: {
    container:
      'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900',
    icon: 'fa-user',
  },
  role_user: {
    container:
      'bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-zinc-800/60 dark:text-zinc-300 dark:border-zinc-700',
    icon: 'fa-user',
  },
  auth_local: {
    container:
      'bg-zinc-100 text-zinc-700 border-zinc-200 dark:bg-zinc-800/60 dark:text-zinc-300 dark:border-zinc-700',
    icon: 'fa-database',
  },
  auth_ldap: {
    container:
      'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900',
    icon: 'fa-sitemap',
  },
  auth_oidc: {
    container:
      'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-900',
    icon: 'fa-id-card',
    svgPath: siOpenid.path,
  },
  auth_saml: {
    container:
      'bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-950/40 dark:text-teal-300 dark:border-teal-900',
    icon: 'fa-building-shield',
  },
};

const StatusBadge: React.FC<StatusBadgeProps> = ({ type, label, className = '' }) => {
  const currentStyle = STATUS_BADGE_STYLES[type];

  return (
    <span
      data-status-badge
      className={`inline-flex items-center gap-[0.6em] rounded-[0.8em] border px-[1em] py-[0.4em] text-[10px] font-black uppercase tracking-wider transition-all duration-200 ${currentStyle.container} ${className}`}
    >
      {currentStyle.svgPath ? (
        <svg
          aria-hidden="true"
          role="img"
          viewBox="0 0 24 24"
          fill="currentColor"
          className="size-[1em]"
        >
          <path d={currentStyle.svgPath} />
        </svg>
      ) : (
        <i className={`fa-solid ${currentStyle.icon}`}></i>
      )}
      {label}
    </span>
  );
};

export default StatusBadge;
