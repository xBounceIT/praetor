import { test as bunTest } from 'bun:test';
import { act } from '@testing-library/react';

type ReactTestCallback = () => void | Promise<void>;

export const settleComponentTasks = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Keeps component-driven tasks inside React's test update boundary. */
export const reactTest = (name: string, callback: ReactTestCallback) =>
  bunTest(name, async () => {
    await callback();
    await act(async () => {
      await settleComponentTasks();
    });
  });
