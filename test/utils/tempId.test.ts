import { describe, expect, test } from 'bun:test';
import { makeTempId } from '../../utils/tempId';

describe('makeTempId', () => {
  test('uses the default "tmp" prefix when none is provided', () => {
    expect(makeTempId()).toMatch(/^tmp-[0-9a-z]+$/);
  });

  test('uses the supplied prefix', () => {
    expect(makeTempId('row')).toMatch(/^row-[0-9a-z]+$/);
  });

  test('produces base36 random suffix with length up to 7 characters', () => {
    const id = makeTempId('x');
    const suffix = id.slice('x-'.length);
    expect(suffix.length).toBeGreaterThan(0);
    expect(suffix.length).toBeLessThanOrEqual(7);
    expect(suffix).toMatch(/^[0-9a-z]+$/);
  });

  test('returns distinct ids on consecutive calls (random component)', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 50; i++) ids.add(makeTempId());
    // Allow up to one collision in 50 (extremely unlikely with 36^7 space).
    expect(ids.size).toBeGreaterThanOrEqual(49);
  });

  test('accepts an empty prefix and still returns a hyphen-separated id', () => {
    const id = makeTempId('');
    expect(id.startsWith('-')).toBe(true);
  });
});
