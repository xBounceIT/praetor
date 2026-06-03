import { beforeEach, describe, expect, test } from 'bun:test';
import type { DbExecutor } from '../../db/drizzle.ts';
import * as brandingRepo from '../../repositories/brandingRepo.ts';
import { type FakeExecutor, setupTestDb } from '../helpers/fakeExecutor.ts';

let exec: FakeExecutor;
let testDb: DbExecutor;

beforeEach(() => {
  ({ exec, testDb } = setupTestDb());
});

// SELECT/RETURNING projection column order (Drizzle node-postgres `rowMode: 'array'`):
// [companyName, logoStoredName, logoMimeType, logoFileSize, logoUpdatedAt]
const LOGO_DATE = new Date('2026-01-02T03:04:05.000Z');

// The branding upserts only ever touch the single id=1 row. A second invariant matters for
// correctness: a name write must not clobber the logo columns and vice versa. The guarantee
// lives in the ON CONFLICT ... DO UPDATE SET clause, so the helper isolates exactly that slice.
// (Drizzle lists every table column in the INSERT — unspecified ones as `default` — and the
// RETURNING clause names every projected column, so neither of those is a reliable signal.)
const setClauseOf = (sql: string): string => {
  const lower = sql.toLowerCase();
  const start = lower.indexOf('do update set');
  const end = lower.indexOf('returning', start);
  return lower.slice(start, end === -1 ? undefined : end);
};

describe('get', () => {
  test('returns null when the row does not exist yet', async () => {
    exec.enqueue({ rows: [] });
    const result = await brandingRepo.get(testDb);
    expect(result).toBeNull();
    const sql = exec.calls[0].sql.toLowerCase();
    expect(sql).toContain('select');
    expect(sql).toContain('from "app_branding"');
    expect(sql).toContain('where');
    expect(exec.calls[0].params).toContain(1);
  });

  test('maps the single row to a branding record', async () => {
    exec.enqueue({ rows: [['Acme', 'logo.png', 'image/png', 2048, LOGO_DATE]] });
    const result = await brandingRepo.get(testDb);
    expect(result).toEqual({
      companyName: 'Acme',
      logoStoredName: 'logo.png',
      logoMimeType: 'image/png',
      logoFileSize: 2048,
      logoUpdatedAt: LOGO_DATE,
    });
  });
});

describe('setCompanyName', () => {
  test('upserts the id=1 row and returns the saved name', async () => {
    exec.enqueue({ rows: [['Acme', null, null, null, null]] });
    const result = await brandingRepo.setCompanyName('Acme', testDb);

    const sql = exec.calls[0].sql.toLowerCase();
    expect(sql).toContain('insert into "app_branding"');
    expect(sql).toContain('on conflict');
    expect(sql).toContain('do update');
    // A name-only write must update the name and must not reset the logo columns.
    const setClause = setClauseOf(sql);
    expect(setClause).toContain('company_name');
    expect(setClause).not.toContain('logo_stored_name');
    expect(exec.calls[0].params).toContain('Acme');

    expect(result).toEqual({
      companyName: 'Acme',
      logoStoredName: null,
      logoMimeType: null,
      logoFileSize: null,
      logoUpdatedAt: null,
    });
  });

  test('persists a cleared (null) name and leaves any existing logo intact', async () => {
    exec.enqueue({ rows: [[null, 'logo.png', 'image/png', 2048, LOGO_DATE]] });
    const result = await brandingRepo.setCompanyName(null, testDb);

    const sql = exec.calls[0].sql.toLowerCase();
    expect(sql).toContain('on conflict');
    expect(sql).toContain('do update');
    const setClause = setClauseOf(sql);
    expect(setClause).toContain('company_name');
    expect(setClause).not.toContain('logo_stored_name');
    expect(result.companyName).toBeNull();
    expect(result.logoStoredName).toBe('logo.png');
  });
});

describe('setLogo', () => {
  test('upserts logo metadata, returns it, and does not touch the company name', async () => {
    exec.enqueue({ rows: [['Acme', 'stored.svg', 'image/svg+xml', 512, LOGO_DATE]] });
    const result = await brandingRepo.setLogo(
      { storedName: 'stored.svg', mimeType: 'image/svg+xml', fileSize: 512 },
      testDb,
    );

    const sql = exec.calls[0].sql.toLowerCase();
    expect(sql).toContain('insert into "app_branding"');
    expect(sql).toContain('on conflict');
    expect(sql).toContain('do update');
    // A logo write must update the logo columns and must not reset the company name.
    const setClause = setClauseOf(sql);
    expect(setClause).toContain('logo_stored_name');
    expect(setClause).not.toContain('company_name');
    expect(exec.calls[0].params).toContain('stored.svg');
    expect(exec.calls[0].params).toContain('image/svg+xml');
    expect(exec.calls[0].params).toContain(512);

    expect(result).toEqual({
      companyName: 'Acme',
      logoStoredName: 'stored.svg',
      logoMimeType: 'image/svg+xml',
      logoFileSize: 512,
      logoUpdatedAt: LOGO_DATE,
    });
  });
});

describe('clearLogo', () => {
  test('upserts the logo columns to null and returns the cleared record', async () => {
    exec.enqueue({ rows: [['Acme', null, null, null, null]] });
    const result = await brandingRepo.clearLogo(testDb);

    const sql = exec.calls[0].sql.toLowerCase();
    expect(sql).toContain('on conflict');
    expect(sql).toContain('do update');
    // Clearing the logo must reset the logo columns and preserve the company name.
    const setClause = setClauseOf(sql);
    expect(setClause).toContain('logo_stored_name');
    expect(setClause).not.toContain('company_name');

    expect(result).toEqual({
      companyName: 'Acme',
      logoStoredName: null,
      logoMimeType: null,
      logoFileSize: null,
      logoUpdatedAt: null,
    });
  });
});
