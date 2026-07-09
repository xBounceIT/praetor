import { describe, expect, test } from 'bun:test';
import {
  buildEmployeeCreatePayload,
  buildEmployeeHrPayload,
  createEmployeeHrForm,
} from '../../../components/HR/employeeHrProfile';
import type { User } from '../../../types';

const buildUser = (overrides: Partial<User> = {}): User => ({
  id: 'u1',
  name: 'Alice Smith',
  firstName: 'Alice',
  lastName: 'Smith',
  role: 'user',
  avatarInitials: 'AS',
  username: 'alice',
  email: 'alice@example.com',
  ...overrides,
});

describe('employeeHrProfile first/last name', () => {
  test('createEmployeeHrForm reads firstName and lastName from the user', () => {
    const form = createEmployeeHrForm(buildUser());
    expect(form.firstName).toBe('Alice');
    expect(form.lastName).toBe('Smith');
  });

  test('createEmployeeHrForm defaults missing first/last name to empty strings', () => {
    const form = createEmployeeHrForm(buildUser({ firstName: null, lastName: undefined }));
    expect(form.firstName).toBe('');
    expect(form.lastName).toBe('');
  });

  test('buildEmployeeHrPayload includes trimmed first/last name when identity is editable', () => {
    const form = createEmployeeHrForm(buildUser({ firstName: '  Bob  ', lastName: '  Jones  ' }));
    const payload = buildEmployeeHrPayload(form, { includeIdentity: true, includeCost: false });
    expect(payload.firstName).toBe('Bob');
    expect(payload.lastName).toBe('Jones');
  });

  test('buildEmployeeHrPayload maps blank first/last name to null', () => {
    const form = createEmployeeHrForm(buildUser({ firstName: '', lastName: '   ' }));
    const payload = buildEmployeeHrPayload(form, { includeIdentity: true, includeCost: false });
    expect(payload.firstName).toBeNull();
    expect(payload.lastName).toBeNull();
  });

  test('buildEmployeeHrPayload omits first/last name when identity is read-only (LDAP/SSO-managed)', () => {
    const form = createEmployeeHrForm(buildUser());
    const payload = buildEmployeeHrPayload(form, { includeIdentity: false, includeCost: false });
    expect(payload.firstName).toBeUndefined();
    expect(payload.lastName).toBeUndefined();
  });

  test('buildEmployeeCreatePayload always includes first/last name', () => {
    const form = createEmployeeHrForm(buildUser({ firstName: 'Carol', lastName: 'Doe' }));
    const payload = buildEmployeeCreatePayload(form, { includeCost: false });
    expect(payload.firstName).toBe('Carol');
    expect(payload.lastName).toBe('Doe');
    expect(payload.name).toBe('Alice Smith');
  });

  test('buildEmployeeCreatePayload can omit HR detail fields for create-only access', () => {
    const form = createEmployeeHrForm({
      ...buildUser({
        firstName: 'Carol',
        lastName: 'Doe',
        phone: '+39 02 1234',
        jobTitle: 'Consultant',
        department: 'Legacy Department',
        responsibleUserId: 'u-manager',
        employeeCode: 'EMP-123',
      }),
      costPerHour: 80,
    });
    const payload = buildEmployeeCreatePayload(form, {
      includeCost: false,
      includeHrDetails: false,
    });

    expect(payload).toEqual({
      name: 'Alice Smith',
    });
  });

  test('buildEmployeeHrPayload sends responsibleUserId and omits department', () => {
    const form = createEmployeeHrForm(
      buildUser({ department: 'Legacy Department', responsibleUserId: '  u-manager  ' }),
    );
    const payload = buildEmployeeHrPayload(form, { includeIdentity: false, includeCost: false });

    expect(payload.responsibleUserId).toBe('u-manager');
    expect(payload).not.toHaveProperty('department');
  });

  test('buildEmployeeHrPayload clears responsibleUserId when blank', () => {
    const form = createEmployeeHrForm(buildUser({ responsibleUserId: 'u-manager' }));
    form.responsibleUserId = '   ';

    const payload = buildEmployeeHrPayload(form, { includeIdentity: false, includeCost: false });

    expect(payload.responsibleUserId).toBeNull();
  });
});
