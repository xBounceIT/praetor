import { describe, expect, mock, test } from 'bun:test';
import { fireEvent, render, screen } from '@testing-library/react';

const Toggle = (await import('../../components/shared/Toggle')).default;

describe('<Toggle />', () => {
  test('renders a switch', () => {
    render(<Toggle checked={false} onChange={() => {}} />);
    expect(screen.getByRole('switch')).toBeInTheDocument();
  });

  test('clicking the toggle calls onChange with the inverted value (off -> on)', () => {
    const onChange = mock((_v: boolean) => {});
    render(<Toggle checked={false} onChange={onChange} />);
    fireEvent.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  test('clicking the toggle when checked sends false (on -> off)', () => {
    const onChange = mock((_v: boolean) => {});
    render(<Toggle checked={true} onChange={onChange} />);
    fireEvent.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledWith(false);
  });

  test('disabled prop disables the switch and keeps shadcn disabled styles', () => {
    render(<Toggle checked={false} onChange={() => {}} disabled />);
    const switchControl = screen.getByRole('switch') as HTMLButtonElement;
    expect(switchControl.disabled).toBe(true);
  });

  test('checked state is exposed accessibly', () => {
    render(<Toggle checked={true} onChange={() => {}} />);
    const switchControl = screen.getByRole('switch');
    expect(switchControl).toHaveAttribute('aria-checked', 'true');
  });

  test('unchecked state is exposed accessibly', () => {
    render(<Toggle checked={false} onChange={() => {}} />);
    const switchControl = screen.getByRole('switch');
    expect(switchControl).toHaveAttribute('aria-checked', 'false');
  });

  test('partial state renders as active while preserving the next checked value', () => {
    const onChange = mock((_v: boolean) => {});
    render(<Toggle checked={false} onChange={onChange} partial />);
    const switchControl = screen.getByRole('switch');
    expect(switchControl).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(switchControl);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  test('disabled toggle does not fire onChange on click', () => {
    const onChange = mock((_v: boolean) => {});
    render(<Toggle checked={false} onChange={onChange} disabled />);
    fireEvent.click(screen.getByRole('switch'));
    expect(onChange).not.toHaveBeenCalled();
  });
});
