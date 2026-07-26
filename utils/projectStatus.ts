import type { ProjectStatus, ProjectTipo } from '../types';
import { isDateOnlyBeforeToday } from './date';

export const isProjectStatusExemptFromExpiry = (
  status: ProjectStatus | null | undefined,
): boolean => status === 'perpetuo';

export const isProjectExpiredForTimeEntries = (project: {
  endDate?: string | null;
  status?: ProjectStatus | null;
}): boolean => {
  if (isProjectStatusExemptFromExpiry(project.status)) return false;
  return !!project.endDate && isDateOnlyBeforeToday(project.endDate);
};

export const isProjectStatusBlockingTimeEntries = (
  status: ProjectStatus | null | undefined,
): boolean => status === 'in_pausa' || status === 'terminato';

export const isProjectEndDateRequired = ({
  tipo,
  status,
}: {
  tipo: ProjectTipo | '' | null | undefined;
  status: ProjectStatus | null | undefined;
}): boolean => tipo !== 'interno' && status !== 'perpetuo';

export const isProjectStartDateRequired = ({
  tipo,
}: {
  tipo: ProjectTipo | '' | null | undefined;
}): boolean => tipo !== 'interno';
