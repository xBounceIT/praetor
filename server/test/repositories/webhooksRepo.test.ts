import { beforeEach, describe, expect, test } from 'bun:test';
import type { DbExecutor } from '../../db/drizzle.ts';
import * as webhooksRepo from '../../repositories/webhooksRepo.ts';
import { type FakeExecutor, setupTestDb } from '../helpers/fakeExecutor.ts';

let exec: FakeExecutor;
let testDb: DbExecutor;

beforeEach(() => {
  ({ exec, testDb } = setupTestDb());
});

// Positional rows mirror WEBHOOK_PROJECTION's declaration order in webhooksRepo.ts (rowMode:'array').
// Keep PROJECTION_KEYS in sync with that projection.
const PROJECTION_KEYS = [
  'id',
  'name',
  'description',
  'url',
  'httpMethod',
  'authType',
  'authUsername',
  'authHeaderName',
  'authSecret',
  'customHeaders',
  'enabled',
] as const;
type ProjectionKey = (typeof PROJECTION_KEYS)[number];
type RowFields = Record<ProjectionKey, unknown>;

const baseFields: RowFields = {
  id: 'webhook-1',
  name: 'Hook',
  description: '',
  url: 'https://example.com/hook',
  httpMethod: 'POST',
  authType: 'none',
  authUsername: '',
  authHeaderName: '',
  authSecret: '',
  customHeaders: [],
  enabled: true,
};

const buildRow = (overrides: Partial<RowFields> = {}): unknown[] => {
  const merged: RowFields = { ...baseFields, ...overrides };
  return PROJECTION_KEYS.map((k) => merged[k]);
};

describe('list', () => {
  test('maps rows and orders by created_at desc', async () => {
    exec.enqueue({
      rows: [
        buildRow({ id: 'webhook-1' }),
        buildRow({ id: 'webhook-2', authType: 'bearer', authSecret: 'enc:x' }),
      ],
    });
    const result = await webhooksRepo.list(testDb);
    expect(result).toHaveLength(2);
    expect(result[1].authSecret).toBe('enc:x');
    expect(exec.calls[0].sql).toMatch(/order by\s+"webhooks"\."created_at"\s+desc/i);
  });

  test('coalesces null columns to their defaults', async () => {
    exec.enqueue({
      rows: [
        buildRow({
          description: null,
          authUsername: null,
          authHeaderName: null,
          authSecret: null,
          customHeaders: null,
          enabled: null,
        }),
      ],
    });
    const [webhook] = await webhooksRepo.list(testDb);
    expect(webhook.description).toBe('');
    expect(webhook.customHeaders).toEqual([]);
    expect(webhook.enabled).toBe(true);
  });
});

describe('findById', () => {
  test('returns null when no row matches', async () => {
    exec.enqueue({ rows: [] });
    expect(await webhooksRepo.findById('missing', testDb)).toBeNull();
  });

  test('returns the mapped row and binds the id', async () => {
    exec.enqueue({ rows: [buildRow({ id: 'webhook-9', name: 'Nine' })] });
    const webhook = await webhooksRepo.findById('webhook-9', testDb);
    expect(webhook?.name).toBe('Nine');
    expect(exec.calls[0].params).toContain('webhook-9');
  });
});

describe('insert', () => {
  test('binds values and returns the mapped row', async () => {
    exec.enqueue({
      rows: [
        buildRow({ id: 'webhook-new', name: 'New', authType: 'bearer', authSecret: 'enc:tok' }),
      ],
    });
    const result = await webhooksRepo.insert(
      {
        id: 'webhook-new',
        name: 'New',
        description: 'd',
        url: 'https://x.com',
        httpMethod: 'PUT',
        authType: 'bearer',
        authUsername: '',
        authHeaderName: '',
        authSecret: 'enc:tok',
        customHeaders: [{ key: 'X', value: '1' }],
        enabled: true,
      },
      testDb,
    );
    expect(result.name).toBe('New');
    expect(exec.calls[0].sql).toMatch(/insert into "webhooks"/i);
    expect(exec.calls[0].params).toContain('webhook-new');
    expect(exec.calls[0].params).toContain('enc:tok');
  });
});

describe('update', () => {
  test('returns null when UPDATE returns 0 rows', async () => {
    exec.enqueue({ rows: [] });
    expect(await webhooksRepo.update('x', { name: 'Y' }, testDb)).toBeNull();
  });

  test('sets updated_at and returns the mapped row', async () => {
    exec.enqueue({ rows: [buildRow({ name: 'Updated' })] });
    const result = await webhooksRepo.update('webhook-1', { name: 'Updated' }, testDb);
    expect(result?.name).toBe('Updated');
    expect(exec.calls[0].sql).toMatch(/update "webhooks" set/i);
    expect(exec.calls[0].sql).toContain('"updated_at"');
    expect(exec.calls[0].params).toContain('Updated');
  });

  test('an empty patch falls back to a findById SELECT (no UPDATE)', async () => {
    exec.enqueue({ rows: [buildRow({ id: 'webhook-1' })] });
    const result = await webhooksRepo.update('webhook-1', {}, testDb);
    expect(result?.id).toBe('webhook-1');
    expect(exec.calls[0].sql).toMatch(/select/i);
  });
});

describe('deleteById', () => {
  test('returns true when a row is returned', async () => {
    exec.enqueue({ rows: [['webhook-1']] });
    expect(await webhooksRepo.deleteById('webhook-1', testDb)).toBe(true);
  });

  test('returns false when nothing was deleted', async () => {
    exec.enqueue({ rows: [] });
    expect(await webhooksRepo.deleteById('missing', testDb)).toBe(false);
  });
});
