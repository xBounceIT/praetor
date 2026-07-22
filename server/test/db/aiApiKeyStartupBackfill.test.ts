import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const STARTUP_SOURCE = readFileSync(join(import.meta.dir, '..', '..', 'index.ts'), 'utf8');

describe('AI provider credential startup backfill', () => {
  test('runs after schema migration and before the server starts listening', () => {
    const schemaReadyIndex = STARTUP_SOURCE.indexOf('await prepareDatabaseForStartup()');
    const backfillIndex = STARTUP_SOURCE.indexOf('await migrateLegacyAiApiKeys()');
    const listenIndex = STARTUP_SOURCE.indexOf('await fastify.listen(');

    expect(schemaReadyIndex).toBeGreaterThan(-1);
    expect(backfillIndex).toBeGreaterThan(schemaReadyIndex);
    expect(listenIndex).toBeGreaterThan(backfillIndex);
  });
});
