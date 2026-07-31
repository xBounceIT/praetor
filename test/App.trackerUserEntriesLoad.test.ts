import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The tracker renders one selected user's entries. Its preload must therefore be
// scoped to that user at the API boundary instead of relying on an arbitrarily
// deep page of the global entry stream.
describe('App.tsx selected tracker user entry loading', () => {
  const source = readFileSync(join(import.meta.dir, '..', 'App.tsx'), 'utf8');
  const moduleLookup = source.indexOf('const module = getModuleFromView(activeView);');
  const effectStart = source.lastIndexOf('useEffect(() => {', moduleLookup);
  const effectEnd = source.indexOf('// Load target user catalogs', moduleLookup);
  const effect = source.slice(effectStart, effectEnd);

  test('locates the module-loading effect', () => {
    expect(moduleLookup).toBeGreaterThan(-1);
    expect(effectStart).toBeGreaterThan(-1);
    expect(effectEnd).toBeGreaterThan(moduleLookup);
  });

  test('tracks which selected user the completed tracker load belongs to', () => {
    expect(source).toContain('const loadedTrackerUserIdRef = useRef<string | null>(null);');
    expect(effect).toContain('loadedTrackerUserIdRef.current = viewingUserId');
    expect(source).toContain('loadedTrackerUserIdRef.current === viewingUserId');
    expect(effect).toContain('isTimesheetViewLoadCurrent');
  });

  test('scopes both the initial and continuation entry pages to the selected user', () => {
    expect(effect).toMatch(
      /api\.entries\.listPage\(\{\s*userId:\s*viewingUserId,\s*cursor:\s*pageCursor,\s*limit:\s*500,?\s*\}\)/,
    );
    expect(effect).toMatch(
      /load:\s*\(\)\s*=>\s*api\.entries\.listPage\(\{\s*userId:\s*viewingUserId,\s*limit:\s*500\s*\}\)/,
    );
  });

  test('reruns the module loader when the selected user changes', () => {
    const dependencyStart = effect.lastIndexOf('}, [');
    const dependencies = effect.slice(dependencyStart);
    expect(dependencies).toContain('viewingUserId');
  });

  test('keeps the tracker pending until the selected user dataset is ready', () => {
    const pendingStateStart = source.indexOf('const isActiveModulePending =');
    const pendingStateEnd = source.indexOf('\n\n  return {', pendingStateStart);
    const pendingState = source.slice(pendingStateStart, pendingStateEnd);

    expect(pendingState).toContain('!isTimesheetViewLoadCurrent');
  });

  test('reuses shared tracker catalogs when switching to another user', () => {
    expect(effect).toContain('const shouldReuseTrackerCatalogDatasets =');
    for (const dataset of ['clients', 'projects', 'tasks', 'users']) {
      expect(effect).toMatch(
        new RegExp(
          `'${dataset}',\\s*requirements\\.${dataset}\\s*&&\\s*!shouldReuseTrackerCatalogDatasets`,
        ),
      );
    }
  });
});
