import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  INSECURE_DEFAULT_ADMIN_PASSWORDS,
  INSECURE_DEFAULT_DEMO_USER_PASSWORDS,
} from '../../utils/runtimeConfig.ts';

const repositoryRoot = join(import.meta.dir, '..', '..', '..');
const readRepositoryFile = (path: string): string =>
  readFileSync(join(repositoryRoot, path), 'utf8');

describe('deployment password configuration', () => {
  test.each([
    '.env.example',
    'server/.env.example',
    'deploy/.env.customer.example',
  ])('%s does not publish an accepted bootstrap admin password', (path) => {
    const source = readRepositoryFile(path);
    const configuredValue = source.match(/^ADMIN_DEFAULT_PASSWORD=(.*)$/m)?.[1].trim();

    expect(configuredValue).toBe('');
    for (const knownPassword of INSECURE_DEFAULT_ADMIN_PASSWORDS) {
      expect(source).not.toContain(`ADMIN_DEFAULT_PASSWORD=${knownPassword}`);
    }
  });

  test.each([
    'docker-compose.yml',
    'deploy/docker-compose.customer.yml',
  ])('%s forwards the optional bootstrap password to the backend', (path) => {
    expect(readRepositoryFile(path)).toMatch(
      /ADMIN_DEFAULT_PASSWORD:\s+'\$\{ADMIN_DEFAULT_PASSWORD:-\}'/,
    );
  });

  test.each([
    '.env.example',
    'server/.env.example',
    'deploy/.env.customer.example',
  ])('%s does not publish an accepted demo user password', (path) => {
    const source = readRepositoryFile(path);
    const configuredValue = source.match(/^DEMO_USER_PASSWORD=(.*)$/m)?.[1].trim();

    expect(configuredValue).toBe('');
    for (const knownPassword of INSECURE_DEFAULT_DEMO_USER_PASSWORDS) {
      expect(source).not.toContain(`DEMO_USER_PASSWORD=${knownPassword}`);
    }
  });

  test.each([
    'docker-compose.yml',
    'deploy/docker-compose.customer.yml',
  ])('%s forwards the optional demo user password to the backend', (path) => {
    expect(readRepositoryFile(path)).toMatch(/DEMO_USER_PASSWORD:\s+'\$\{DEMO_USER_PASSWORD:-\}'/);
  });

  test('committed frontend docs do not advertise the removed password fallback', () => {
    const source = readRepositoryFile('docs/frontend/index.html');

    expect(source).not.toContain('falls back to <code>password</code>');
    expect(source).not.toContain('<code>manager</code> / <code>password</code>');
    expect(source).not.toContain('<code>user</code> / <code>password</code>');
    expect(source).toContain('blank and published legacy defaults are rejected');
    expect(source).toContain('the configured <code>DEMO_USER_PASSWORD</code>');
  });
});
