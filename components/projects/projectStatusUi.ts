import type { ProjectStatus } from '../../types';
import { LEGACY_PROJECT_STATUS, PROJECT_STATUSES } from '../../types';
import type { StatusType } from '../shared/StatusBadge';

export const projectStatusOptions = PROJECT_STATUSES.map((status) => ({
  id: status,
  name: `projects:projects.statusValues.${status}`,
}));

export const getProjectStatusBadgeType = (status: ProjectStatus | undefined): StatusType => {
  switch (status ?? LEGACY_PROJECT_STATUS) {
    case 'da_fare':
      return 'pending';
    case 'in_corso':
      return 'active';
    case 'in_pausa':
      return 'disabled';
    case 'terminato':
      return 'expired';
  }
};
