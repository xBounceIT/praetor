import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const scriptsDir = join(import.meta.dir, '..', '..', 'scripts');

const sourceFilesUnder = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFilesUnder(path);
    return entry.isFile() && /\.[cm]?[jt]s$/.test(entry.name) ? [path] : [];
  });

describe('deployable maintenance scripts', () => {
  test('do not bypass credential rotation with a direct password-hash update', () => {
    const unsafeScripts = sourceFilesUnder(scriptsDir)
      .filter((path) => {
        const source = readFileSync(path, 'utf8');
        const directlyUpdatesPasswordHash =
          /UPDATE\s+users[\s\S]{0,500}password_hash/i.test(source) ||
          /password_hash[\s\S]{0,500}UPDATE\s+users/i.test(source);
        const hashesPublicDefault = /bcrypt\.hash\(\s*['"]password['"]/i.test(source);
        return directlyUpdatesPasswordHash || hashesPublicDefault;
      })
      .map((path) => relative(scriptsDir, path));

    expect(unsafeScripts).toEqual([]);
  });
});
