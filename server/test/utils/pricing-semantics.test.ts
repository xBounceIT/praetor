import { describe, expect, test } from 'bun:test';
import {
  CURRENT_PRICING_SEMANTICS_VERSION,
  inheritPricingSemanticsVersions,
  LEGACY_PRICING_SEMANTICS_VERSION,
  normalizeHistoricalPricingSemanticsItems,
  normalizeHistoricalPricingSemanticsVersion,
  preservePricingSemanticsVersions,
  pricingSemanticsVersionForDocument,
} from '../../utils/pricing-semantics.ts';

describe('pricing semantics compatibility', () => {
  test('treats an absent historical snapshot marker as legacy', () => {
    expect(normalizeHistoricalPricingSemanticsVersion(undefined)).toBe(
      LEGACY_PRICING_SEMANTICS_VERSION,
    );
  });

  test('normalizes every item in a historical snapshot', () => {
    const items = normalizeHistoricalPricingSemanticsItems([
      { id: 'legacy', pricingSemanticsVersion: undefined },
      { id: 'current', pricingSemanticsVersion: 2 },
    ]);

    expect(items.map((item) => [item.id, item.pricingSemanticsVersion])).toEqual([
      ['legacy', 1],
      ['current', 2],
    ]);
  });

  test('uses current semantics for a new document and legacy for a historical document', () => {
    expect(pricingSemanticsVersionForDocument([])).toBe(CURRENT_PRICING_SEMANTICS_VERSION);
    expect(pricingSemanticsVersionForDocument([{ pricingSemanticsVersion: 1 }])).toBe(
      LEGACY_PRICING_SEMANTICS_VERSION,
    );
  });

  test('preserves existing ids and makes new rows inherit the document contract', () => {
    const input: Array<{ id: string; pricingSemanticsVersion?: 1 | 2 }> = [
      { id: 'existing' },
      { id: 'new' },
    ];
    const items = preservePricingSemanticsVersions(input, [
      { id: 'existing', pricingSemanticsVersion: 1 },
    ]);

    expect(items.map((item) => [item.id, item.pricingSemanticsVersion])).toEqual([
      ['existing', 1],
      ['new', 1],
    ]);
  });

  test('keeps each stored marker when a historical document has mixed semantics', () => {
    const items = preservePricingSemanticsVersions(
      [{ id: 'legacy' }, { id: 'current' }, { id: 'new' }] as Array<{
        id: string;
        pricingSemanticsVersion?: 1 | 2;
      }>,
      [
        { id: 'legacy', pricingSemanticsVersion: 1 },
        { id: 'current', pricingSemanticsVersion: 2 },
      ],
    );

    expect(items.map((item) => [item.id, item.pricingSemanticsVersion])).toEqual([
      ['legacy', 1],
      ['current', 2],
      ['new', 1],
    ]);
  });

  test('inherits each source marker once and falls back for copied or new rows', () => {
    const items = inheritPricingSemanticsVersions(
      [{ id: 'legacy' }, { id: 'current' }, { id: 'current' }, { id: 'new' }],
      [
        { id: 'legacy', pricingSemanticsVersion: 1 },
        { id: 'current', pricingSemanticsVersion: 2 },
      ],
    );

    expect(items.map((item) => [item.id, item.pricingSemanticsVersion])).toEqual([
      ['legacy', 1],
      ['current', 2],
      ['current', 1],
      ['new', 1],
    ]);
  });

  test('does not overwrite an explicit snapshot marker during restore', () => {
    expect(
      preservePricingSemanticsVersions(
        [{ id: 'restored', pricingSemanticsVersion: 2 }],
        [{ id: 'restored', pricingSemanticsVersion: 1 }],
      ),
    ).toEqual([{ id: 'restored', pricingSemanticsVersion: 2 }]);
  });
});
