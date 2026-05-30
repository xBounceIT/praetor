import { describe, expect, mock, test } from 'bun:test';
import { fireEvent, screen } from '@testing-library/react';
import { installI18nMock } from '../helpers/i18n';
import { render } from '../helpers/render';

installI18nMock();

const NotFound = (await import('../../components/NotFound')).default;

describe('<NotFound />', () => {
  test('renders the localized title, message and return action', () => {
    render(<NotFound onReturn={() => {}} />);

    expect(screen.getByText('404')).toBeInTheDocument();
    expect(screen.getByText('notFound.title')).toBeInTheDocument();
    expect(screen.getByText('notFound.message')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'notFound.return' })).toBeInTheDocument();
  });

  test('exposes the title as a level-2 heading for screen readers', () => {
    render(<NotFound onReturn={() => {}} />);

    // EmptyTitle renders a <div>, so it must carry explicit heading semantics
    // to preserve the navigable <h2> the legacy page provided.
    expect(screen.getByRole('heading', { level: 2, name: 'notFound.title' })).toBeInTheDocument();
  });

  test('invokes onReturn when the home button is clicked', () => {
    const onReturn = mock(() => {});
    render(<NotFound onReturn={onReturn} />);

    fireEvent.click(screen.getByRole('button', { name: 'notFound.return' }));

    expect(onReturn).toHaveBeenCalledTimes(1);
  });

  test('uses shadcn theme tokens instead of hardcoded colors', () => {
    render(<NotFound onReturn={() => {}} />);

    // The big 404 marker is themed via muted-foreground, not a fixed zinc shade.
    const marker = screen.getByText('404');
    expect(marker.className).toContain('text-muted-foreground/20');
    expect(marker.className).not.toContain('zinc');

    // The return action is a shadcn Button (primary token), not a bespoke control.
    const button = screen.getByRole('button', { name: 'notFound.return' });
    expect(button.className).toContain('bg-primary');
    expect(button.className).not.toContain('praetor');
  });
});
