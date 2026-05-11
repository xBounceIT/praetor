import { describe, expect, test } from 'bun:test';
import * as constants from '../constants';

describe('constants module', () => {
  test('exports the COLORS palette', () => {
    expect(Array.isArray(constants.COLORS)).toBe(true);
    expect(constants.COLORS.length).toBeGreaterThan(0);
    for (const c of constants.COLORS) {
      expect(c).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  test('does not ship default user fixtures (no hardcoded production passwords)', () => {
    // The old constants.tsx leaked DEFAULT_USERS with literal "password" entries.
    // Those fixtures now live under test/fixtures and must not be reachable from
    // the production-imported module.
    const exported = Object.keys(constants);
    expect(exported).not.toContain('DEFAULT_USERS');
    expect(exported).not.toContain('DEFAULT_CLIENTS');
    expect(exported).not.toContain('DEFAULT_PROJECTS');
    expect(exported).not.toContain('DEFAULT_TASKS');
  });
});
