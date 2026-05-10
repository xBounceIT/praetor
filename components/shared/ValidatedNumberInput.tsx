import React, { useState } from 'react';
import { cn } from '@/lib/utils';

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

const inputClassName =
  'h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40';

const ValidatedNumberInput = React.forwardRef<HTMLInputElement, ValidatedNumberInputProps>(
  (
    { value, onValueChange, onKeyDown, onFocus, onBlur, formatDecimals, className, ...rest },
    ref,
  ) => {
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
      setInternalValue(formatForDisplay(value, formatDecimals));
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
        className={cn(inputClassName, className)}
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
