import type React from 'react';
import type { AddProjectFormInput } from '../../components/projects/ProjectsView';
import api from '../../services/api';
import type { Project, ProjectTask, TimeEntry } from '../../types';
import { getErrorMessage } from '../../utils/errors';
import { toastError } from '../../utils/toast';

export type ProjectHandlersDeps = {
  setProjects: React.Dispatch<React.SetStateAction<Project[]>>;
  setProjectTasks: React.Dispatch<React.SetStateAction<ProjectTask[]>>;
  setEntries: React.Dispatch<React.SetStateAction<TimeEntry[]>>;
};

// Re-export so callers don't need to know which module defines the form's submit shape.
export type AddProjectInput = AddProjectFormInput;

export const makeProjectHandlers = (deps: ProjectHandlersDeps) => {
  const { setProjects, setProjectTasks, setEntries } = deps;

  const add = async (input: AddProjectInput) => {
    try {
      if (!input.clientId) throw new Error('Client is required');

      const project = await api.projects.create({
        name: input.name,
        clientId: input.clientId,
        description: input.description,
        orderId: input.orderId || undefined,
        offerId: input.offerId,
        startDate: input.startDate ?? null,
        endDate: input.endDate ?? null,
        revenue: input.revenue ?? null,
        billingType: input.billingType,
        billingFrequency: input.billingFrequency,
      });
      setProjects((prev) => [...prev, project]);

      if (input.draftTasks && input.draftTasks.length > 0) {
        const createdTasks = await Promise.all(
          input.draftTasks.map((t) =>
            api.tasks.create(
              t.name,
              project.id,
              undefined,
              false,
              undefined,
              t.expectedEffort,
              t.revenue,
              t.notes,
              t.monthlyEffort,
              t.billingType,
              t.billingFrequency,
            ),
          ),
        );
        setProjectTasks((prev) => [...prev, ...createdTasks]);
      }
    } catch (err) {
      console.error('Failed to add project:', err);
      toastError(`Failed to add project: ${getErrorMessage(err)}`);
    }
  };

  const addTask = async (
    name: string,
    projectId: string,
    recurringConfig?: { isRecurring: boolean; pattern: 'daily' | 'weekly' | 'monthly' },
    description?: string,
    details?: Pick<
      ProjectTask,
      'expectedEffort' | 'monthlyEffort' | 'revenue' | 'notes' | 'billingType' | 'billingFrequency'
    >,
  ): Promise<ProjectTask> => {
    try {
      const task = await api.tasks.create(
        name,
        projectId,
        description,
        recurringConfig?.isRecurring,
        recurringConfig?.pattern,
        details?.expectedEffort,
        details?.revenue,
        details?.notes,
        details?.monthlyEffort,
        details?.billingType,
        details?.billingFrequency,
      );
      setProjectTasks((prev) => [...prev, task]);
      return task;
    } catch (err) {
      console.error('Failed to add task:', err);
      toastError(`Failed to add task: ${getErrorMessage(err)}`);
      throw err;
    }
  };

  const update = async (id: string, updates: Partial<Project>) => {
    try {
      const updated = await api.projects.update(id, updates);
      setProjects((prev) => prev.map((p) => (p.id === id ? updated : p)));
    } catch (err) {
      console.error('Failed to update project:', err);
      toastError('Failed to update project');
    }
  };

  const remove = async (id: string) => {
    try {
      await api.projects.delete(id);
      setProjects((prev) => prev.filter((p) => p.id !== id));
      setProjectTasks((prev) => prev.filter((t) => t.projectId !== id));
      setEntries((prev) => prev.filter((e) => e.projectId !== id));
    } catch (err) {
      console.error('Failed to delete project:', err);
      toastError('Failed to delete project');
    }
  };

  return { add, addTask, update, delete: remove };
};
