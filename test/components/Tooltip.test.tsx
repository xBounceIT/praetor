import { describe, expect, test } from 'bun:test';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';

const Tooltip = (await import('../../components/shared/Tooltip')).default;

describe('<Tooltip />', () => {
  test('renders children only when not hovered', () => {
    render(<Tooltip label="Tip text">{() => <button type="button">trigger</button>}</Tooltip>);
    expect(screen.getByRole('button', { name: 'trigger' })).toBeInTheDocument();
    expect(screen.queryByText('Tip text')).toBeNull();
  });

  test('shows tooltip label on mouse enter and hides on mouse leave', () => {
    const { container } = render(
      <Tooltip label="Tip text">{() => <button type="button">trigger</button>}</Tooltip>,
    );
    const wrapper = container.querySelector('span') as HTMLElement;
    fireEvent.mouseEnter(wrapper);
    expect(screen.getByText('Tip text')).toBeInTheDocument();
    fireEvent.mouseLeave(wrapper);
    expect(screen.queryByText('Tip text')).toBeNull();
  });

  test('shows tooltip on focus and hides on blur', () => {
    const { container } = render(
      <Tooltip label="Focus tip">{() => <button type="button">trigger</button>}</Tooltip>,
    );
    const wrapper = container.querySelector('span') as HTMLElement;
    fireEvent.focus(wrapper);
    expect(screen.getByText('Focus tip')).toBeInTheDocument();
    fireEvent.blur(wrapper);
    expect(screen.queryByText('Focus tip')).toBeNull();
  });

  test('does not render tooltip when disabled (children returned directly)', () => {
    const { container } = render(
      <Tooltip label="Tip text" disabled>
        {() => <button type="button">trigger</button>}
      </Tooltip>,
    );
    fireEvent.mouseEnter(screen.getByRole('button', { name: 'trigger' }));
    expect(screen.queryByText('Tip text')).toBeNull();
    expect(container.querySelector('span')).toBeNull();
  });

  test('does not render tooltip when label is empty string', () => {
    render(<Tooltip label="">{() => <button type="button">trigger</button>}</Tooltip>);
    fireEvent.mouseEnter(screen.getByRole('button', { name: 'trigger' }));
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  test('does not render tooltip when label is null (children returned directly)', () => {
    render(<Tooltip label={null}>{() => <button type="button">trigger</button>}</Tooltip>);
    fireEvent.mouseEnter(screen.getByRole('button', { name: 'trigger' }));
    expect(screen.getByRole('button', { name: 'trigger' })).toBeInTheDocument();
  });

  test('renders ReactNode label content', () => {
    const { container } = render(
      <Tooltip label={<span data-testid="custom-label">Rich</span>}>
        {() => <button type="button">trigger</button>}
      </Tooltip>,
    );
    const wrapper = container.querySelector('span') as HTMLElement;
    fireEvent.mouseEnter(wrapper);
    expect(screen.getByTestId('custom-label')).toBeInTheDocument();
  });

  test('applies wrapperClassName to the wrapper span', () => {
    const { container } = render(
      <Tooltip label="Tip" wrapperClassName="my-wrapper">
        {() => <button type="button">trigger</button>}
      </Tooltip>,
    );
    const wrapper = container.querySelector('span') as HTMLElement;
    expect(wrapper.className).toContain('my-wrapper');
  });

  test('applies tooltipClassName when shown', () => {
    const { container } = render(
      <Tooltip label="Tip" tooltipClassName="my-tooltip">
        {() => <button type="button">trigger</button>}
      </Tooltip>,
    );
    const wrapper = container.querySelector('span') as HTMLElement;
    fireEvent.mouseEnter(wrapper);
    const tip = screen.getByText('Tip');
    expect(tip.className).toContain('my-tooltip');
  });

  test('applies position-specific classes for "bottom"', () => {
    const { container } = render(
      <Tooltip label="Tip" position="bottom">
        {() => <button type="button">trigger</button>}
      </Tooltip>,
    );
    const wrapper = container.querySelector('span') as HTMLElement;
    fireEvent.mouseEnter(wrapper);
    const tip = screen.getByText('Tip');
    expect(tip.className).toContain('-translate-x-1/2');
  });

  test('applies position-specific classes for "right"', () => {
    const { container } = render(
      <Tooltip label="Tip" position="right">
        {() => <button type="button">trigger</button>}
      </Tooltip>,
    );
    const wrapper = container.querySelector('span') as HTMLElement;
    fireEvent.mouseEnter(wrapper);
    const tip = screen.getByText('Tip');
    expect(tip.className).toContain('-translate-y-1/2');
  });

  test('auto-flips "left" to "right" when the wrapper is at the viewport edge', () => {
    // happy-dom places the wrapper at x=0, which would push the tooltip off
    // screen on the left, so the component flips to "right".
    const { container } = render(
      <Tooltip label="Tip" position="left">
        {() => <button type="button">trigger</button>}
      </Tooltip>,
    );
    const wrapper = container.querySelector('span') as HTMLElement;
    fireEvent.mouseEnter(wrapper);
    const tip = screen.getByText('Tip');
    expect(tip.className).toContain('-translate-y-1/2');
  });

  test('clicking outside hides the tooltip', () => {
    const { container } = render(
      <div>
        <div data-testid="outside">outside</div>
        <Tooltip label="Tip text">{() => <button type="button">trigger</button>}</Tooltip>
      </div>,
    );
    const wrapper = container.querySelector('span') as HTMLElement;
    fireEvent.mouseEnter(wrapper);
    expect(screen.getByText('Tip text')).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(screen.queryByText('Tip text')).toBeNull();
  });

  test('disabling a visible tooltip clears it before re-enabling', () => {
    const Harness = () => {
      const [disabled, setDisabled] = useState(false);
      return (
        <div>
          <div data-testid="outside" onMouseDown={() => setDisabled(false)}>
            outside
          </div>
          <Tooltip label="Gear tip" disabled={disabled}>
            {() => (
              <button type="button" onClick={() => setDisabled(true)}>
                gear
              </button>
            )}
          </Tooltip>
        </div>
      );
    };

    const { container } = render(<Harness />);
    const wrapper = container.querySelector('span') as HTMLElement;
    fireEvent.mouseEnter(wrapper);
    expect(screen.getByText('Gear tip')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'gear' }));
    expect(screen.queryByText('Gear tip')).toBeNull();

    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(screen.queryByText('Gear tip')).toBeNull();
  });
});
