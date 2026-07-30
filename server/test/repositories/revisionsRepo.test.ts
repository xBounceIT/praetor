import { beforeEach, describe, expect, test } from 'bun:test';
import type { DbExecutor } from '../../db/drizzle.ts';
import type { OfferVersionSnapshot } from '../../db/schema/offerVersions.ts';
import type { QuoteVersionSnapshot } from '../../db/schema/quoteVersions.ts';
import type { SupplierQuoteVersionSnapshot } from '../../db/schema/supplierQuoteVersions.ts';
import * as revisionsRepo from '../../repositories/revisionsRepo.ts';
import { type FakeExecutor, setupTestDb } from '../helpers/fakeExecutor.ts';

let exec: FakeExecutor;
let testDb: DbExecutor;

beforeEach(() => {
  ({ exec, testDb } = setupTestDb());
});

const listRow = (id: string, title: string | null) => [
  id,
  2,
  'REV2',
  title,
  'u-1',
  'Alice',
  new Date('2026-07-30T10:00:00Z'),
];

describe('revision title persistence', () => {
  test('projects searchable titles from every revision timeline', async () => {
    exec.enqueue({ rows: [listRow('qr-2', 'Quote renewal')] });
    exec.enqueue({ rows: [listRow('or-2', 'Offer renewal')] });
    exec.enqueue({ rows: [listRow('sqr-2', null)] });

    const quotes = await revisionsRepo.listForQuote('q-1', testDb);
    const offers = await revisionsRepo.listForOffer('o-1', testDb);
    const supplierQuotes = await revisionsRepo.listForSupplierQuote('sq-1', testDb);

    expect(quotes[0].title).toBe('Quote renewal');
    expect(offers[0].title).toBe('Offer renewal');
    expect(supplierQuotes[0].title).toBeNull();
    expect(exec.calls.map((call) => call.sql.toLowerCase())).toEqual([
      expect.stringContaining('from "quote_revisions"'),
      expect.stringContaining('from "offer_revisions"'),
      expect.stringContaining('from "supplier_quote_revisions"'),
    ]);
  });

  test('creates each revision kind without accepting a title at send time', async () => {
    exec.enqueueEmptyN(6);

    await revisionsRepo.insertQuoteAndAdvance(
      {
        objectId: 'q-1',
        revisionNumber: 2,
        revisionCode: 'REV2',
        snapshot: {} as QuoteVersionSnapshot,
        createdByUserId: 'u-1',
      },
      testDb,
    );
    await revisionsRepo.insertOfferAndAdvance(
      {
        objectId: 'o-1',
        revisionNumber: 2,
        revisionCode: 'REV2',
        snapshot: {} as OfferVersionSnapshot,
        createdByUserId: 'u-1',
      },
      testDb,
    );
    await revisionsRepo.insertSupplierQuoteAndAdvance(
      {
        objectId: 'sq-1',
        revisionNumber: 2,
        revisionCode: 'REV2',
        snapshot: {} as SupplierQuoteVersionSnapshot,
        createdByUserId: 'u-1',
      },
      testDb,
    );

    const inserts = exec.calls.filter((call) => call.sql.toLowerCase().startsWith('insert into'));
    expect(inserts).toHaveLength(3);
    expect(inserts[0].sql.toLowerCase()).toContain('insert into "quote_revisions"');
    expect(inserts[0].sql.toLowerCase()).toContain('default');
    expect(inserts[0].params).not.toContain('Quote renewal');
    expect(inserts[1].sql.toLowerCase()).toContain('insert into "offer_revisions"');
    expect(inserts[1].sql.toLowerCase()).toContain('default');
    expect(inserts[1].params).not.toContain('Offer renewal');
    expect(inserts[2].sql.toLowerCase()).toContain('insert into "supplier_quote_revisions"');
    expect(inserts[2].sql.toLowerCase()).toContain('default');
    expect(inserts[2].params).not.toContain('Supplier renewal');
  });

  test('updates titles only within the owning document for every revision kind', async () => {
    exec.enqueue({ rows: [['qr-2', 'Quote renewal']] });
    exec.enqueue({ rows: [['or-2', 'Offer renewal']] });
    exec.enqueue({ rows: [['sqr-2', null]] });

    await expect(
      revisionsRepo.updateQuoteTitle('q-1', 'qr-2', 'Quote renewal', testDb),
    ).resolves.toEqual({ id: 'qr-2', title: 'Quote renewal' });
    await expect(
      revisionsRepo.updateOfferTitle('o-1', 'or-2', 'Offer renewal', testDb),
    ).resolves.toEqual({ id: 'or-2', title: 'Offer renewal' });
    await expect(
      revisionsRepo.updateSupplierQuoteTitle('sq-1', 'sqr-2', null, testDb),
    ).resolves.toEqual({ id: 'sqr-2', title: null });

    expect(exec.calls).toHaveLength(3);
    expect(exec.calls[0].sql.toLowerCase()).toContain('update "quote_revisions"');
    expect(exec.calls[0].params).toEqual(expect.arrayContaining(['Quote renewal', 'q-1', 'qr-2']));
    expect(exec.calls[1].sql.toLowerCase()).toContain('update "offer_revisions"');
    expect(exec.calls[1].params).toEqual(expect.arrayContaining(['Offer renewal', 'o-1', 'or-2']));
    expect(exec.calls[2].sql.toLowerCase()).toContain('update "supplier_quote_revisions"');
    expect(exec.calls[2].params).toEqual(expect.arrayContaining([null, 'sq-1', 'sqr-2']));
  });

  test('returns null when the revision does not belong to the requested document', async () => {
    exec.enqueue({ rows: [] });

    await expect(
      revisionsRepo.updateOfferTitle('another-offer', 'or-2', 'Wrong owner', testDb),
    ).resolves.toBeNull();
  });
});
