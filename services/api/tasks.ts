import type { ProjectTask } from '../../types';
import { fetchApi } from './client';
import { normalizeTask } from './normalizers';

/** Must stay in sync with `GET /tasks/hours/batch` (`projectIds cannot exceed 200 IDs`). */
export const HOURS_BATCH_MAX_PROJECT_IDS = 200;

const chunkProjectIds = (projectIds: string[], size: number): string[][] => {
  const chunks: string[][] = [];
  for (let i = 0; i < projectIds.length; i += size) {
    chunks.push(projectIds.slice(i, i + size));
  }
  return chunks;
};

const fetchHoursChunk = (projectIds: string[], signal?: AbortSignal) =>
  fetchApi<Record<string, Record<string, number>>>(
    `/tasks/hours/batch?projectIds=${projectIds.map(encodeURIComponent).join(',')}`,
    { signal },
  );

export const tasksApi = {
  list: (): Promise<ProjectTask[]> =>
    fetchApi<ProjectTask[]>('/tasks').then((tasks) => tasks.map(normalizeTask)),

  create: (
    name: string,
    projectId: string,
    description?: string,
    isRecurring?: boolean,
    recurrencePattern?: string,
    revenue?: number,
    notes?: string,
    monthlyEffort?: number,
    billingType?: ProjectTask['billingType'],
    billingFrequency?: ProjectTask['billingFrequency'],
    duration?: number,
  ): Promise<ProjectTask> =>
    fetchApi<ProjectTask>('/tasks', {
      method: 'POST',
      body: JSON.stringify({
        name,
        projectId,
        description,
        isRecurring,
        recurrencePattern,
        revenue,
        notes,
        monthlyEffort,
        billingType,
        billingFrequency,
        duration,
      }),
    }).then(normalizeTask),

  update: (id: string, updates: Partial<ProjectTask>): Promise<ProjectTask> =>
    fetchApi<ProjectTask>(`/tasks/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    }).then(normalizeTask),

  delete: (id: string): Promise<void> => fetchApi(`/tasks/${id}`, { method: 'DELETE' }),

  /** Totals keyed by stable task id (not task name). */
  getHours: (projectId: string, signal?: AbortSignal): Promise<Record<string, number>> =>
    fetchApi(`/tasks/hours?projectId=${encodeURIComponent(projectId)}`, { signal }),

  /**
   * Per-project maps of totals keyed by stable task id (not task name).
   * Automatically chunks requests to stay within the backend's 200-ID batch limit.
   * On partial chunk failure, merges successful chunks and only throws when every chunk fails.
   */
  getHoursForProjects: async (
    projectIds: string[],
    signal?: AbortSignal,
  ): Promise<Record<string, Record<string, number>>> => {
    if (projectIds.length === 0) return {};

    const chunks = chunkProjectIds(projectIds, HOURS_BATCH_MAX_PROJECT_IDS);
    const settled = await Promise.allSettled(
      chunks.map((chunk) => fetchHoursChunk(chunk, signal)),
    );

    const merged: Record<string, Record<string, number>> = {};
    let successCount = 0;
    let firstError: unknown;

    for (const result of settled) {
      if (result.status === 'fulfilled') {
        successCount += 1;
        Object.assign(merged, result.value);
        continue;
      }
      if (signal?.aborted) throw result.reason;
      firstError ??= result.reason;
    }

    if (successCount === 0) {
      throw firstError instanceof Error
        ? firstError
        : new Error('Failed to load task hours for projects');
    }

    if (firstError) {
      console.warn(
        'Partial failure loading task hours; returning data from successful batches only',
        firstError,
      );
    }

    return merged;
  },

  getUsers: (id: string, signal?: AbortSignal): Promise<string[]> =>
    fetchApi(`/tasks/${id}/users`, { signal }),

  updateUsers: (id: string, userIds: string[]): Promise<void> =>
    fetchApi(`/tasks/${id}/users`, {
      method: 'POST',
      body: JSON.stringify({ userIds }),
    }),
};
