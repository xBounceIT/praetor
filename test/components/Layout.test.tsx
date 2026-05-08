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

  test('desktop sidebar paints above the sticky page header', () => {
    const { container } = renderLayout();

    const nav = container.querySelector('nav');
    const header = container.querySelector('header');
    const navClasses = nav?.className.split(/\s+/) ?? [];
    const headerClasses = header?.className.split(/\s+/) ?? [];

    expect(navClasses).toContain('z-50');
    expect(headerClasses).toContain('z-40');
  });

  test('collapsed sidebar auto-expands on hover and collapses again on mouse leave', () => {
    const { container } = renderLayout();

    const nav = container.querySelector('nav') as HTMLElement;
    const collapseToggle = container.querySelector('button.hidden.md\\:flex') as HTMLButtonElement;
    expect(nav).not.toBeNull();
    expect(collapseToggle).not.toBeNull();

    fireEvent.click(collapseToggle);
    expect(nav.className).toContain('md:w-20');
    expect(nav.className).not.toContain('md:w-64');

    fireEvent.mouseEnter(nav);
    expect(nav.className).toContain('md:w-64');
    expect(nav.className).not.toContain('md:w-20');
    // Chevron must keep reflecting the pinned state, not the hover-expanded visual.
    expect(collapseToggle.className).toContain('rotate-180');

    fireEvent.mouseLeave(nav);
    expect(nav.className).toContain('md:w-20');
    expect(nav.className).not.toContain('md:w-64');
  });

  test('layout spacer pushes content when sidebar hover-expands', () => {
    const { container } = renderLayout();

    const collapseToggle = container.querySelector('button.hidden.md\\:flex') as HTMLButtonElement;
    const spacer = container.querySelector('div[aria-hidden="true"]') as HTMLElement;
    const nav = container.querySelector('nav') as HTMLElement;
    expect(spacer).not.toBeNull();

    fireEvent.click(collapseToggle);
    expect(spacer.className).toContain('md:w-20');

    fireEvent.mouseEnter(nav);
    expect(spacer.className).toContain('md:w-64');
    expect(spacer.className).not.toContain('md:w-20');

    fireEvent.mouseLeave(nav);
    expect(spacer.className).toContain('md:w-20');
    expect(spacer.className).not.toContain('md:w-64');
  });
});
