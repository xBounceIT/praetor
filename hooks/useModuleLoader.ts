import { useCallback, useState } from 'react';
import { getErrorMessage } from '../utils/errors';

export type ModuleLoadErrors = Partial<Record<string, string[]>>;

export type DatasetRequest<T = unknown> = {
  dataset: string;
  enabled: boolean;
  load: () => Promise<T>;
  apply: (data: T) => void;
};

export const listRequest = <T>(
  dataset: string,
  enabled: boolean,
  load: () => Promise<T>,
  apply: (data: T) => void,
): DatasetRequest<T> => ({ dataset, enabled, load, apply });

export function useModuleLoader() {
  const [loadedModules, setLoadedModules] = useState<Set<string>>(new Set());
  const [moduleLoadErrors, setModuleLoadErrors] = useState<ModuleLoadErrors>({});

  const loadDatasets = useCallback(
    // biome-ignore lint/suspicious/noExplicitAny: heterogeneous array — each request's T is internally consistent.
    async (moduleName: string, requests: DatasetRequest<any>[]): Promise<string[]> => {
      const activeRequests = requests.filter((request) => request.enabled);
      if (activeRequests.length === 0) return [];

      const results = await Promise.allSettled(activeRequests.map((request) => request.load()));
      const failures: string[] = [];

      results.forEach((result, index) => {
        const request = activeRequests[index];
        if (result.status === 'fulfilled') {
          request.apply(result.value);
          return;
        }

        failures.push(request.dataset);
        console.error(
          `Failed to load ${moduleName} dataset "${request.dataset}": ${getErrorMessage(result.reason)}`,
          result.reason,
        );
      });

      return failures;
    },
    [],
  );

  const markModuleLoaded = useCallback((moduleName: string) => {
    setLoadedModules((prev) => {
      const next = new Set(prev);
      next.add(moduleName);
      return next;
    });
  }, []);

  const recordFailures = useCallback((moduleName: string, failures: string[]) => {
    setModuleLoadErrors((prev) => {
      const next = { ...prev };
      if (failures.length > 0) {
        next[moduleName] = failures;
      } else {
        delete next[moduleName];
      }
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setLoadedModules(new Set());
    setModuleLoadErrors({});
  }, []);

  return {
    loadedModules,
    moduleLoadErrors,
    loadDatasets,
    markModuleLoaded,
    recordFailures,
    reset,
  };
}
