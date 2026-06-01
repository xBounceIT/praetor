import { CheckIcon, ChevronsUpDownIcon, XIcon } from 'lucide-react';
import type React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Field, FieldLabel } from '@/components/ui/field';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export interface Option {
  id: string;
  name: string;
  badge?: string;
}

export interface SelectControlProps {
  id?: string;
  options: Option[];
  value: string | string[];
  onChange: (value: string | string[]) => void;
  label?: React.ReactNode;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  searchable?: boolean;
  isMulti?: boolean;
  buttonClassName?: string;
  displayValue?: string;
}

const EMPTY_VALUE_SENTINEL = '__praetor_empty_select_value__';

const toSelectValue = (value: string) => (value === '' ? EMPTY_VALUE_SENTINEL : value);
const fromSelectValue = (value: string) => (value === EMPTY_VALUE_SENTINEL ? '' : value);

const baseTriggerClassName = 'w-full min-w-0 justify-between text-left text-sm font-normal';

const getSingleSelectedOption = (options: Option[], value: string | string[]) => {
  if (Array.isArray(value)) return undefined;
  return options.find((option) => option.id === value);
};

const getMultiButtonLabel = ({
  displayValue,
  placeholder,
  selectedOptions,
  t,
}: {
  displayValue?: string;
  placeholder?: string;
  selectedOptions: Option[];
  t: (key: string) => string;
}) => {
  if (displayValue) return displayValue;

  if (selectedOptions.length === 0) return placeholder || t('select.placeholder');
  if (selectedOptions.length === 1) return selectedOptions[0].name;
  return `${selectedOptions.length} ${t('select.selected').toLowerCase()}`;
};

const SelectLabel = ({ id, label }: { id?: string; label?: React.ReactNode }) => {
  if (!label) return null;
  return <FieldLabel htmlFor={id}>{label}</FieldLabel>;
};

const TriggerLabel = ({ isPlaceholder, label }: { isPlaceholder: boolean; label: string }) => {
  const tooltipLabel = label.trim() === '' ? null : label;

  return (
    <Tooltip disabled={!tooltipLabel}>
      <TooltipTrigger asChild>
        <span className="inline-flex min-w-0 flex-1">
          <span
            className={cn(
              'w-full truncate',
              isPlaceholder ? 'text-muted-foreground' : 'font-semibold text-foreground',
            )}
          >
            {label}
          </span>
        </span>
      </TooltipTrigger>
      <TooltipContent>{tooltipLabel}</TooltipContent>
    </Tooltip>
  );
};

const PlainSelectControl = ({
  buttonClassName,
  className,
  disabled,
  displayValue,
  id,
  label,
  onChange,
  options,
  placeholder,
  value,
}: SelectControlProps) => {
  const { t } = useTranslation('common');
  const stringValue = Array.isArray(value) ? '' : value;
  const selectedOption = getSingleSelectedOption(options, value);
  const labelText = displayValue || selectedOption?.name || placeholder || t('select.placeholder');
  const hasSelection = Boolean(displayValue || selectedOption);
  const selectValue = selectedOption ? toSelectValue(stringValue) : undefined;

  return (
    <Field className={cn('relative min-w-0', className)}>
      <SelectLabel id={id} label={label} />
      <Select
        disabled={disabled}
        value={selectValue}
        onValueChange={(next) => onChange(fromSelectValue(next))}
      >
        <SelectTrigger id={id} className={cn(baseTriggerClassName, buttonClassName)}>
          {displayValue ? (
            <TriggerLabel isPlaceholder={!hasSelection} label={labelText} />
          ) : (
            <SelectValue placeholder={placeholder || t('select.placeholder')} />
          )}
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {options.map((option) => (
              <SelectItem key={option.id || EMPTY_VALUE_SENTINEL} value={toSelectValue(option.id)}>
                <span className="flex items-center gap-2 min-w-0 flex-1">
                  <span className="truncate">{option.name}</span>
                  {option.badge && (
                    <span className="text-[10px] bg-praetor px-2 py-0.5 rounded text-white font-bold uppercase leading-none">
                      {option.badge}
                    </span>
                  )}
                </span>
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>
  );
};

const SearchableSelectControl = ({
  buttonClassName,
  className,
  disabled,
  displayValue,
  id,
  isMulti = false,
  label,
  onChange,
  options,
  placeholder,
  value,
}: SelectControlProps) => {
  const { t } = useTranslation('common');
  const [open, setOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const selectedOption = getSingleSelectedOption(options, value);
  const selectedValueSet = useMemo(() => new Set(Array.isArray(value) ? value : []), [value]);
  const selectedOptions = useMemo(
    () => options.filter((option) => selectedValueSet.has(option.id)),
    [options, selectedValueSet],
  );
  const buttonLabel = isMulti
    ? getMultiButtonLabel({ displayValue, placeholder, selectedOptions, t })
    : displayValue || selectedOption?.name || placeholder || t('select.placeholder');
  const isPlaceholder = isMulti
    ? selectedOptions.length === 0 && !displayValue
    : !selectedOption && !displayValue;

  const searchableOptions = useMemo(
    () =>
      options.map((option) => ({
        option,
        normalizedName: option.name.toLowerCase(),
      })),
    [options],
  );

  const filteredOptions = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    if (!normalizedSearch) return options;
    return searchableOptions
      .filter(({ normalizedName }) => normalizedName.includes(normalizedSearch))
      .map(({ option }) => option);
  }, [options, searchTerm, searchableOptions]);

  useEffect(() => {
    if (!open) {
      setSearchTerm('');
    }
  }, [open]);

  useEffect(() => {
    if (disabled) {
      setOpen(false);
    }
  }, [disabled]);

  const handleSelect = (id: string) => {
    if (disabled) return;

    if (isMulti) {
      const currentValues = Array.isArray(value) ? value : [];
      const nextValues = currentValues.includes(id)
        ? currentValues.filter((currentValue) => currentValue !== id)
        : [...currentValues, id];
      onChange(nextValues);
      return;
    }

    onChange(id);
    setOpen(false);
  };

  return (
    <Field className={cn('relative min-w-0', className)}>
      <SelectLabel id={id} label={label} />
      <Popover open={open} onOpenChange={disabled ? undefined : setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            id={id}
            variant="outline"
            disabled={disabled}
            aria-expanded={open}
            className={cn(
              baseTriggerClassName,
              isMulti && 'h-auto min-h-9 items-start whitespace-normal py-1.5',
              buttonClassName,
            )}
          >
            {isMulti && selectedOptions.length > 0 && !displayValue ? (
              <span className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                {selectedOptions.map((option) => (
                  <span
                    key={option.id}
                    className="inline-flex max-w-full min-w-0 items-center gap-1.5 rounded border border-border bg-muted px-2 py-0.5 font-bold text-[10px] text-foreground uppercase tracking-wider"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <span className="truncate">{option.name}</span>
                    <span
                      aria-hidden="true"
                      className="flex size-3 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      onClick={(event) => {
                        event.stopPropagation();
                        handleSelect(option.id);
                      }}
                    >
                      <XIcon className="size-3" />
                    </span>
                  </span>
                ))}
              </span>
            ) : (
              <TriggerLabel isPlaceholder={isPlaceholder} label={buttonLabel} />
            )}
            <ChevronsUpDownIcon className="ml-2 size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-[var(--radix-popover-trigger-width)] min-w-[12rem] p-0"
          align="start"
        >
          <Command shouldFilter={false}>
            <CommandInput
              value={searchTerm}
              onValueChange={setSearchTerm}
              placeholder={t('select.search')}
            />
            <CommandList>
              <CommandEmpty>{t('select.noOptions')}</CommandEmpty>
              <CommandGroup>
                {isMulti && filteredOptions.length > 1 && (
                  <div className="flex gap-1 border-b border-border p-1">
                    <Button
                      type="button"
                      variant="secondary"
                      size="xs"
                      className="flex-1"
                      onClick={() => onChange(options.map((option) => option.id))}
                    >
                      {t('select.selectAll')}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      className="flex-1"
                      onClick={() => onChange([])}
                    >
                      {t('select.clear')}
                    </Button>
                  </div>
                )}
                {filteredOptions.map((option) => {
                  const selected = isMulti ? selectedValueSet.has(option.id) : value === option.id;
                  return (
                    <CommandItem
                      key={option.id || EMPTY_VALUE_SENTINEL}
                      value={option.name}
                      onSelect={() => handleSelect(option.id)}
                    >
                      <span className="flex items-center gap-2 min-w-0 flex-1">
                        <span className="truncate">{option.name}</span>
                        {option.badge && (
                          <span className="text-[10px] bg-praetor px-2 py-0.5 rounded text-white font-bold uppercase leading-none">
                            {option.badge}
                          </span>
                        )}
                      </span>
                      <CheckIcon
                        className={cn('ml-auto size-4', selected ? 'opacity-100' : 'opacity-0')}
                      />
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </Field>
  );
};

const SelectControl: React.FC<SelectControlProps> = (props) => {
  if (props.searchable) {
    return <SearchableSelectControl {...props} />;
  }

  return <PlainSelectControl {...props} />;
};

export default SelectControl;
