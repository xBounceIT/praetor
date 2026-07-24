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
