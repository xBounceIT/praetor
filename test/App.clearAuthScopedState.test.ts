import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  INITIAL_EMAIL_CONFIG,
  INITIAL_GENERAL_SETTINGS,
  INITIAL_LDAP_CONFIG,
} from '../authScopedDefaults';

// Issue #371: defaults must wipe sensitive credentials and disable AI reporting
// so one user's settings do not survive into the next session after logout.
describe('App.tsx auth-scoped reset defaults', () => {
  test('LDAP defaults wipe bind credentials', () => {
    expect(INITIAL_LDAP_CONFIG.enabled).toBe(false);
    expect(INITIAL_LDAP_CONFIG.bindPassword).toBe('');
    expect(INITIAL_LDAP_CONFIG.tlsCaCertificate).toBe('');
    expect(INITIAL_LDAP_CONFIG.roleMappings).toEqual([]);
  });

  test('email defaults wipe SMTP credentials', () => {
    expect(INITIAL_EMAIL_CONFIG.enabled).toBe(false);
    expect(INITIAL_EMAIL_CONFIG.smtpHost).toBe('');
    expect(INITIAL_EMAIL_CONFIG.smtpUser).toBe('');
    expect(INITIAL_EMAIL_CONFIG.smtpPassword).toBe('');
    expect(INITIAL_EMAIL_CONFIG.fromEmail).toBe('');
  });

  test('general-settings defaults wipe AI keys and disable AI reporting', () => {
    expect(INITIAL_GENERAL_SETTINGS.enableAiReporting).toBe(false);
    expect(INITIAL_GENERAL_SETTINGS.geminiApiKey).toBe('');
    expect(INITIAL_GENERAL_SETTINGS.openrouterApiKey).toBe('');
    expect(INITIAL_GENERAL_SETTINGS.anthropicApiKey).toBe('');
    expect(INITIAL_GENERAL_SETTINGS.openaiApiKey).toBe('');
    expect(INITIAL_GENERAL_SETTINGS.geminiModelId).toBe('');
    expect(INITIAL_GENERAL_SETTINGS.openrouterModelId).toBe('');
    expect(INITIAL_GENERAL_SETTINGS.anthropicModelId).toBe('');
    expect(INITIAL_GENERAL_SETTINGS.openaiModelId).toBe('');
  });

  test('clearAuthScopedAppState body resets all three settings objects', () => {
    // Source-text assertion: pins that the reset *path* actually runs, not
    // just that the safe defaults exist. The bug was that the helper updated
    // `hasLoaded*` flags but never invoked the setters for the data itself.
    const source = readFileSync(join(import.meta.dir, '..', 'App.tsx'), 'utf8');
    const start = source.indexOf('const clearAuthScopedAppState = useCallback(');
    expect(start).toBeGreaterThan(-1);
    const end = source.indexOf('}, [resetModuleLoader]);', start);
    expect(end).toBeGreaterThan(start);
    const body = source.slice(start, end);
    expect(body).toContain('setGeneralSettings(INITIAL_GENERAL_SETTINGS)');
    expect(body).toContain('setLdapConfig(INITIAL_LDAP_CONFIG)');
    expect(body).toContain('setEmailConfig(INITIAL_EMAIL_CONFIG)');
    expect(body).toContain("mfaExemptionUsers: () => setModuleState('mfaExemptionUsers', [])");
  });
});
