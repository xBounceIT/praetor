import type React from 'react';
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { formatNumber, normalizeLocalizedNumber } from '@/utils/numbers';

const LOCALIZED_NUMBER_BODY_PATTERN = String.raw`(?:[0-9]{1,3}(?:\.[0-9]{3})*|[0-9]*)(?:,[0-9]*)?`;
const UNSIGNED_NUMBER_INPUT_PATTERN = `^${LOCALIZED_NUMBER_BODY_PATTERN}$`;
const SIGNED_NUMBER_INPUT_PATTERN = `^-?${LOCALIZED_NUMBER_BODY_PATTERN}$`;
const unsignedNumberInputPattern = new RegExp(UNSIGNED_NUMBER_INPUT_PATTERN);
const signedNumberInputPattern = new RegExp(SIGNED_NUMBER_INPUT_PATTERN);

const normalizeEditingValue = (value: string) => value.replaceAll('.', '').replace(',', '.');

type ValidatedNumberInputProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'type' | 'onChange' | 'value'
> & {
  ref?: React.Ref<HTMLInputElement>;
  value?: string | number;
  onValueChange: (value: string) => void;
  formatDecimals?: number;
  allowNegative?: boolean;
};

const formatForDisplay = (value: string | number | undefined | null, decimals?: number) => {
  if (value === undefined || value === null || value === '') return '';
  const n = typeof value === 'number' ? value : Number(normalizeLocalizedNumber(String(value)));
  if (!Number.isFinite(n)) return '';
  return formatNumber(
    n,
    decimals === undefined
      ? { maximumFractionDigits: 20 }
      : { minimumFractionDigits: decimals, maximumFractionDigits: decimals },
  );
};

const formatForEditing = (value: string | number | undefined | null, decimals?: number) => {
  if (value === undefined || value === null || value === '') return '';
  const rawValue = String(value);
  if (decimals === undefined && /^-?\d+\.?\d*$/.test(rawValue)) return rawValue.replace('.', ',');
  const n = typeof value === 'number' ? value : Number(normalizeLocalizedNumber(rawValue));
  if (!Number.isFinite(n)) return '';
  return formatNumber(
    n,
    decimals === undefined
      ? { maximumFractionDigits: 20, useGrouping: false }
      : {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
          useGrouping: false,
        },
  );
};

const ValidatedNumberInput = ({
  value,
  onValueChange,
  onKeyDown,
  onFocus,
  onBlur,
  formatDecimals,
  allowNegative = false,
  min,
  max,
  ref,
  ...rest
}: ValidatedNumberInputProps) => {
  const [internalValue, setInternalValue] = useState('');
  const [isFocused, setIsFocused] = useState(false);

  // Keep partial entries ('', '-', trailing comma) editable; only clamp once the
  // string parses to a finite number so bounded fields (e.g. a 0–100 percentage)
  // can never hold an out-of-range value. min/max arrive from the native input
  // attributes as string | number, so coerce before comparing.
  const clampToBounds = (val: string): string => {
    if (val === '') return val;
    const n = Number(normalizeEditingValue(val));
    if (!Number.isFinite(n)) return val;
    const maxNum = max === undefined ? Number.NaN : Number(max);
    const minNum = min === undefined ? Number.NaN : Number(min);
    if (Number.isFinite(maxNum) && n > maxNum) return String(maxNum).replace('.', ',');
    if (Number.isFinite(minNum) && n < minNum) return String(minNum).replace('.', ',');
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

    if (event.key === '-') {
      const currentValue = event.currentTarget.value;
      const canInsertNegative =
        allowNegative && !currentValue.includes('-') && event.currentTarget.selectionStart === 0;
      if (!canInsertNegative) event.preventDefault();
      onKeyDown?.(event);
      return;
    }

    if (event.key === '.') {
      event.preventDefault();
      onKeyDown?.(event);
      return;
    }

    if (event.key === ',') {
      const currentValue = event.currentTarget.value;
      if (currentValue.includes(',')) {
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
    const numberInputPattern = allowNegative
      ? signedNumberInputPattern
      : unsignedNumberInputPattern;
    if (rawValue !== '' && !numberInputPattern.test(rawValue)) return;
    const localizedValue = clampToBounds(rawValue);
    setInternalValue(localizedValue);
    onValueChange(normalizeEditingValue(localizedValue));
  };

  const showEditingValue = (event: React.FocusEvent<HTMLInputElement>) => {
    setIsFocused(true);
    setInternalValue(formatForEditing(value, formatDecimals));
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
      pattern={allowNegative ? SIGNED_NUMBER_INPUT_PATTERN : UNSIGNED_NUMBER_INPUT_PATTERN}
      value={displayValue}
      onKeyDown={handleKeyDown}
      onChange={updateNumberValue}
      onFocus={showEditingValue}
      onBlur={commitDisplayValue}
    />
  );
};

export default ValidatedNumberInput;
