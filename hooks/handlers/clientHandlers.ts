import type React from 'react';
import api from '../../services/api';
import type {
  Client,
  ClientProfileOption,
  ClientProfileOptionCategory,
  Project,
  ProjectTask,
} from '../../types';
import { toastError } from '../../utils/toast';

/**
 * Client handlers read `projects` AFTER an awaited delete to compute which
 * project tasks to drop. Capturing the array from the deps closure would
 * surface a stale-closure bug: between the time `makeClientHandlers` runs and
 * the time `remove()` awaits the API, the user may have added or deleted a
 * project. Using a getter that reads from a ref in `App.tsx` keeps the read
 * fresh — we filter against the latest `projects` snapshot at invocation
 * time. See `quoteHandlers.ts` for the canonical example of the pattern.
 */
export type ClientHandlersDeps = {
  getProjects: () => Project[];
  setClients: React.Dispatch<React.SetStateAction<Client[]>>;
  setProjects: React.Dispatch<React.SetStateAction<Project[]>>;
  setProjectTasks: React.Dispatch<React.SetStateAction<ProjectTask[]>>;
};

export const makeClientHandlers = (deps: ClientHandlersDeps) => {
  const { getProjects, setClients, setProjects, setProjectTasks } = deps;

  const add = async (clientData: Partial<Client>) => {
    try {
      const client = await api.clients.create(clientData);
      setClients((prev) => [...prev, client]);
    } catch (err) {
      console.error('Failed to add client:', err);
      throw err;
    }
  };

  const update = async (id: string, updates: Partial<Client>) => {
    try {
      const updated = await api.clients.update(id, updates);
      setClients((prev) => prev.map((c) => (c.id === id ? updated : c)));
    } catch (err) {
      console.error('Failed to update client:', err);
      throw err;
    }
  };

  const remove = async (id: string) => {
    try {
      await api.clients.delete(id);
      // Read `projects` via the getter so we observe the latest array, not the
      // one captured at factory creation. Any project added/removed during the
      // delete round-trip would otherwise be missed when filtering tasks.
      const projectIdsForClient = getProjects()
        .filter((p) => p.clientId === id)
        .map((p) => p.id);
      setClients((prev) => prev.filter((c) => c.id !== id));
      setProjects((prev) => prev.filter((p) => p.clientId !== id));
      setProjectTasks((prev) => prev.filter((t) => !projectIdsForClient.includes(t.projectId)));
    } catch (err) {
      console.error('Failed to delete client:', err);
      toastError('Failed to delete client');
    }
  };

  const createProfileOption = async (
    category: ClientProfileOptionCategory,
    value: string,
    sortOrder?: number,
  ): Promise<ClientProfileOption> => {
    try {
      return await api.clients.createProfileOption(category, value, sortOrder);
    } catch (err) {
      console.error('Failed to create client profile option:', err);
      throw err;
    }
  };

  const updateProfileOption = async (
    category: ClientProfileOptionCategory,
    id: string,
    updates: { value: string; sortOrder?: number },
  ): Promise<ClientProfileOption> => {
    try {
      const updated = await api.clients.updateProfileOption(category, id, updates);
      const refreshedClients = await api.clients.list();
      setClients(refreshedClients);
      return updated;
    } catch (err) {
      console.error('Failed to update client profile option:', err);
      throw err;
    }
  };

  const deleteProfileOption = async (
    category: ClientProfileOptionCategory,
    id: string,
  ): Promise<void> => {
    try {
      await api.clients.deleteProfileOption(category, id);
    } catch (err) {
      console.error('Failed to delete client profile option:', err);
      throw err;
    }
  };

  return {
    add,
    update,
    delete: remove,
    createProfileOption,
    updateProfileOption,
    deleteProfileOption,
  };
};
