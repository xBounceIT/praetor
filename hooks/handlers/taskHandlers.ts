import type React from 'react';
import api from '../../services/api';
import type { ProjectTask, TimeEntry } from '../../types';
import { getLocalDateString } from '../../utils/date';

export type TaskHandlersDeps = {
  projectTasks: ProjectTask[];
  setProjectTasks: React.Dispatch<React.SetStateAction<ProjectTask[]>>;
  setEntries: React.Dispatch<React.SetStateAction<TimeEntry[]>>;
  generateRecurringEntries: () => Promise<void> | void;
};

export const makeTaskHandlers = (deps: TaskHandlersDeps) => {
  const { projectTasks, setProjectTasks, setEntries, generateRecurringEntries } = deps;

  const update = async (id: string, updates: Partial<ProjectTask>) => {
    try {
      const updated = await api.tasks.update(id, updates);
      setProjectTasks((prev) => prev.map((t) => (t.id === id ? updated : t)));
    } catch (err) {
      console.error('Failed to update task:', err);
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
      setProjectTasks((prev) => prev.map((t) => (t.id === taskId ? updated : t)));
      setTimeout(() => {
        void generateRecurringEntries();
      }, 100);
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
