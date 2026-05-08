import { describe, expect, mock, test } from 'bun:test';
import { fireEvent, render } from '@testing-library/react';

const Checkbox = (await import('../../components/shared/Checkbox')).default;

const getInput = (container: HTMLElement) =>
  container.querySelector('input[type="checkbox"]') as HTMLInputElement;

const getBox = (container: HTMLElement) =>
  container.querySelector('input[type="checkbox"] + div') as HTMLDivElement;

describe('<Checkbox />', () => {
  test('renders an unchecked checkbox by default', () => {
    const { container } = render(<Checkbox checked={false} onChange={() => {}} />);
    const input = getInput(container);
    expect(input).toBeInTheDocument();
    expect(input.checked).toBe(false);
    expect(input.disabled).toBe(false);
  });

  test('renders a checked checkbox when checked is true', () => {
    const { container } = render(<Checkbox checked={true} onChange={() => {}} />);
    const input = getInput(container);
    expect(input.checked).toBe(true);
    // Check the SVG checkmark is visible (scale-100 class)
    const svg = container.querySelector('svg');
    expect(svg?.className).toContain('scale-100');
  });

  test('calls onChange when clicked', () => {
    const onChange = mock((_e: React.ChangeEvent<HTMLInputElement>) => {});
    const { container } = render(<Checkbox checked={false} onChange={onChange} />);
    const input = getInput(container);
    fireEvent.click(input);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  test('disabled prop renders disabled input and not-allowed cursor', () => {
    const { container } = render(<Checkbox checked={false} onChange={() => {}} disabled />);
    const input = getInput(container);
    expect(input.disabled).toBe(true);
    const label = container.querySelector('label');
    expect(label?.className).toContain('cursor-not-allowed');
    expect(label?.className).toContain('opacity-50');
  });

  test('indeterminate state renders the dash indicator (not checked)', () => {
    const { container } = render(<Checkbox checked={false} onChange={() => {}} indeterminate />);
    // No SVG checkmark when indeterminate and not checked
    expect(container.querySelector('svg')).toBeNull();
    // The indicator span is rendered inside the box
    const box = getBox(container);
    expect(box.querySelector('span')).not.toBeNull();
    // The box gets praetor styling
    expect(box.className).toContain('bg-praetor');
  });

  test('checked state takes precedence over indeterminate', () => {
    const { container } = render(<Checkbox checked={true} onChange={() => {}} indeterminate />);
    // SVG is rendered when checked, even with indeterminate true
    expect(container.querySelector('svg')).not.toBeNull();
  });

  test('size sm uses smaller dimension classes', () => {
    const { container } = render(<Checkbox checked={false} onChange={() => {}} size="sm" />);
    const box = getBox(container);
    expect(box.className).toContain('w-3.5');
    expect(box.className).toContain('h-3.5');
  });

  test('size md (default) uses regular dimension classes', () => {
    const { container } = render(<Checkbox checked={false} onChange={() => {}} />);
    const box = getBox(container);
    expect(box.className).toContain('w-5');
    expect(box.className).toContain('h-5');
  });
});
