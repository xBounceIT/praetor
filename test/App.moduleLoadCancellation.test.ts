import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('App.tsx module-load cancellation', () => {
  test('module-loading effect invalidates stale async completions', () => {
    const source = readFileSync(join(import.meta.dir, '..', 'App.tsx'), 'utf8');
    const start = source.indexOf('const module = getModuleFromView(activeView);');
    expect(start).toBeGreaterThan(-1);
    const end = source.indexOf('  }, [\n    activeView,', start);
    expect(end).toBeGreaterThan(start);
    const effectBody = source.slice(start, end);

    expect(source).toContain('const moduleLoadTokenRef = useRef(0);');
    expect(source).toContain('const activeLoadModuleRef = useLatestRef(');
    expect(source).toContain('isModuleLoaded,');
    expect(effectBody).toContain('const loadToken = ++moduleLoadTokenRef.current;');
    expect(effectBody).toContain('activeLoadModuleRef.current === module');
    expect(effectBody).toContain('isModuleLoaded(module) &&');
    expect(effectBody).toContain("module !== 'timesheets'");
    expect(effectBody).toContain('loadedTimesheetsViewRef.current === activeView');
    expect(effectBody).not.toContain('if (loadedModules.has(module)) return;');
    expect(effectBody).toContain('return cancelModuleLoad;');
    expect(effectBody).toContain('moduleLoadTokenRef.current += 1;');
    expect(effectBody).toContain('if (isCurrentModuleLoad()) {');

    const loadDatasetCalls = effectBody.match(/loadDatasets\(\s*module,\s*\[/g) ?? [];
    const guardedDatasetCalls = effectBody.match(/shouldApply: isCurrentModuleLoad/g) ?? [];
    expect(loadDatasetCalls.length).toBeGreaterThan(0);
    expect(guardedDatasetCalls).toHaveLength(loadDatasetCalls.length);

    const dependencyStart = source.indexOf('  }, [\n    activeView,', end);
    expect(dependencyStart).toBeGreaterThanOrEqual(end);
    const dependencyEnd = source.indexOf('  ]);', dependencyStart);
    expect(dependencyEnd).toBeGreaterThan(dependencyStart);
    const dependencies = source.slice(dependencyStart, dependencyEnd);
    expect(dependencies).toContain('isModuleLoaded');
    expect(dependencies).not.toContain('loadedModules');
  });
});
