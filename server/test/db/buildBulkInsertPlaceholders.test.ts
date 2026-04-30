import { describe, expect, test } from 'bun:test';
import { buildBulkInsertPlaceholders } from '../../db/index.ts';

describe('buildBulkInsertPlaceholders', () => {
  test('single row defaults to $1..$N', () => {
    expect(buildBulkInsertPlaceholders(1, 3)).toBe('($1, $2, $3)');
  });

  test('multiple rows continue numbering across rows', () => {
    expect(buildBulkInsertPlaceholders(2, 3)).toBe('($1, $2, $3), ($4, $5, $6)');
  });

  test('startIndex shifts the starting placeholder', () => {
    // Used by mapSaleItemsToSupplierItems where $1, $2 are reserved for parent ids.
    expect(buildBulkInsertPlaceholders(2, 2, 3)).toBe('($3, $4), ($5, $6)');
  });

  test('startIndex with single row', () => {
    expect(buildBulkInsertPlaceholders(1, 4, 5)).toBe('($5, $6, $7, $8)');
  });

  test('zero rows produces an empty string', () => {
    expect(buildBulkInsertPlaceholders(0, 5)).toBe('');
    expect(buildBulkInsertPlaceholders(0, 5, 7)).toBe('');
  });
});
