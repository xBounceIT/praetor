import { describe, expect, test } from 'bun:test';
import type { View } from '../types';
import { buildPermission, getNotFoundReturnView } from '../utils/permissions';

const validViews: View[] = ['timesheets/tracker', 'administration/authentication', 'crm/clients'];

describe('getNotFoundReturnView', () => {
  test('returns authentication settings when the user can access admin auth settings', () => {
    const permissions = [
      buildPermission('timesheets.tracker', 'view'),
      buildPermission('administration.authentication', 'view'),
    ];

    expect(getNotFoundReturnView(permissions, validViews)).toBe('administration/authentication');
  });

  test('falls back to the first accessible default view without auth settings permission', () => {
    const permissions = [buildPermission('crm.clients', 'view')];

    expect(getNotFoundReturnView(permissions, validViews)).toBe('crm/clients');
  });
});
