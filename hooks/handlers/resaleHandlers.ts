import type React from 'react';
import api from '../../services/api';
import type {
  CreateResaleBody,
  UpdateResaleBody,
  UpsertResaleActivityBody,
} from '../../services/api/resales';
import type { Resale, ResaleActivity, ResaleCategory } from '../../types';
import { getErrorMessage } from '../../utils/errors';
import { toastError } from '../../utils/toast';

export type ResaleHandlersDeps = {
  setResales: React.Dispatch<React.SetStateAction<Resale[]>>;
  setResaleCategories: React.Dispatch<React.SetStateAction<ResaleCategory[]>>;
};

const upsertResale = (items: Resale[], resale: Resale): Resale[] => {
  const index = items.findIndex((item) => item.id === resale.id);
  if (index === -1) return [resale, ...items];
  const next = [...items];
  next[index] = resale;
  return next;
};

const upsertCategory = (items: ResaleCategory[], category: ResaleCategory): ResaleCategory[] => {
  const index = items.findIndex((item) => item.id === category.id);
  if (index === -1) return [...items, category].sort((a, b) => a.name.localeCompare(b.name));
  const next = [...items];
  next[index] = category;
  return next.sort((a, b) => a.name.localeCompare(b.name));
};

export const makeResaleHandlers = (deps: ResaleHandlersDeps) => {
  const { setResales, setResaleCategories } = deps;

  const create = async (input: CreateResaleBody): Promise<Resale | null> => {
    try {
      const created = await api.resales.create(input);
      setResales((prev) => upsertResale(prev, created));
      return created;
    } catch (err) {
      console.error('Failed to create resale:', err);
      toastError(`Failed to create resale: ${getErrorMessage(err)}`);
      return null;
    }
  };

  const update = async (id: string, updates: Partial<UpdateResaleBody>) => {
    try {
      const updated = await api.resales.update(id, updates);
      setResales((prev) => upsertResale(prev, updated));
      return updated;
    } catch (err) {
      console.error('Failed to update resale:', err);
      toastError(`Failed to update resale: ${getErrorMessage(err)}`);
      return null;
    }
  };

  const remove = async (id: string) => {
    try {
      await api.resales.delete(id);
      setResales((prev) => prev.filter((item) => item.id !== id));
    } catch (err) {
      console.error('Failed to delete resale:', err);
      toastError(`Failed to delete resale: ${getErrorMessage(err)}`);
    }
  };

  const createActivity = async (
    resaleId: string,
    input: UpsertResaleActivityBody,
  ): Promise<Resale | null> => {
    try {
      const updated = await api.resales.createActivity(resaleId, input);
      setResales((prev) => upsertResale(prev, updated));
      return updated;
    } catch (err) {
      console.error('Failed to create resale activity:', err);
      toastError(`Failed to create resale activity: ${getErrorMessage(err)}`);
      return null;
    }
  };

  const updateActivity = async (
    resaleId: string,
    activityId: string,
    updates: Partial<UpsertResaleActivityBody>,
  ): Promise<Resale | null> => {
    try {
      const updated = await api.resales.updateActivity(resaleId, activityId, updates);
      setResales((prev) => upsertResale(prev, updated));
      return updated;
    } catch (err) {
      console.error('Failed to update resale activity:', err);
      toastError(`Failed to update resale activity: ${getErrorMessage(err)}`);
      return null;
    }
  };

  const deleteActivity = async (resaleId: string, activityId: string): Promise<Resale | null> => {
    try {
      const updated = await api.resales.deleteActivity(resaleId, activityId);
      setResales((prev) => upsertResale(prev, updated));
      return updated;
    } catch (err) {
      console.error('Failed to delete resale activity:', err);
      toastError(`Failed to delete resale activity: ${getErrorMessage(err)}`);
      return null;
    }
  };

  const createCategory = async (name: string): Promise<ResaleCategory | null> => {
    try {
      const created = await api.resales.createCategory(name);
      setResaleCategories((prev) => upsertCategory(prev, created));
      return created;
    } catch (err) {
      console.error('Failed to create resale category:', err);
      toastError(`Failed to create resale category: ${getErrorMessage(err)}`);
      return null;
    }
  };

  const updateCategory = async (id: string, name: string): Promise<ResaleCategory | null> => {
    try {
      const updated = await api.resales.updateCategory(id, name);
      setResaleCategories((prev) => upsertCategory(prev, updated));
      setResales((prev) =>
        prev.map((resale) => ({
          ...resale,
          activities: resale.activities.map((activity: ResaleActivity) =>
            activity.categoryId === id ? { ...activity, categoryName: updated.name } : activity,
          ),
        })),
      );
      return updated;
    } catch (err) {
      console.error('Failed to update resale category:', err);
      toastError(`Failed to update resale category: ${getErrorMessage(err)}`);
      return null;
    }
  };

  const deleteCategory = async (id: string) => {
    try {
      await api.resales.deleteCategory(id);
      setResaleCategories((prev) => prev.filter((item) => item.id !== id));
    } catch (err) {
      console.error('Failed to delete resale category:', err);
      toastError(`Failed to delete resale category: ${getErrorMessage(err)}`);
    }
  };

  return {
    create,
    update,
    delete: remove,
    createActivity,
    updateActivity,
    deleteActivity,
    createCategory,
    updateCategory,
    deleteCategory,
  };
};
