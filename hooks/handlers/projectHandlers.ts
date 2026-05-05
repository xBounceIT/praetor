import type React from 'react';
import type { DraftTaskInput } from '../../components/projects/ProjectsView';
import { COLORS } from '../../constants';
import api from '../../services/api';
import type { ClientsOrder, Project, ProjectTask, TimeEntry } from '../../types';

export type ProjectHandlersDeps = {
  projects: Project[];
  clientsOrders: ClientsOrder[];
  setProjects: React.Dispatch<React.SetStateAction<Project[]>>;
  setProjectTasks: React.Dispatch<React.SetStateAction<ProjectTask[]>>;
  setEntries: React.Dispatch<React.SetStateAction<TimeEntry[]>>;
};

export const makeProjectHandlers = (deps: ProjectHandlersDeps) => {
  const { projects, clientsOrders, setProjects, setProjectTasks, setEntries } = deps;

  const add = async (
    name: string,
    orderId: string,
    description?: string,
    draftTasks?: DraftTaskInput[],
  ) => {
    try {
      const order = clientsOrders.find((o) => o.id === orderId);
      if (!order) throw new Error('Order not found');
      const clientId = order.clientId;

      const usedColors = projects.map((p) => p.color);
      const availableColors = COLORS.filter((c) => !usedColors.includes(c));
      const color =
        availableColors.length > 0
          ? availableColors[Math.floor(Math.random() * availableColors.length)]
          : COLORS[Math.floor(Math.random() * COLORS.length)];

      const project = await api.projects.create({ name, clientId, description, color, orderId });
      setProjects((prev) => [...prev, project]);

      if (draftTasks && draftTasks.length > 0) {
        const createdTasks = await Promise.all(
          draftTasks.map((t) =>
            api.tasks.create(
              t.name,
              project.id,
              undefined,
              false,
              undefined,
              t.expectedEffort,
              t.revenue,
              t.notes,
            ),
          ),
        );
        setProjectTasks((prev) => [...prev, ...createdTasks]);
      }
    } catch (err) {
      console.error('Failed to add project:', err);
    }
  };

  const addTask = async (
    name: string,
    projectId: string,
    recurringConfig?: { isRecurring: boolean; pattern: 'daily' | 'weekly' | 'monthly' },
    description?: string,
  ) => {
    try {
      const task = await api.tasks.create(
        name,
        projectId,
        description,
        recurringConfig?.isRecurring,
        recurringConfig?.pattern,
      );
      setProjectTasks((prev) => [...prev, task]);
    } catch (err) {
      console.error('Failed to add task:', err);
    }
  };

  const update = async (id: string, updates: Partial<Project>) => {
    try {
      const updated = await api.projects.update(id, updates);
      setProjects((prev) => prev.map((p) => (p.id === id ? updated : p)));
    } catch (err) {
      console.error('Failed to update project:', err);
      alert('Failed to update project');
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
      alert('Failed to delete project');
    }
  };

  return { add, addTask, update, delete: remove };
};
