import { todayLocalDateOnly } from './date.ts';
import type { ProjectTipo } from './projectTipo.ts';

export const PROJECT_STATUSES = [
  'da_fare',
  'in_corso',
  'in_pausa',
  'terminato',
  'perpetuo',
] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const DEFAULT_PROJECT_STATUS: ProjectStatus = 'da_fare';
export const LEGACY_PROJECT_STATUS: ProjectStatus = 'in_corso';

const PROJECT_TIME_ENTRY_BLOCKING_STATUSES = new Set<ProjectStatus>(['in_pausa', 'terminato']);

export const isProjectStatus = (value: unknown): value is ProjectStatus =>
  typeof value === 'string' && (PROJECT_STATUSES as readonly string[]).includes(value);

export const normalizeProjectStatus = (
  value: unknown,
  fallback: ProjectStatus = DEFAULT_PROJECT_STATUS,
): ProjectStatus => (isProjectStatus(value) ? value : fallback);

export const isProjectStatusBlockingTimeEntries = (
  status: ProjectStatus | null | undefined,
): boolean => (status ? PROJECT_TIME_ENTRY_BLOCKING_STATUSES.has(status) : false);

export const isProjectStatusExemptFromExpiry = (
  status: ProjectStatus | null | undefined,
): boolean => status === 'perpetuo';

export const isProjectExpiredForTimeEntries = (
  project: {
    endDate?: string | null;
    status?: ProjectStatus | null;
  },
  referenceDate = todayLocalDateOnly(),
): boolean => {
  if (isProjectStatusExemptFromExpiry(project.status)) return false;
  return !!project.endDate && project.endDate < referenceDate;
};

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
