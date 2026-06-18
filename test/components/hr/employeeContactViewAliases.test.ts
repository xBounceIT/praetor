import { describe, expect, test } from 'bun:test';
import {
  mapLegacyContactEmailFilterValue,
  mapLegacyContactPhoneFilterValue,
} from '../../../components/HR/employeeContactViewAliases';

describe('employee contact view aliases', () => {
  test('splits combined legacy contact filter values into email and phone parts', () => {
    const legacyValue = 'alice@example.com +39 02 555 0101';

    expect(mapLegacyContactEmailFilterValue(legacyValue)).toBe('alice@example.com');
    expect(mapLegacyContactPhoneFilterValue(legacyValue)).toBe('+39 02 555 0101');
  });

  test('maps phone-only legacy contact filters to the phone column', () => {
    expect(mapLegacyContactEmailFilterValue('+39 02 555 0101')).toBeNull();
    expect(mapLegacyContactPhoneFilterValue('+39 02 555 0101')).toBe('+39 02 555 0101');
  });

  test('maps email-only legacy contact filters to the email column', () => {
    expect(mapLegacyContactEmailFilterValue('alice@example.com')).toBe('alice@example.com');
    expect(mapLegacyContactPhoneFilterValue('alice@example.com')).toBeNull();
  });
});
