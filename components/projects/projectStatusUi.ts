import {
  Check,
  Infinity as InfinityIcon,
  type LucideIcon,
  Pause,
  Play,
  Square,
} from 'lucide-react';
import { createElement } from 'react';

import type { ProjectStatus } from '../../types';
import { LEGACY_PROJECT_STATUS, PROJECT_STATUSES } from '../../types';
import type { StatusType } from '../shared/StatusBadge';

const PROJECT_STATUS_ICONS: Record<ProjectStatus, LucideIcon> = {
  da_fare: Square,
  in_corso: Play,
  in_pausa: Pause,
  terminato: Check,
  perpetuo: InfinityIcon,
};

const FILLED_PROJECT_STATUS_ICONS = new Set<ProjectStatus>(['da_fare', 'in_corso', 'in_pausa']);

/** Shared size so select options and the status help tooltip render the same glyph weight. */
export const PROJECT_STATUS_ICON_CLASS_NAME = 'size-4 shrink-0';

const resolveProjectStatus = (status: ProjectStatus | undefined) => status ?? LEGACY_PROJECT_STATUS;

export const getProjectStatusIcon = (status: ProjectStatus | undefined, className?: string) => {
  const resolvedStatus = resolveProjectStatus(status);
  const Icon = PROJECT_STATUS_ICONS[resolvedStatus];

  return createElement(Icon, {
    'aria-hidden': true,
    className,
    // Always set fill explicitly: `undefined` overrides Lucide's default `fill="none"`
    // and lets tooltip/parent CSS paint stroke icons (check, infinity) as solid blobs.
    fill: FILLED_PROJECT_STATUS_ICONS.has(resolvedStatus) ? 'currentColor' : 'none',
  });
};

export const projectStatusOptions = PROJECT_STATUSES.map((status) => ({
  id: status,
  name: `projects:projects.statusValues.${status}`,
}));

export const translateProjectStatusOptions = (translate: (key: string) => string) =>
  PROJECT_STATUSES.map((status) => ({
    id: status,
    name: translate(`projects:projects.statusValues.${status}`),
    // Fresh element per call so trigger + list + tooltip never share one React node.
    icon: getProjectStatusIcon(status, PROJECT_STATUS_ICON_CLASS_NAME),
  }));

export const getProjectStatusBadgeType = (status: ProjectStatus | undefined): StatusType => {
  switch (resolveProjectStatus(status)) {
    case 'da_fare':
      return 'pending';
    case 'in_corso':
    case 'perpetuo':
      return 'active';
    case 'in_pausa':
      return 'disabled';
    case 'terminato':
      return 'expired';
  }
};
