import { afterEach, describe, expect, mock, test } from 'bun:test';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { LinkedRecordHeaderButton } from '../../../components/shared/LinkedRecordHeaderButton';

afterEach(() => {
  cleanup();
});

describe('<LinkedRecordHeaderButton />', () => {
  test('renders the label and calls onClick when clicked', () => {
    const onClick = mock(() => {});
    render(<LinkedRecordHeaderButton label="View quote" onClick={onClick} />);

    const button = screen.getByRole('button', { name: /View quote/ });
    expect(button).toBeInTheDocument();
    expect(button.getAttribute('data-variant')).toBe('secondary');

    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
