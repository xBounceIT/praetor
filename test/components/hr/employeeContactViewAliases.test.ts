import { describe, expect, test } from 'bun:test';
import {
  getEmployeeContactValue,
  mapLegacyContactFilterValue,
} from '../../../components/HR/employeeContactViewAliases';

describe('employee contact view aliases', () => {
  test('builds the legacy combined contact value from email and phone', () => {
    expect(getEmployeeContactValue({ email: 'alice@example.com', phone: '+39 02 555 0101' })).toBe(
      'alice@example.com +39 02 555 0101',
    );
  });

  test('builds legacy values for email-only and phone-only contacts', () => {
    expect(getEmployeeContactValue({ email: 'alice@example.com', phone: '' })).toBe(
      'alice@example.com',
    );
    expect(getEmployeeContactValue({ email: '', phone: '+39 02 555 0101' })).toBe(
      '+39 02 555 0101',
    );
  });

  test('normalizes persisted legacy contact filter values', () => {
    expect(mapLegacyContactFilterValue('  alice@example.com +39 02 555 0101  ')).toBe(
      'alice@example.com +39 02 555 0101',
    );
    expect(mapLegacyContactFilterValue('   ')).toBeNull();
  });
});
