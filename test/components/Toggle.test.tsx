import { describe, expect, mock, test } from 'bun:test';
import { fireEvent, render, screen } from '@testing-library/react';

const Toggle = (await import('../../components/shared/Toggle')).default;

describe('<Toggle />', () => {
  test('renders a button', () => {
    render(<Toggle checked={false} onChange={() => {}} />);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  test('clicking the toggle calls onChange with the inverted value (off -> on)', () => {
    const onChange = mock((_v: boolean) => {});
    render(<Toggle checked={false} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  test('clicking the toggle when checked sends false (on -> off)', () => {
    const onChange = mock((_v: boolean) => {});
    render(<Toggle checked={true} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onChange).toHaveBeenCalledWith(false);
  });

  test('disabled prop disables the button and adds disabled styles', () => {
    render(<Toggle checked={false} onChange={() => {}} disabled />);
    const btn = screen.getByRole('button') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.className).toContain('cursor-not-allowed');
    expect(btn.className).toContain('opacity-50');
  });

  test('checked state uses praetor background by default', () => {
    render(<Toggle checked={true} onChange={() => {}} />);
    const btn = screen.getByRole('button');
    expect(btn.className).toContain('bg-praetor');
  });

  test('checked + color="red" uses red background', () => {
    render(<Toggle checked={true} onChange={() => {}} color="red" />);
    const btn = screen.getByRole('button');
    expect(btn.className).toContain('bg-red-500');
  });

  test('unchecked uses slate background', () => {
    render(<Toggle checked={false} onChange={() => {}} />);
    const btn = screen.getByRole('button');
    expect(btn.className).toContain('bg-zinc-200');
  });

  test('partial state renders intermediate background and the partial dash indicator', () => {
    const { container } = render(<Toggle checked={false} onChange={() => {}} partial />);
    const btn = screen.getByRole('button');
    expect(btn.className).toContain('bg-praetor/40');
    const dash = container.querySelector('span > span');
    expect(dash).not.toBeNull();
    const knob = container.querySelector('span');
    expect(knob?.className).toContain('translate-x-5');
  });

  test('disabled toggle does not fire onChange on click', () => {
    const onChange = mock((_v: boolean) => {});
    render(<Toggle checked={false} onChange={onChange} disabled />);
    fireEvent.click(screen.getByRole('button'));
    expect(onChange).not.toHaveBeenCalled();
  });
});
