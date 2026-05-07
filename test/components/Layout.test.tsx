import { describe, expect, test } from 'bun:test';
import { fireEvent, render } from '@testing-library/react';
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

const renderLayout = () =>
  render(
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

describe('<Layout />', () => {
  test('header sits at z-40 so it paints above the table sticky-right cells (z-20)', () => {
    const { container } = renderLayout();

    const header = container.querySelector('header');
    expect(header).not.toBeNull();
    const classes = header?.className.split(/\s+/) ?? [];
    expect(classes).toContain('z-40');
    expect(classes).not.toContain('z-20');
  });

  test('collapsed sidebar auto-expands on hover and collapses again on mouse leave', () => {
    const { container } = renderLayout();

    const nav = container.querySelector('nav');
    const collapseToggle = container.querySelector(
      'button.hidden.md\\:flex',
    ) as HTMLButtonElement | null;
    expect(nav).not.toBeNull();
    expect(collapseToggle).not.toBeNull();

    // Pin sidebar to collapsed state.
    fireEvent.click(collapseToggle as HTMLButtonElement);
    expect(nav?.className).toContain('md:w-20');
    expect(nav?.className).not.toContain('md:w-64');

    // Hovering the collapsed sidebar expands it visually without unpinning.
    fireEvent.mouseEnter(nav as HTMLElement);
    expect(nav?.className).toContain('md:w-64');
    expect(nav?.className).not.toContain('md:w-20');
    // Toggle chevron still reflects the pinned (collapsed) state.
    expect(collapseToggle?.className).toContain('rotate-180');

    // Leaving the sidebar collapses it back.
    fireEvent.mouseLeave(nav as HTMLElement);
    expect(nav?.className).toContain('md:w-20');
    expect(nav?.className).not.toContain('md:w-64');
  });

  test('layout spacer keeps content from reflowing when sidebar hover-expands', () => {
    const { container } = renderLayout();

    const collapseToggle = container.querySelector('button.hidden.md\\:flex') as HTMLButtonElement;
    const spacer = container.querySelector('div[aria-hidden="true"]');
    const nav = container.querySelector('nav');
    expect(spacer).not.toBeNull();

    fireEvent.click(collapseToggle);
    expect(spacer?.className).toContain('md:w-20');

    fireEvent.mouseEnter(nav as HTMLElement);
    // Spacer reserves the pinned (collapsed) width even while hover-expanded.
    expect(spacer?.className).toContain('md:w-20');
    expect(spacer?.className).not.toContain('md:w-64');
  });
});
