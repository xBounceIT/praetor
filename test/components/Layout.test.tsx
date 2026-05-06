import { describe, expect, test } from 'bun:test';
import { render } from '@testing-library/react';
import type { Role, User } from '../../types';
import { installI18nMock } from '../helpers/i18n';

installI18nMock();

const Layout = (await import('../../components/Layout')).default;

const mockUser: User = {
  id: 'u1',
  name: 'Test User',
  role: 'manager',
  avatarInitials: 'TU',
  username: 'testuser',
  permissions: [],
};

const mockRoles: Role[] = [];

describe('<Layout />', () => {
  test('header sits at z-40 so it paints above the table sticky-right cells (z-20)', () => {
    const { container } = render(
      <Layout
        activeView="timesheets/tracker"
        onViewChange={() => {}}
        currentUser={mockUser}
        onLogout={() => {}}
        onSwitchRole={() => {}}
        roles={mockRoles}
      >
        <div>content</div>
      </Layout>,
    );

    const header = container.querySelector('header');
    expect(header).not.toBeNull();
    const classes = header?.className.split(/\s+/) ?? [];
    expect(classes).toContain('z-40');
    expect(classes).not.toContain('z-20');
  });
});
