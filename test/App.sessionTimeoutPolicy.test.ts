import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(import.meta.dir, '..', 'App.tsx'), 'utf8');

describe('App session timeout policy', () => {
  test('loads general settings once for every authenticated session', () => {
    const marker = source.indexOf('The inactivity timer is global session state');
    expect(marker).toBeGreaterThan(-1);
    const end = source.indexOf('// The login screen always follows', marker);
    expect(end).toBeGreaterThan(marker);
    const block = source.slice(marker, end);

    expect(block).toContain('if (!currentUser) return');
    expect(block).toContain('loadGeneralSettingsOnce(() => !isCancelled)');
  });

  test('passes idle minutes to the global timer so it can derive token expiry dynamically', () => {
    const start = source.indexOf('const AuthenticatedAppShell');
    expect(start).toBeGreaterThan(-1);
    const end = source.indexOf('const AuthenticatedRouteContent', start);
    expect(end).toBeGreaterThan(start);
    const block = source.slice(start, end);

    expect(block).toContain(
      'sessionIdleTimeoutMinutes={generalSettings.sessionIdleTimeoutMinutes}',
    );
    expect(block).not.toContain('getSessionTimeoutThresholds');
  });
});
