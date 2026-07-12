import { describe, expect, test } from 'bun:test';
import StatusBadge, { type StatusType } from '../../../components/shared/StatusBadge';
import { render } from '../../helpers/render';

const ALL_TYPES: StatusType[] = [
  'active',
  'disabled',
  'inherited',
  'expired',
  'pending',
  'draft',
  'sent',
  'accepted',
  'denied',
  'confirmed',
  'paid',
  'overdue',
  'cancelled',
  'supply',
  'service',
  'consulting',
  'item',
  'internal',
  'external',
  'app_user',
  'experimental',
  'company',
  'individual',
  'office',
  'customer_premise',
  'remote',
  'transfer',
  'recurrence',
  'role_admin',
  'role_top_manager',
  'role_manager',
  'role_custom',
  'role_user',
  'auth_local',
  'auth_ldap',
  'auth_oidc',
  'auth_saml',
];

describe('<StatusBadge /> dark-mode contrast', () => {
  test.each(ALL_TYPES)('type "%s" defines dark-mode color variants', (type) => {
    const { container } = render(<StatusBadge type={type} label={type} />);
    const badge = container.querySelector('[data-status-badge]');
    expect(badge).not.toBeNull();
    const className = badge?.className ?? '';
    expect(className).toContain('dark:bg-');
    expect(className).toContain('dark:text-');
    expect(className).toContain('dark:border-');
  });

  test('uses font-relative spacing so the whole badge scales with its text', () => {
    const { container } = render(<StatusBadge type="active" label="Active" />);
    const badge = container.querySelector('[data-status-badge]');
    const className = badge?.className ?? '';

    expect(className).toContain('gap-[0.6em]');
    expect(className).toContain('rounded-[0.8em]');
    expect(className).toContain('px-[1em]');
    expect(className).toContain('py-[0.4em]');
    expect(className).toContain('text-[10px]');
    expect(className).not.toMatch(/\b(?:gap-1\.5|rounded-lg|px-2\.5|py-1)\b/);
  });
});
