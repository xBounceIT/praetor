import { describe, expect, test } from 'bun:test';
import {
  normalizeProjectColor,
  PROJECT_COLOR_PALETTE,
  pickAvailableProjectColor,
} from '../../utils/project-colors.ts';

describe('normalizeProjectColor', () => {
  test('lowercases and expands short hex colors', () => {
    expect(normalizeProjectColor(' #ABC ')).toBe('#aabbcc');
  });
});

describe('pickAvailableProjectColor', () => {
  test('returns the first unused palette color', () => {
    expect(pickAvailableProjectColor(['#ef4444'])).toBe('#f59e0b');
  });

  test('treats existing colors as normalized', () => {
    expect(pickAvailableProjectColor(['#EF4444', '#f90'])).toBe('#f59e0b');
  });

  test('generates a unique hex color after the palette is exhausted', () => {
    const color = pickAvailableProjectColor([...PROJECT_COLOR_PALETTE]);

    expect(color).toMatch(/^#[0-9a-f]{6}$/);
    expect(PROJECT_COLOR_PALETTE).not.toContain(color);
  });
});
