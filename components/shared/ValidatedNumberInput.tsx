import React, { useState } from 'react';

const numberInputPattern = /^[0-9]*([.,][0-9]*)?$/;

const normalizeNumberInput = (value: string) => value.replace(',', '.');

type ValidatedNumberInputProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'type' | 'onChange' | 'value'
> & {
  value?: string | number;
  onValueChange: (value: string) => void;
};

const ValidatedNumberInput = React.forwardRef<HTMLInputElement, ValidatedNumberInputProps>(
  ({ value, onValueChange, onKeyDown, onFocus, onBlur, ...rest }, ref) => {
    const [internalValue, setInternalValue] = useState<string>(
      value === undefined || value === null ? '' : String(value),
    );
    const [isFocused, setIsFocused] = useState(false);

    // Derive display value from props when not focused
    const displayValue = isFocused
      ? internalValue
      : value === undefined || value === null
        ? ''
        : String(value);

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
      setInternalValue(value === undefined || value === null ? '' : String(value));
      onFocus?.(event);
    };

    const handleBlur = (event: React.FocusEvent<HTMLInputElement>) => {
      setIsFocused(false);
      setInternalValue(value === undefined || value === null ? '' : String(value));
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
