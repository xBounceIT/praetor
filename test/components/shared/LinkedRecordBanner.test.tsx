import { afterEach, describe, expect, mock, test } from 'bun:test';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { LinkedRecordBanner } from '../../../components/shared/LinkedRecordBanner';

afterEach(() => {
  cleanup();
});

describe('<LinkedRecordBanner />', () => {
  test('renders the label, the value, and the optional note', () => {
    render(
      <LinkedRecordBanner
        label="Source quote"
        value="Q0001"
        note="(Order details are read-only)"
      />,
    );

    expect(screen.getByText('Source quote')).toBeInTheDocument();
    expect(screen.getByText('Q0001')).toBeInTheDocument();
    expect(screen.getByText('(Order details are read-only)')).toBeInTheDocument();
  });

  test('renders a primary action button that calls onClick exactly once', () => {
    const onClick = mock(() => {});
    render(
      <LinkedRecordBanner
        label="Linked order"
        value="SO-100"
        action={{ label: 'View order', onClick }}
      />,
    );

    const button = screen.getByRole('button', { name: /View order/ });
    expect(button).toBeInTheDocument();
    // The shadcn Button must use the PRIMARY (default) variant, not a link.
    expect(button.getAttribute('data-slot')).toBe('button');
    expect(button.getAttribute('data-variant')).toBe('default');
    expect(button.getAttribute('data-variant')).not.toBe('link');

    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  test('renders no button when action is omitted', () => {
    render(<LinkedRecordBanner label="Source quote" value="Q0001" />);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  test('renders no note text when note is omitted', () => {
    render(<LinkedRecordBanner label="Source quote" value="Q0001" />);

    expect(screen.getByText('Source quote')).toBeInTheDocument();
    expect(screen.getByText('Q0001')).toBeInTheDocument();
    expect(screen.queryByText('(Order details are read-only)')).not.toBeInTheDocument();
  });
});
