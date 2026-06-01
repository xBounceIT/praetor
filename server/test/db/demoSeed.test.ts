import { describe, expect, test } from 'bun:test';
import { selectDemoUserCleanupIds } from '../../db/demoSeed.ts';
import { DEMO_USERS } from '../../db/demoSeedManifest.ts';

const CONTRACT_TYPES = new Set([
  'permanent',
  'fixed_term',
  'contractor',
  'internship',
  'consultant',
  'other',
]);
const EMPLOYMENT_STATUSES = new Set(['active', 'onboarding', 'on_leave', 'terminated']);
const WORK_LOCATIONS = new Set(['office', 'remote', 'hybrid', 'customer_site', 'other']);

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

describe('DEMO_USERS HR profiles', () => {
  test('seeded users cover HR screens with complete operational profile data', () => {
    const employeeTypes = new Set(DEMO_USERS.map((user) => user.employeeType));
    expect(employeeTypes).toEqual(new Set(['app_user', 'internal', 'external']));

    const employeeCodes = DEMO_USERS.map((user) => user.employeeCode);
    expect(new Set(employeeCodes).size).toBe(employeeCodes.length);

    for (const user of DEMO_USERS) {
      expect(user.phone).toMatch(/^\+39 /);
      expect(user.jobTitle.trim()).not.toBe('');
      expect(user.department.trim()).not.toBe('');
      expect(user.employeeCode).toMatch(/^(EMP|EXT)-\d{3}$/);
      expect(user.hireDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(CONTRACT_TYPES.has(user.contractType)).toBe(true);
      expect(EMPLOYMENT_STATUSES.has(user.employmentStatus)).toBe(true);
      expect(WORK_LOCATIONS.has(user.workLocation)).toBe(true);
      expect(user.emergencyContactName.trim()).not.toBe('');
      expect(user.emergencyContactPhone).toMatch(/^\+39 /);
      expect(user.notes.trim()).not.toBe('');
      if (user.terminationDate !== null) {
        expect(user.terminationDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(user.hireDate <= user.terminationDate).toBe(true);
      }
    }
  });
});
