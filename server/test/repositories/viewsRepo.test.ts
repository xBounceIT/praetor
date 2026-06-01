import { beforeEach, describe, expect, test } from 'bun:test';
import type { DbExecutor } from '../../db/drizzle.ts';
import * as viewsRepo from '../../repositories/viewsRepo.ts';
import { makeDbError } from '../helpers/dbErrors.ts';
import { type FakeExecutor, setupTestDb } from '../helpers/fakeExecutor.ts';

const {
  create,
  deleteById,
  findAccess,
  getShares,
  getViewKind,
  listForUser,
  replaceShares,
  update,
} = viewsRepo;

let exec: FakeExecutor;
let testDb: DbExecutor;

beforeEach(() => {
  ({ exec, testDb } = setupTestDb());
});

const findCall = (predicate: (sql: string) => boolean) => exec.calls.find((c) => predicate(c.sql));

// `listForUser`/`findAccess`/`fetchViewById` use raw `sql` with named column aliases via
// `executeRows`, so the fake returns object rows keyed by the alias (mirrors the actual driver).
const OWN_VIEW_ROW = {
  id: 'sv-own',
  ownerId: 'u-1',
  ownerName: 'Alice',
  kind: 'table',
  scopeKey: 'projects.directory',
  name: 'Alpha',
  config: { hiddenColIds: [], sortState: null, filterState: {} },
  access: 'owner',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
};

const SHARED_VIEW_ROW = {
  id: 'sv-shared',
  ownerId: 'u-2',
  ownerName: 'Bob',
  kind: 'table',
  scopeKey: 'projects.directory',
  name: 'Beta',
  config: { hiddenColIds: ['col-x'], sortState: null, filterState: {} },
  access: 'write',
  createdAt: '2026-01-03T00:00:00.000Z',
  updatedAt: '2026-01-04T00:00:00.000Z',
};

describe('listForUser', () => {
  test('returns own (access owner) + shared (access from share permission) views for the scope', async () => {
    exec.enqueue({ rows: [OWN_VIEW_ROW, SHARED_VIEW_ROW] });

    const result = await listForUser('u-1', 'table', 'projects.directory', testDb);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ id: 'sv-own', ownerName: 'Alice', access: 'owner' });
    expect(result[1]).toMatchObject({ id: 'sv-shared', ownerName: 'Bob', access: 'write' });
    // Timestamps are mapped to epoch ms.
    expect(result[0].createdAt).toBe(new Date('2026-01-01T00:00:00.000Z').getTime());
    expect(result[1].updatedAt).toBe(new Date('2026-01-04T00:00:00.000Z').getTime());
  });

  test('queries both arms scoped by userId, kind and scopeKey', async () => {
    exec.enqueue({ rows: [] });
    await listForUser('u-1', 'table', 'projects.directory', testDb);

    const sql = exec.calls[0].sql.toLowerCase();
    // Own arm + shared arm, UNIONed.
    expect(sql).toContain('union all');
    expect(sql).toContain('saved_views');
    expect(sql).toContain('saved_view_shares');
    expect(exec.calls[0].params).toContain('u-1');
    expect(exec.calls[0].params).toContain('table');
    expect(exec.calls[0].params).toContain('projects.directory');
  });

  test('returns an empty list when nothing matches', async () => {
    exec.enqueue({ rows: [] });
    expect(await listForUser('u-1', 'dashboard', 'project-analytics', testDb)).toEqual([]);
  });
});

describe('findAccess', () => {
  test('owner → access "owner"', async () => {
    exec.enqueue({ rows: [{ ownerId: 'u-1', permission: null }] });
    expect(await findAccess('sv-1', 'u-1', testDb)).toEqual({ ownerId: 'u-1', access: 'owner' });
  });

  test('read share recipient → access "read"', async () => {
    exec.enqueue({ rows: [{ ownerId: 'u-2', permission: 'read' }] });
    expect(await findAccess('sv-1', 'u-1', testDb)).toEqual({ ownerId: 'u-2', access: 'read' });
  });

  test('write share recipient → access "write"', async () => {
    exec.enqueue({ rows: [{ ownerId: 'u-2', permission: 'write' }] });
    expect(await findAccess('sv-1', 'u-1', testDb)).toEqual({ ownerId: 'u-2', access: 'write' });
  });

  test('stranger (no share) → ownerId present, access null (403, not 404)', async () => {
    exec.enqueue({ rows: [{ ownerId: 'u-2', permission: null }] });
    expect(await findAccess('sv-1', 'u-1', testDb)).toEqual({ ownerId: 'u-2', access: null });
  });

  test('missing view → ownerId null, access null (404)', async () => {
    exec.enqueue({ rows: [] });
    expect(await findAccess('ghost', 'u-1', testDb)).toEqual({ ownerId: null, access: null });
  });
});

describe('getViewKind', () => {
  test('returns the view kind via a query-builder select (positional row)', async () => {
    exec.enqueue({ rows: [['dashboard']] });
    expect(await getViewKind('sv-1', testDb)).toBe('dashboard');
  });

  test('returns null when the id does not exist', async () => {
    exec.enqueue({ rows: [] });
    expect(await getViewKind('ghost', testDb)).toBeNull();
  });
});

describe('create', () => {
  test('inserts the view then re-reads it (owner perspective) and bumps timestamps', async () => {
    exec.enqueue({ rows: [], rowCount: 1 }); // INSERT
    exec.enqueue({ rows: [{ ...OWN_VIEW_ROW, id: 'sv-new', name: 'Created' }] }); // fetchViewById

    const created = await create(
      {
        id: 'sv-new',
        ownerId: 'u-1',
        kind: 'table',
        scopeKey: 'projects.directory',
        name: 'Created',
        config: { hiddenColIds: [], sortState: null, filterState: {} },
      },
      testDb,
    );

    expect(created).toMatchObject({ id: 'sv-new', name: 'Created', access: 'owner' });
    expect(exec.calls[0].sql.toLowerCase()).toContain('insert into "saved_views"');
    // The re-read is the second statement and carries the new id.
    expect(exec.calls[1].params).toContain('sv-new');
    // updatedAt is materialized as an epoch number on the returned domain shape.
    expect(typeof created.updatedAt).toBe('number');
  });
});

describe('update', () => {
  test('bumps updated_at and applies name/config, returning the refreshed view', async () => {
    exec.enqueue({ rows: [], rowCount: 1 }); // UPDATE
    exec.enqueue({ rows: [{ ...OWN_VIEW_ROW, name: 'Renamed' }] }); // fetchViewById

    const updated = await update('sv-own', { name: 'Renamed' }, testDb);

    expect(updated).toMatchObject({ id: 'sv-own', name: 'Renamed', access: 'owner' });
    const updateSql = exec.calls[0].sql.toLowerCase();
    expect(updateSql).toContain('update "saved_views"');
    // Every update bumps updated_at.
    expect(updateSql).toContain('updated_at');
    expect(exec.calls[0].params).toContain('Renamed');
  });

  test('returns null when no row matched (id no longer exists)', async () => {
    exec.enqueue({ rows: [], rowCount: 0 }); // UPDATE matched nothing
    expect(await update('ghost', { name: 'X' }, testDb)).toBeNull();
    // No re-read fires when the UPDATE matched zero rows.
    expect(exec.calls).toHaveLength(1);
  });
});

describe('deleteById', () => {
  // The DB-level cascade (saved_view_shares.view_id → saved_views.id ON DELETE CASCADE) means the
  // repo issues a single DELETE on saved_views; shares are removed by the FK cascade, not a second
  // statement.
  test('issues a single DELETE on saved_views and reports a hit', async () => {
    exec.enqueue({ rows: [], rowCount: 1 });
    const deleted = await deleteById('sv-own', testDb);

    expect(deleted).toBe(true);
    expect(exec.calls).toHaveLength(1);
    expect(exec.calls[0].sql.toLowerCase()).toContain('delete from "saved_views"');
    expect(exec.calls[0].params).toContain('sv-own');
  });

  test('returns false when nothing was deleted', async () => {
    exec.enqueue({ rows: [], rowCount: 0 });
    expect(await deleteById('ghost', testDb)).toBe(false);
  });
});

describe('getShares', () => {
  test('returns the view shares as { userId, permission } (positional rows)', async () => {
    exec.enqueue({
      rows: [
        ['u-2', 'read'],
        ['u-3', 'write'],
      ],
    });

    const shares = await getShares('sv-own', testDb);

    expect(shares).toEqual([
      { userId: 'u-2', permission: 'read' },
      { userId: 'u-3', permission: 'write' },
    ]);
    expect(exec.calls[0].params).toContain('sv-own');
  });

  test('returns an empty list when there are no shares', async () => {
    exec.enqueue({ rows: [] });
    expect(await getShares('sv-own', testDb)).toEqual([]);
  });
});

describe('replaceShares', () => {
  // Atomic delete-all-then-insert: the whole pair must flow through the supplied executor so a
  // failing INSERT rolls back the DELETE. `runAtomically` reuses the passed exec (no nesting), so
  // both statements land on the same fake — assertable directly.
  test('deletes all existing shares then bulk-inserts the new set', async () => {
    exec.enqueue({ rows: [], rowCount: 2 }); // DELETE
    exec.enqueue({ rows: [], rowCount: 2 }); // INSERT

    await replaceShares(
      'sv-own',
      [
        { userId: 'u-2', permission: 'read' },
        { userId: 'u-3', permission: 'write' },
      ],
      testDb,
    );

    expect(exec.calls).toHaveLength(2);
    expect(exec.calls[0].sql.toLowerCase()).toContain('delete from "saved_view_shares"');
    expect(exec.calls[0].params).toContain('sv-own');
    expect(exec.calls[1].sql.toLowerCase()).toContain('insert into "saved_view_shares"');
    expect(exec.calls[1].params).toEqual(
      expect.arrayContaining(['sv-own', 'u-2', 'read', 'u-3', 'write']),
    );
  });

  test('only issues the DELETE when the share list is empty (clears all shares)', async () => {
    exec.enqueue({ rows: [], rowCount: 3 }); // DELETE only

    await replaceShares('sv-own', [], testDb);

    expect(exec.calls).toHaveLength(1);
    expect(exec.calls[0].sql.toLowerCase()).toContain('delete from "saved_view_shares"');
  });

  test('dedupes on userId so a duplicate cannot violate the PK (last permission wins)', async () => {
    exec.enqueue({ rows: [], rowCount: 1 }); // DELETE
    exec.enqueue({ rows: [], rowCount: 1 }); // INSERT

    await replaceShares(
      'sv-own',
      [
        { userId: 'u-2', permission: 'read' },
        { userId: 'u-2', permission: 'write' },
      ],
      testDb,
    );

    const insert = exec.calls[1];
    // A single row inserted for u-2 with the last (write) permission.
    expect(insert.params).toEqual(['sv-own', 'u-2', 'write']);
  });

  // A FK violation on an unknown userId (SQLSTATE 23503) propagates so the route can translate it
  // to a 400. The DELETE and the failing INSERT both run on the supplied exec, so wrapping the call
  // in a transaction rolls the DELETE back.
  test('propagates a FK violation when a share recipient does not exist', async () => {
    exec.enqueue({ rows: [], rowCount: 1 }); // DELETE
    exec.enqueue(() => {
      throw makeDbError('23503', 'saved_view_shares_user_id_users_id_fk');
    });

    await expect(
      replaceShares('sv-own', [{ userId: 'ghost', permission: 'read' }], testDb),
    ).rejects.toThrow();

    expect(exec.calls).toHaveLength(2);
    expect(exec.calls[0].sql.toLowerCase()).toContain('delete from "saved_view_shares"');
    expect(findCall((s) => /insert into "saved_view_shares"/i.test(s))).toBeDefined();
  });
});
