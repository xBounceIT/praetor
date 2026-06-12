import type React from 'react';
import api from '../../services/api';
import type { ProjectTask, TimeEntry } from '../../types';
import { getLocalDateString } from '../../utils/date';

export type TaskHandlersDeps = {
  projectTasks: ProjectTask[];
  setProjectTasks: React.Dispatch<React.SetStateAction<ProjectTask[]>>;
  setEntries: React.Dispatch<React.SetStateAction<TimeEntry[]>>;
  generateRecurringEntries: () => Promise<void> | void;
  taskUpdateQueueState: TaskUpdateQueueState;
};

export type TaskUpdateQueueState = {
  queuedTaskUpdates: Map<string, Promise<void>>;
  latestTaskUpdateSeqById: Map<string, number>;
  nextTaskUpdateSeq: number;
};

export const createTaskUpdateQueueState = (): TaskUpdateQueueState => ({
  queuedTaskUpdates: new Map(),
  latestTaskUpdateSeqById: new Map(),
  nextTaskUpdateSeq: 0,
});

export const makeTaskHandlers = (deps: TaskHandlersDeps) => {
  const {
    projectTasks,
    setProjectTasks,
    setEntries,
    generateRecurringEntries,
    taskUpdateQueueState,
  } = deps;

  const update = async (id: string, updates: Partial<ProjectTask>) => {
    const { queuedTaskUpdates, latestTaskUpdateSeqById } = taskUpdateQueueState;
    const updateSeq = ++taskUpdateQueueState.nextTaskUpdateSeq;
    latestTaskUpdateSeqById.set(id, updateSeq);
    const priorUpdate = queuedTaskUpdates.get(id) ?? Promise.resolve();
    const runUpdate = async () => {
      if (latestTaskUpdateSeqById.get(id) !== updateSeq) return;
      const updated = await api.tasks.update(id, updates);
      setProjectTasks((prev) => prev.map((t) => (t.id === id ? updated : t)));
    };
    const updateRequest = queuedTaskUpdates.has(id)
      ? priorUpdate.catch(() => undefined).then(runUpdate)
      : runUpdate();
    queuedTaskUpdates.set(id, updateRequest);
    try {
      await updateRequest;
    } catch (err) {
      console.error('Failed to update task:', err);
    } finally {
      if (queuedTaskUpdates.get(id) === updateRequest) {
        queuedTaskUpdates.delete(id);
      }
      if (latestTaskUpdateSeqById.get(id) === updateSeq) {
        latestTaskUpdateSeqById.delete(id);
      }
    }
  };

  const makeRecurring = async (
    taskId: string,
    pattern: 'daily' | 'weekly' | 'monthly' | string,
    startDate?: string,
    endDate?: string,
    duration?: number,
  ) => {
    try {
      // Editing an already-recurring task: wipe its placeholder entries first
      // so generateRecurringEntries doesn't leave behind orphans from the old
      // pattern/date range (e.g. weekly → monthly, or moving end date earlier).
      // No-op for the first-time "make recurring" flow.
      const existing = projectTasks.find((t) => t.id === taskId);
      if (existing?.isRecurring) {
        await api.entries.bulkDelete(existing.projectId, existing.name, {
          placeholderOnly: true,
        });
        setEntries((prev) =>
          prev.filter(
            (e) =>
              !(e.isPlaceholder && e.projectId === existing.projectId && e.task === existing.name),
          ),
        );
      }

      const updated = await api.tasks.update(taskId, {
        isRecurring: true,
        recurrencePattern: pattern,
        recurrenceStart: startDate || getLocalDateString(),
        recurrenceEnd: endDate,
        recurrenceDuration: duration,
      });
      // Functional updater so a concurrent task edit/add during the awaited
      // api.tasks.update above is not clobbered by a stale snapshot.
      setProjectTasks((prev) => prev.map((t) => (t.id === taskId ? updated : t)));
      await generateRecurringEntries();
    } catch (err) {
      console.error('Failed to make task recurring:', err);
    }
  };

  const recurringAction = async (
    taskId: string,
    action: 'stop' | 'delete_future' | 'delete_all',
  ) => {
    const task = projectTasks.find((t) => t.id === taskId);
    if (!task) return;

    try {
      await api.tasks.update(taskId, {
        isRecurring: false,
        recurrencePattern: undefined,
        recurrenceStart: undefined,
        recurrenceEnd: undefined,
      });
      setProjectTasks((prev) =>
        prev.map((t) =>
          t.id === taskId
            ? {
                ...t,
                isRecurring: false,
                recurrencePattern: undefined,
                recurrenceStart: undefined,
                recurrenceEnd: undefined,
              }
            : t,
        ),
      );

      if (action === 'stop') {
        await api.entries.bulkDelete(task.projectId, task.name, { placeholderOnly: true });
        setEntries((prev) =>
          prev.filter(
            (e) => !(e.isPlaceholder && e.projectId === task.projectId && e.task === task.name),
          ),
        );
      } else if (action === 'delete_future') {
        await api.entries.bulkDelete(task.projectId, task.name, { futureOnly: true });
        const today = getLocalDateString();
        setEntries((prev) =>
          prev.filter(
            (e) => !(e.projectId === task.projectId && e.task === task.name && e.date >= today),
          ),
        );
      } else if (action === 'delete_all') {
        await api.entries.bulkDelete(task.projectId, task.name);
        setEntries((prev) =>
          prev.filter((e) => !(e.projectId === task.projectId && e.task === task.name)),
        );
      }
    } catch (err) {
      console.error('Failed to handle recurring action:', err);
    }
  };

  return { update, makeRecurring, recurringAction };
};
