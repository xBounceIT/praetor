import { describe, expect, test } from 'bun:test';
import { screen } from '@testing-library/react';
import MemberAvatarGroup from '../../../components/shared/MemberAvatarGroup';
import { render } from '../../helpers/render';

const makeMembers = (count: number) =>
  Array.from({ length: count }, (_, i) => ({ id: `u-${i + 1}`, name: `Member ${i + 1}` }));

describe('<MemberAvatarGroup />', () => {
  test('renders first+last initials with the full name as accessible label', () => {
    render(<MemberAvatarGroup members={[{ id: 'u-1', name: 'Andrea Scognamiglio' }]} />);
    expect(screen.getByText('AS')).toBeInTheDocument();
    expect(screen.getByLabelText('Andrea Scognamiglio')).toBeInTheDocument();
  });

  test('renders the first two letters for a single-word member name', () => {
    render(<MemberAvatarGroup members={[{ id: 'u-1', name: 'Madonna' }]} />);
    expect(screen.getByText('MA')).toBeInTheDocument();
  });

  test('shows every member inline and no overflow badge when within the limit', () => {
    render(<MemberAvatarGroup members={makeMembers(3)} />);
    expect(screen.getAllByRole('img')).toHaveLength(3);
    expect(screen.queryByText(/^\+/)).not.toBeInTheDocument();
  });

  test('collapses the remainder into a +N badge once the limit is exceeded', () => {
    // 7 members, default max 5 → 5 inline avatars (role="img") + a "+2" overflow badge.
    render(<MemberAvatarGroup members={makeMembers(7)} />);
    expect(screen.getByText('+2')).toBeInTheDocument();
    expect(screen.getAllByRole('img')).toHaveLength(5);
  });

  test('the overflow badge is a keyboard-focusable button labelled with only the hidden members', () => {
    render(<MemberAvatarGroup members={makeMembers(7)} />);
    // A <button> is inherently focusable, so the full-roster tooltip is reachable by keyboard.
    const badge = screen.getByRole('button', { name: 'Member 6, Member 7' });
    expect(badge).toHaveTextContent('+2');
    // The 5 visible avatars are NOT re-announced by the badge label.
    expect(badge.getAttribute('aria-label')).not.toContain('Member 1');
  });

  test('honours a custom max', () => {
    render(<MemberAvatarGroup members={makeMembers(3)} max={2} />);
    expect(screen.getByText('+1')).toBeInTheDocument();
    // 2 inline avatars; the 3rd member is collapsed into the badge.
    expect(screen.getAllByRole('img')).toHaveLength(2);
  });

  test('renders nothing for an empty member list', () => {
    const { container } = render(<MemberAvatarGroup members={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
