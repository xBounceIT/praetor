import { describe, expect, mock, test } from 'bun:test';
import { fireEvent, render } from '@testing-library/react';
import { useState } from 'react';

const ValidatedNumberInput = (await import('../../components/shared/ValidatedNumberInput')).default;

const getInput = (container: HTMLElement) => container.querySelector('input') as HTMLInputElement;

describe('<ValidatedNumberInput />', () => {
  test('renders an input with type="text", inputMode="decimal" and pattern', () => {
    const { container } = render(<ValidatedNumberInput value="" onValueChange={() => {}} />);
    const input = getInput(container);
    expect(input.type).toBe('text');
    expect(input.inputMode).toBe('decimal');
    expect(input.getAttribute('pattern')).toBe(
      '^(?:[0-9]{1,3}(?:\\.[0-9]{3})*|[0-9]*)(?:,[0-9]*)?$',
    );
  });

  test('displays a numeric value when not focused', () => {
    const { container } = render(<ValidatedNumberInput value="42" onValueChange={() => {}} />);
    const input = getInput(container);
    expect(input.value).toBe('42');
  });

  test('formats display value with formatDecimals when not focused', () => {
    const { container } = render(
      <ValidatedNumberInput value={3.5} onValueChange={() => {}} formatDecimals={2} />,
    );
    const input = getInput(container);
    expect(input.value).toBe('3,50');
  });

  test('formatDecimals: empty string yields empty display', () => {
    const { container } = render(
      <ValidatedNumberInput value="" onValueChange={() => {}} formatDecimals={2} />,
    );
    expect(getInput(container).value).toBe('');
  });

  test('formatDecimals: invalid value yields empty display', () => {
    const { container } = render(
      <ValidatedNumberInput value="abc" onValueChange={() => {}} formatDecimals={2} />,
    );
    expect(getInput(container).value).toBe('');
  });

  test('typing valid digits triggers onValueChange with normalized value', () => {
    const onValueChange = mock((_v: string) => {});
    const Wrapper = () => {
      const [v, setV] = useState('');
      return (
        <ValidatedNumberInput
          value={v}
          onValueChange={(val) => {
            setV(val);
            onValueChange(val);
          }}
        />
      );
    };
    const { container } = render(<Wrapper />);
    const input = getInput(container);
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '12' } });
    expect(onValueChange).toHaveBeenLastCalledWith('12');
  });

  test('comma stays visible and is normalized to dot in onValueChange', () => {
    const onValueChange = mock((_v: string) => {});
    const { container } = render(<ValidatedNumberInput value="" onValueChange={onValueChange} />);

    const input = getInput(container);
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '1,5' } });
    expect(onValueChange).toHaveBeenCalledWith('1.5');
    expect(input.value).toBe('1,5');
  });

  test('accepts dots only as Italian thousands separators', () => {
    const onValueChange = mock((_v: string) => {});
    const { container } = render(<ValidatedNumberInput value="" onValueChange={onValueChange} />);
    const input = getInput(container);
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '1.234,56' } });
    expect(onValueChange).toHaveBeenCalledWith('1234.56');
    expect(input.value).toBe('1.234,56');
    fireEvent.change(input, { target: { value: '1.234' } });
    expect(onValueChange).toHaveBeenLastCalledWith('1234');
    expect(input.value).toBe('1.234');
  });

  test('accepts localized negative values only when explicitly enabled', () => {
    const onValueChange = mock((_v: string) => {});
    const { container } = render(
      <ValidatedNumberInput value="" onValueChange={onValueChange} allowNegative />,
    );
    const input = getInput(container);

    fireEvent.focus(input);
    expect(fireEvent.keyDown(input, { key: '-' })).toBe(true);
    fireEvent.change(input, { target: { value: '-1.234,5' } });

    expect(onValueChange).toHaveBeenLastCalledWith('-1234.5');
    expect(input.value).toBe('-1.234,5');
    expect(input.getAttribute('pattern')).toBe(
      '^-?(?:[0-9]{1,3}(?:\\.[0-9]{3})*|[0-9]*)(?:,[0-9]*)?$',
    );
  });

  test('continues to reject negative values by default', () => {
    const onValueChange = mock((_v: string) => {});
    const { container } = render(<ValidatedNumberInput value="" onValueChange={onValueChange} />);
    const input = getInput(container);

    expect(fireEvent.keyDown(input, { key: '-' })).toBe(false);
    fireEvent.change(input, { target: { value: '-1,5' } });
    expect(onValueChange).not.toHaveBeenCalled();
  });

  test('invalid characters in input are rejected (no onValueChange)', () => {
    const onValueChange = mock((_v: string) => {});
    const { container } = render(<ValidatedNumberInput value="" onValueChange={onValueChange} />);
    const input = getInput(container);
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'abc' } });
    expect(onValueChange).not.toHaveBeenCalled();
  });

  test('keyDown: numeric keys are allowed and call onKeyDown', () => {
    const onKeyDown = mock((_e: React.KeyboardEvent<HTMLInputElement>) => {});
    const { container } = render(
      <ValidatedNumberInput value="" onValueChange={() => {}} onKeyDown={onKeyDown} />,
    );
    const input = getInput(container);
    const evt = fireEvent.keyDown(input, { key: '5' });
    expect(evt).toBe(true); // not prevented
    expect(onKeyDown).toHaveBeenCalled();
  });

  test('keyDown: non-numeric/non-allowed key is prevented', () => {
    const onKeyDown = mock((_e: React.KeyboardEvent<HTMLInputElement>) => {});
    const { container } = render(
      <ValidatedNumberInput value="" onValueChange={() => {}} onKeyDown={onKeyDown} />,
    );
    const input = getInput(container);
    const evt = fireEvent.keyDown(input, { key: 'a' });
    expect(evt).toBe(false); // prevented
    expect(onKeyDown).toHaveBeenCalled();
  });

  test('keyDown: Backspace is allowed', () => {
    const { container } = render(<ValidatedNumberInput value="" onValueChange={() => {}} />);
    const input = getInput(container);
    const evt = fireEvent.keyDown(input, { key: 'Backspace' });
    expect(evt).toBe(true);
  });

  test('keyDown: ctrl/meta combinations are passed through', () => {
    const onKeyDown = mock((_e: React.KeyboardEvent<HTMLInputElement>) => {});
    const { container } = render(
      <ValidatedNumberInput value="" onValueChange={() => {}} onKeyDown={onKeyDown} />,
    );
    const input = getInput(container);
    const evt = fireEvent.keyDown(input, { key: 'a', ctrlKey: true });
    expect(evt).toBe(true);
    expect(onKeyDown).toHaveBeenCalled();
  });

  test('keyDown: second decimal separator is prevented', () => {
    const { container } = render(<ValidatedNumberInput value="" onValueChange={() => {}} />);
    const input = getInput(container);
    // Set value first to ensure currentTarget.value already has a decimal
    input.value = '1,5';
    const evt = fireEvent.keyDown(input, { key: ',' });
    expect(evt).toBe(false); // prevented
  });

  test('keyDown: comma is the only allowed decimal separator', () => {
    const { container } = render(<ValidatedNumberInput value="" onValueChange={() => {}} />);
    const input = getInput(container);
    input.value = '1';
    expect(fireEvent.keyDown(input, { key: ',' })).toBe(true);
    expect(fireEvent.keyDown(input, { key: '.' })).toBe(false);
  });

  test('focus initializes internal value from current value and calls onFocus', () => {
    const onFocus = mock((_e: React.FocusEvent<HTMLInputElement>) => {});
    const { container } = render(
      <ValidatedNumberInput value="9" onValueChange={() => {}} onFocus={onFocus} />,
    );
    const input = getInput(container);
    fireEvent.focus(input);
    expect(onFocus).toHaveBeenCalledTimes(1);
    expect(input.value).toBe('9');
  });

  test('blur calls onBlur and reverts to displayed value', () => {
    const onBlur = mock((_e: React.FocusEvent<HTMLInputElement>) => {});
    const { container } = render(
      <ValidatedNumberInput
        value="9"
        onValueChange={() => {}}
        onBlur={onBlur}
        formatDecimals={1}
      />,
    );
    const input = getInput(container);
    fireEvent.focus(input);
    fireEvent.blur(input);
    expect(onBlur).toHaveBeenCalledTimes(1);
    expect(input.value).toBe('9,0');
  });

  test('max: a value above the max is clamped before onValueChange', () => {
    const onValueChange = mock((_v: string) => {});
    const { container } = render(
      <ValidatedNumberInput value="" onValueChange={onValueChange} min={0} max={100} />,
    );
    const input = getInput(container);
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '150' } });
    expect(onValueChange).toHaveBeenLastCalledWith('100');
    expect(input.value).toBe('100');
  });

  test('max: a value within bounds passes through unchanged', () => {
    const onValueChange = mock((_v: string) => {});
    const { container } = render(
      <ValidatedNumberInput value="" onValueChange={onValueChange} min={0} max={100} />,
    );
    const input = getInput(container);
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '75' } });
    expect(onValueChange).toHaveBeenLastCalledWith('75');
  });

  test('bounds: clearing the field stays empty (min does not backfill)', () => {
    const onValueChange = mock((_v: string) => {});
    const { container } = render(
      <ValidatedNumberInput value="5" onValueChange={onValueChange} min={0} max={100} />,
    );
    const input = getInput(container);
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '' } });
    expect(onValueChange).toHaveBeenLastCalledWith('');
  });

  test('bounds: a trailing decimal point is preserved while typing', () => {
    const onValueChange = mock((_v: string) => {});
    const { container } = render(
      <ValidatedNumberInput value="" onValueChange={onValueChange} min={0} max={100} />,
    );
    const input = getInput(container);
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '12,' } });
    expect(onValueChange).toHaveBeenLastCalledWith('12.');
    expect(input.value).toBe('12,');
  });

  test('forwards extra props to the underlying input (placeholder, name)', () => {
    const { container } = render(
      <ValidatedNumberInput value="" onValueChange={() => {}} placeholder="0,00" name="amount" />,
    );
    const input = getInput(container);
    expect(input.placeholder).toBe('0,00');
    expect(input.name).toBe('amount');
  });
});
