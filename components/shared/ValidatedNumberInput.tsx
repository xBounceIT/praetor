import React, { useState } from 'react';

const numberInputPattern = /^[0-9]*([.,][0-9]*)?$/;

const normalizeNumberInput = (value: string) => value.replace(',', '.');

type ValidatedNumberInputProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'type' | 'onChange' | 'value'
> & {
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

const ValidatedNumberInput = React.forwardRef<HTMLInputElement, ValidatedNumberInputProps>(
  ({ value, onValueChange, onKeyDown, onFocus, onBlur, formatDecimals, ...rest }, ref) => {
    const [internalValue, setInternalValue] = useState('');
    const [isFocused, setIsFocused] = useState(false);

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

    const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
      const rawValue = event.target.value;
      if (rawValue !== '' && !numberInputPattern.test(rawValue)) return;
      const normalizedValue = normalizeNumberInput(rawValue);
      setInternalValue(normalizedValue);
      onValueChange(normalizedValue);
    };

    const handleFocus = (event: React.FocusEvent<HTMLInputElement>) => {
      setIsFocused(true);
      setInternalValue(formatForDisplay(value));
      onFocus?.(event);
    };

    const handleBlur = (event: React.FocusEvent<HTMLInputElement>) => {
      setIsFocused(false);
      onBlur?.(event);
    };

    return (
      <input
        {...rest}
        ref={ref}
        type="text"
        inputMode="decimal"
        pattern="^[0-9]*([.,][0-9]*)?$"
        value={displayValue}
        onKeyDown={handleKeyDown}
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
      />
    );
  },
);

ValidatedNumberInput.displayName = 'ValidatedNumberInput';

export default ValidatedNumberInput;
