import type React from 'react';
import { useState } from 'react';
import { Input } from '@/components/ui/input';

const numberInputPattern = /^[0-9]*([.,][0-9]*)?$/;

const normalizeNumberInput = (value: string) => value.replace(',', '.');

type ValidatedNumberInputProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'type' | 'onChange' | 'value'
> & {
  ref?: React.Ref<HTMLInputElement>;
  value?: string | number;
  onValueChange: (value: string) => void;
  formatDecimals?: number;
};

const formatForDisplay = (value: string | number | undefined | null, decimals?: number) => {
  if (value === undefined || value === null || value === '') return '';
  const n = typeof value === 'number' ? value : Number(normalizeNumberInput(String(value)));
  if (!Number.isFinite(n)) return '';
  return decimals === undefined ? String(value) : n.toFixed(decimals);
};

const ValidatedNumberInput = ({
  value,
  onValueChange,
  onKeyDown,
  onFocus,
  onBlur,
  formatDecimals,
  min,
  max,
  ref,
  ...rest
}: ValidatedNumberInputProps) => {
  const [internalValue, setInternalValue] = useState('');
  const [isFocused, setIsFocused] = useState(false);

  // Keep partial entries ('', '.', trailing-dot) editable; only clamp once the
  // string parses to a finite number so bounded fields (e.g. a 0–100 percentage)
  // can never hold an out-of-range value. min/max arrive from the native input
  // attributes as string | number, so coerce before comparing.
  const clampToBounds = (val: string): string => {
    if (val === '') return val;
    const n = Number(val);
    if (!Number.isFinite(n)) return val;
    const maxNum = max === undefined ? Number.NaN : Number(max);
    const minNum = min === undefined ? Number.NaN : Number(min);
    if (Number.isFinite(maxNum) && n > maxNum) return String(maxNum);
    if (Number.isFinite(minNum) && n < minNum) return String(minNum);
    return val;
  };

  const displayValue = isFocused ? internalValue : formatForDisplay(value, formatDecimals);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.ctrlKey || event.metaKey) {
      onKeyDown?.(event);
      return;
    }

    const allowedKeys = [
      'Backspace',
      'Delete',
      'Tab',
      'Escape',
      'Enter',
      'ArrowLeft',
      'ArrowRight',
      'ArrowUp',
      'ArrowDown',
      'Home',
      'End',
    ];
    if (allowedKeys.includes(event.key)) {
      onKeyDown?.(event);
      return;
    }

    if (event.key === '.' || event.key === ',') {
      const currentValue = event.currentTarget.value;
      if (currentValue.includes('.') || currentValue.includes(',')) {
        event.preventDefault();
      }
      onKeyDown?.(event);
      return;
    }

    if (!/^[0-9]$/.test(event.key)) {
      event.preventDefault();
    }
    onKeyDown?.(event);
  };

  const updateNumberValue = (event: React.ChangeEvent<HTMLInputElement>) => {
    const rawValue = event.target.value;
    if (rawValue !== '' && !numberInputPattern.test(rawValue)) return;
    const normalizedValue = clampToBounds(normalizeNumberInput(rawValue));
    setInternalValue(normalizedValue);
    onValueChange(normalizedValue);
  };

  const showEditingValue = (event: React.FocusEvent<HTMLInputElement>) => {
    setIsFocused(true);
    setInternalValue(formatForDisplay(value, formatDecimals));
    onFocus?.(event);
  };

  const commitDisplayValue = (event: React.FocusEvent<HTMLInputElement>) => {
    setIsFocused(false);
    onBlur?.(event);
  };

  return (
    <Input
      {...rest}
      ref={ref}
      type="text"
      inputMode="decimal"
      pattern="^[0-9]*([.,][0-9]*)?$"
      value={displayValue}
      onKeyDown={handleKeyDown}
      onChange={updateNumberValue}
      onFocus={showEditingValue}
      onBlur={commitDisplayValue}
    />
  );
};

export default ValidatedNumberInput;
