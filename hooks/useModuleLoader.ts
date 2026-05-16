import { useCallback, useRef, useState } from 'react';
import { getErrorMessage } from '../utils/errors';

export type ModuleLoadErrors = Partial<Record<string, string[]>>;

export type DatasetRequest<T = unknown> = {
  dataset: string;
  enabled: boolean;
  load: () => Promise<T>;
  apply: (data: T) => void;
};

export type DatasetLoadOptions = {
  shouldApply?: () => boolean;
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
  const [loadingModules, setLoadingModules] = useState<Set<string>>(new Set());
  const loadedModulesRef = useRef(loadedModules);
  loadedModulesRef.current = loadedModules;

  const loadDatasets = useCallback(
    async (
      moduleName: string,
      // biome-ignore lint/suspicious/noExplicitAny: heterogeneous array - each request's T is internally consistent.
      requests: DatasetRequest<any>[],
      options: DatasetLoadOptions = {},
    ): Promise<string[]> => {
      const activeRequests = requests.filter((request) => request.enabled);
      if (activeRequests.length === 0) return [];
      const shouldApply = () => options.shouldApply?.() ?? true;

      setLoadingModules((prev) => {
        const next = new Set(prev);
        next.add(moduleName);
        return next;
      });

      try {
        const results = await Promise.allSettled(activeRequests.map((request) => request.load()));
        const failures: string[] = [];

        for (const [index, result] of results.entries()) {
          if (!shouldApply()) return [];

          const request = activeRequests[index];
          if (result.status === 'fulfilled') {
            request.apply(result.value);
            continue;
          }

          failures.push(request.dataset);
          console.error(
            `Failed to load ${moduleName} dataset "${request.dataset}": ${getErrorMessage(result.reason)}`,
            result.reason,
          );
        }

        return shouldApply() ? failures : [];
      } finally {
        setLoadingModules((prev) => {
          const next = new Set(prev);
          next.delete(moduleName);
          return next;
        });
      }
    },
    [],
  );

  const markModuleLoaded = useCallback((moduleName: string) => {
    setLoadedModules((prev) => {
      if (prev.has(moduleName)) return prev;
      const next = new Set(prev);
      next.add(moduleName);
      return next;
    });
  }, []);

  // Drop modules from the loaded set so a subsequent visit re-fetches them.
  // Used when cross-module data they cached has been cleared by navigation.
  const invalidateModules = useCallback((moduleNames: readonly string[]) => {
    if (moduleNames.length === 0) return;
    setLoadedModules((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const name of moduleNames) {
        if (next.delete(name)) changed = true;
      }
      return changed ? next : prev;
    });
    setModuleLoadErrors((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const name of moduleNames) {
        if (name in next) {
          delete next[name];
          changed = true;
        }
      }
      return changed ? next : prev;
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

  // Additive counterpart to recordFailures, for async tail-work that completes
  // after the initial failure list has been written.
  const appendFailure = useCallback((moduleName: string, failure: string) => {
    setModuleLoadErrors((prev) => {
      const existing = prev[moduleName] ?? [];
      if (existing.includes(failure)) return prev;
      return { ...prev, [moduleName]: [...existing, failure] };
    });
  }, []);

  const reset = useCallback(() => {
    setLoadedModules(new Set());
    setModuleLoadErrors({});
    setLoadingModules(new Set());
  }, []);

  const isModuleLoaded = useCallback((moduleName: string) => {
    return loadedModulesRef.current.has(moduleName);
  }, []);

  const isModuleLoading = useCallback(
    (moduleName: string) => loadingModules.has(moduleName),
    [loadingModules],
  );

  return {
    loadedModules,
    moduleLoadErrors,
    loadingModules,
    isModuleLoaded,
    isModuleLoading,
    loadDatasets,
    markModuleLoaded,
    invalidateModules,
    recordFailures,
    appendFailure,
    reset,
  };
}
