import type React from 'react';
import api from '../../services/api';
import type {
  Client,
  ClientProfileOption,
  ClientProfileOptionCategory,
  Project,
  ProjectTask,
} from '../../types';

export type ClientHandlersDeps = {
  projects: Project[];
  setClients: React.Dispatch<React.SetStateAction<Client[]>>;
  setProjects: React.Dispatch<React.SetStateAction<Project[]>>;
  setProjectTasks: React.Dispatch<React.SetStateAction<ProjectTask[]>>;
};

export const makeClientHandlers = (deps: ClientHandlersDeps) => {
  const { projects, setClients, setProjects, setProjectTasks } = deps;

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
      const projectIdsForClient = projects.filter((p) => p.clientId === id).map((p) => p.id);
      setClients((prev) => prev.filter((c) => c.id !== id));
      setProjects((prev) => prev.filter((p) => p.clientId !== id));
      setProjectTasks((prev) => prev.filter((t) => !projectIdsForClient.includes(t.projectId)));
    } catch (err) {
      console.error('Failed to delete client:', err);
      alert('Failed to delete client');
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
