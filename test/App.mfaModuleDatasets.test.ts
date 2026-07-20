import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('App.tsx MFA exemption datasets', () => {
  const source = readFileSync(join(import.meta.dir, '..', 'App.tsx'), 'utf8').replaceAll(
    '\r\n',
    '\n',
  );

  test('loads MFA exemption user options for authentication admins who can update general settings', () => {
    expect(source).toContain("buildPermission('administration.general', 'update')");
    expect(source).toContain(
      'const shouldLoadMfaExemptionUsers = canViewAuthentication && canManageMfa;',
    );
    expect(source).toContain('api.users.listTotpExemptionOptions()');
    expect(source).toContain('users={mfaExemptionUsers}');
  });

  test('does not gate MFA exemption users behind the full user list permission', () => {
    const start = source.indexOf("'MFA exemption users'");
    expect(start).toBeGreaterThan(-1);
    const dataset = source.slice(start, source.indexOf('),', start));
    expect(dataset).toContain('shouldLoadMfaExemptionUsers');
    expect(dataset).not.toContain('canListUsers');
  });

  test('refreshes MFA exemption options after user directory changes', () => {
    expect(source).toContain('const refreshMfaExemptionUsers = useCallback(async () => {');
    expect(source).toContain('refreshMfaExemptionUsers,\n      }),');
    expect(source).toContain('void refreshMfaExemptionUsers();');
  });
});
