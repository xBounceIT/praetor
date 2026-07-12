import { CheckIcon, ChevronsUpDownIcon, XIcon } from 'lucide-react';
import type React from 'react';
import { useMemo, useReducer, useRef, useState } from 'react';
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
  icon?: React.ReactNode;
  badge?: string;
  disabled?: boolean;
}

export interface SelectControlProps {
  id?: string;
  options: Option[];
  value: string | string[];
  onChange: (value: string | string[]) => void;
  label?: React.ReactNode;
  labelAccessory?: React.ReactNode;
  labelClassName?: string;
  required?: boolean;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  searchable?: boolean;
  isMulti?: boolean;
  buttonClassName?: string;
  displayValue?: string;
  /**
   * When `displayValue` represents an empty/placeholder state (e.g. a "none"
   * sentinel) rather than a real selection, set this so the label is rendered
   * with muted placeholder styling instead of the full-contrast selected style.
   */
  displayValueIsPlaceholder?: boolean;
  /**
   * Extra classes for the selected-value label inside the trigger. Use to soften
   * the default `font-semibold` (e.g. `font-normal`) where a heavier weight would
   * over-emphasize the value relative to neighboring fields.
   */
  valueClassName?: string;
}

const EMPTY_VALUE_SENTINEL = '__praetor_empty_select_value__';

const toSelectValue = (value: string) => (value === '' ? EMPTY_VALUE_SENTINEL : value);
const fromSelectValue = (value: string) => (value === EMPTY_VALUE_SENTINEL ? '' : value);

const baseTriggerClassName = 'w-full min-w-0 justify-between text-left text-sm font-normal';

/**
 * When the combobox lives inside a modal dialog, Radix's scroll-lock
 * (`react-remove-scroll`) only whitelists the dialog's own content subtree.
 * This popover is portaled to `document.body` — outside that subtree — so the
 * scroll-lock swallows wheel events over the option list (dragging the scrollbar
 * still works, since that's a pointer interaction). Promoting the popover to
 * `modal` gives it its own scroll-lock that whitelists the list, restoring wheel
 * scrolling. Page-level selects stay non-modal so they never lock page scroll.
 */
const isInsideModalDialog = (element: HTMLElement | null) =>
  Boolean(element?.closest('[data-slot="dialog-content"],[data-slot="sheet-content"]'));

const getSingleSelectedOption = (options: Option[], value: string | string[]) => {
  if (Array.isArray(value)) return undefined;
  return options.find((option) => option.id === value);
};

const getEnabledOptionIds = (options: Option[]) => {
  const ids: string[] = [];
  for (const option of options) {
    if (!option.disabled) ids.push(option.id);
  }
  return ids;
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

const SelectLabel = ({
  id,
  label,
  labelAccessory,
  labelClassName,
  required,
}: {
  id?: string;
  label?: React.ReactNode;
  labelAccessory?: React.ReactNode;
  labelClassName?: string;
  required?: boolean;
}) => {
  if (!label) return null;

  if (labelAccessory) {
    return (
      <div className="flex w-fit items-center gap-2">
        <FieldLabel className={labelClassName} htmlFor={id} required={required}>
          {label}
        </FieldLabel>
        {labelAccessory}
      </div>
    );
  }

  return (
    <FieldLabel className={labelClassName} htmlFor={id} required={required}>
      {label}
    </FieldLabel>
  );
};

const TriggerLabel = ({
  icon,
  isPlaceholder,
  label,
  valueClassName,
}: {
  icon?: React.ReactNode;
  isPlaceholder: boolean;
  label: string;
  valueClassName?: string;
}) => {
  const tooltipLabel = label.trim() === '' ? null : label;

  return (
    <Tooltip disabled={!tooltipLabel}>
      <TooltipTrigger asChild>
        <span className="inline-flex min-w-0 flex-1 items-center gap-2">
          {icon}
          <span
            className={cn(
              'w-full truncate',
              isPlaceholder ? 'text-muted-foreground' : 'font-semibold text-foreground',
              valueClassName,
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

type SearchableSelectState = {
  open: boolean;
  searchTerm: string;
};

type SearchableSelectAction =
  | { type: 'setOpen'; open: boolean }
  | { type: 'setSearchTerm'; searchTerm: string }
  | { type: 'close' };

const searchableSelectReducer = (
  state: SearchableSelectState,
  action: SearchableSelectAction,
): SearchableSelectState => {
  switch (action.type) {
    case 'setOpen':
      return action.open ? { ...state, open: true } : { open: false, searchTerm: '' };
    case 'setSearchTerm':
      return { ...state, searchTerm: action.searchTerm };
    case 'close':
      return { open: false, searchTerm: '' };
    default:
      return state;
  }
};

const PlainSelectControl = ({
  buttonClassName,
  className,
  disabled,
  displayValue,
  displayValueIsPlaceholder,
  id,
  label,
  labelAccessory,
  labelClassName,
  required,
  onChange,
  options,
  placeholder,
  value,
  valueClassName,
}: SelectControlProps) => {
  const { t } = useTranslation('common');
  const stringValue = Array.isArray(value) ? '' : value;
  const selectedOption = getSingleSelectedOption(options, value);
  const labelText = displayValue || selectedOption?.name || placeholder || t('select.placeholder');
  const hasSelection = Boolean(displayValue || selectedOption) && !displayValueIsPlaceholder;
  const selectValue = selectedOption ? toSelectValue(stringValue) : undefined;

  return (
    <Field className={cn('relative min-w-0', className)}>
      <SelectLabel
        id={id}
        label={label}
        labelAccessory={labelAccessory}
        labelClassName={labelClassName}
        required={required}
      />
      <Select
        disabled={disabled}
        value={selectValue}
        onValueChange={(next) => {
          const nextValue = fromSelectValue(next);
          if (options.find((option) => option.id === nextValue)?.disabled) return;
          onChange(nextValue);
        }}
      >
        <SelectTrigger id={id} className={cn(baseTriggerClassName, buttonClassName)}>
          {displayValue ? (
            <TriggerLabel
              icon={selectedOption?.icon}
              isPlaceholder={!hasSelection}
              label={labelText}
              valueClassName={valueClassName}
            />
          ) : (
            <SelectValue placeholder={placeholder || t('select.placeholder')} />
          )}
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {options.map((option) => (
              <SelectItem
                key={option.id || EMPTY_VALUE_SENTINEL}
                value={toSelectValue(option.id)}
                disabled={option.disabled}
              >
                <span className="flex items-center gap-2 min-w-0 flex-1">
                  {option.icon}
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
  displayValueIsPlaceholder,
  id,
  isMulti = false,
  label,
  labelAccessory,
  labelClassName,
  required,
  onChange,
  options,
  placeholder,
  value,
  valueClassName,
}: SelectControlProps) => {
  const { t } = useTranslation('common');
  const [state, dispatch] = useReducer(searchableSelectReducer, {
    open: false,
    searchTerm: '',
  });
  const { open, searchTerm } = state;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [modal, setModal] = useState(false);
  const selectedOption = getSingleSelectedOption(options, value);
  const selectedValueSet = useMemo(() => new Set(Array.isArray(value) ? value : []), [value]);
  const selectedOptions = useMemo(
    () => options.filter((option) => selectedValueSet.has(option.id)),
    [options, selectedValueSet],
  );
  const buttonLabel = isMulti
    ? getMultiButtonLabel({ displayValue, placeholder, selectedOptions, t })
    : displayValue || selectedOption?.name || placeholder || t('select.placeholder');
  const isPlaceholder =
    Boolean(displayValueIsPlaceholder) ||
    (isMulti ? selectedOptions.length === 0 && !displayValue : !selectedOption && !displayValue);

  if (disabled && open) {
    dispatch({ type: 'close' });
  }

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
    return searchableOptions.reduce<Option[]>((matches, { option, normalizedName }) => {
      if (normalizedName.includes(normalizedSearch)) matches.push(option);
      return matches;
    }, []);
  }, [options, searchTerm, searchableOptions]);

  const handleSelect = (option: Option) => {
    if (disabled) return;

    const { id } = option;
    const canRemoveDisabledOption = isMulti && Array.isArray(value) && value.includes(id);
    if (option.disabled && !canRemoveDisabledOption) return;

    if (isMulti) {
      const currentValues = Array.isArray(value) ? value : [];
      const nextValues = currentValues.includes(id)
        ? currentValues.filter((currentValue) => currentValue !== id)
        : [...currentValues, id];
      onChange(nextValues);
      return;
    }

    onChange(id);
    dispatch({ type: 'close' });
  };

  return (
    <Field className={cn('relative min-w-0', className)}>
      <SelectLabel
        id={id}
        label={label}
        labelAccessory={labelAccessory}
        labelClassName={labelClassName}
        required={required}
      />
      <Popover
        open={open}
        modal={modal}
        onOpenChange={
          disabled
            ? undefined
            : (nextOpen) => {
                if (nextOpen) setModal(isInsideModalDialog(triggerRef.current));
                dispatch({ type: 'setOpen', open: nextOpen });
              }
        }
      >
        <PopoverTrigger asChild>
          <Button
            ref={triggerRef}
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
                        handleSelect(option);
                      }}
                    >
                      <XIcon className="size-3" />
                    </span>
                  </span>
                ))}
              </span>
            ) : (
              <TriggerLabel
                icon={selectedOption?.icon}
                isPlaceholder={isPlaceholder}
                label={buttonLabel}
                valueClassName={valueClassName}
              />
            )}
            <ChevronsUpDownIcon className="ml-2 size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-fit min-w-[max(12rem,var(--radix-popover-trigger-width))] max-w-[var(--radix-popover-content-available-width)] p-0"
          align="start"
        >
          <Command shouldFilter={false}>
            <CommandInput
              value={searchTerm}
              onValueChange={(nextSearchTerm) =>
                dispatch({ type: 'setSearchTerm', searchTerm: nextSearchTerm })
              }
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
                      onClick={() => onChange(getEnabledOptionIds(options))}
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
                      disabled={option.disabled}
                      onSelect={() => handleSelect(option)}
                    >
                      <span className="flex items-center gap-2 min-w-0 flex-1">
                        {option.icon}
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
