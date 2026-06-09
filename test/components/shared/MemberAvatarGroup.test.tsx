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
    // 7 members, default max 5 → 5 initials + a "+2" overflow badge.
    render(<MemberAvatarGroup members={makeMembers(7)} />);
    expect(screen.getByText('+2')).toBeInTheDocument();
    // 5 visible avatars + the overflow badge are all role="img".
    expect(screen.getAllByRole('img')).toHaveLength(6);
  });

  test('the overflow badge exposes the full membership for hover/screen readers', () => {
    render(<MemberAvatarGroup members={makeMembers(7)} />);
    // "Member 7" is hidden from the inline row, so the only element naming it is the badge.
    expect(screen.getByLabelText(/Member 7/)).toHaveTextContent('+2');
  });

  test('honours a custom max', () => {
    render(<MemberAvatarGroup members={makeMembers(3)} max={2} />);
    expect(screen.getByText('+1')).toBeInTheDocument();
    expect(screen.getAllByRole('img')).toHaveLength(3);
  });

  test('renders nothing for an empty member list', () => {
    const { container } = render(<MemberAvatarGroup members={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
