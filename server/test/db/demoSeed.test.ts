import { describe, expect, test } from 'bun:test';
import { selectDemoUserCleanupIds } from '../../db/demoSeed.ts';

describe('selectDemoUserCleanupIds', () => {
  test('preserves canonical demo users so cascading user data survives demo reseed', () => {
    expect(
      selectDemoUserCleanupIds([{ id: 'u2' }, { id: 'u3' }, { id: 'legacy-manager' }]),
    ).toEqual({
      dependentUserIds: ['u2', 'u3', 'legacy-manager'],
      userIdsToDelete: ['legacy-manager'],
    });
  });
});
