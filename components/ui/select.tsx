import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode, RefObject } from 'react';
import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

interface SelectContextValue {
  value: string;
  onValueChange: (value: string) => void;
  open: boolean;
  setOpen: (open: boolean) => void;
  registerItem: (value: string, label: ReactNode) => void;
  unregisterItem: (value: string) => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
  labelByValue: Map<string, ReactNode>;
  disabled: boolean;
}

const SelectContext = createContext<SelectContextValue | null>(null);

const useSelectContext = (component: string) => {
  const context = useContext(SelectContext);
  if (!context) {
    throw new Error(`${component} must be used inside a <Select>`);
  }
  return context;
};

export interface SelectProps {
  value: string;
  onValueChange: (value: string) => void;
  children?: ReactNode;
  disabled?: boolean;
}

const Select = ({ value, onValueChange, children, disabled = false }: SelectProps) => {
  const [open, setOpen] = useState(false);
  const [labelByValue, setLabelByValue] = useState<Map<string, ReactNode>>(() => new Map());
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const registerItem = useCallback((itemValue: string, label: ReactNode) => {
    setLabelByValue((prev) => {
      if (prev.get(itemValue) === label) return prev;
      const next = new Map(prev);
      next.set(itemValue, label);
      return next;
    });
  }, []);

  const unregisterItem = useCallback((itemValue: string) => {
    setLabelByValue((prev) => {
      if (!prev.has(itemValue)) return prev;
      const next = new Map(prev);
      next.delete(itemValue);
      return next;
    });
  }, []);

  const handleValueChange = useCallback(
    (newValue: string) => {
      onValueChange(newValue);
      setOpen(false);
    },
    [onValueChange],
  );

  const contextValue = useMemo<SelectContextValue>(
    () => ({
      value,
      onValueChange: handleValueChange,
      open,
      setOpen,
      registerItem,
      unregisterItem,
      triggerRef,
      labelByValue,
      disabled,
    }),
    [value, handleValueChange, open, registerItem, unregisterItem, labelByValue, disabled],
  );

  return (
    <SelectContext.Provider value={contextValue}>
      <div className="relative inline-block w-full">{children}</div>
    </SelectContext.Provider>
  );
};

export type SelectTriggerProps = ButtonHTMLAttributes<HTMLButtonElement>;

const SelectTrigger = forwardRef<HTMLButtonElement, SelectTriggerProps>(
  ({ className = '', children, onClick, disabled: disabledProp, ...props }, forwardedRef) => {
    const { open, setOpen, triggerRef, disabled } = useSelectContext('SelectTrigger');
    const isDisabled = disabledProp ?? disabled;

    const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
      onClick?.(event);
      if (!event.defaultPrevented && !isDisabled) {
        setOpen(!open);
      }
    };

    const setRefs = (node: HTMLButtonElement | null) => {
      triggerRef.current = node;
      if (typeof forwardedRef === 'function') {
        forwardedRef(node);
      } else if (forwardedRef) {
        (forwardedRef as React.MutableRefObject<HTMLButtonElement | null>).current = node;
      }
    };

    return (
      <button
        ref={setRefs}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        data-state={open ? 'open' : 'closed'}
        disabled={isDisabled}
        onClick={handleClick}
        className={`flex h-10 w-full items-center justify-between rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
        {...props}
      >
        {children}
        <i
          className="fa-solid fa-chevron-down ml-2 text-xs text-muted-foreground"
          aria-hidden="true"
        />
      </button>
    );
  },
);

SelectTrigger.displayName = 'SelectTrigger';

export interface SelectValueProps {
  placeholder?: ReactNode;
  className?: string;
}

const SelectValue = ({ placeholder, className = '' }: SelectValueProps) => {
  const { value, labelByValue } = useSelectContext('SelectValue');
  const label = labelByValue.get(value);
  const hasLabel = label !== undefined && label !== null && label !== '';

  return (
    <span
      className={`truncate ${hasLabel ? 'text-foreground' : 'text-muted-foreground'} ${className}`}
    >
      {hasLabel ? label : placeholder}
    </span>
  );
};

export type SelectContentProps = HTMLAttributes<HTMLDivElement>;

const SelectContent = ({ className = '', children, ...props }: SelectContentProps) => {
  const { open, setOpen, triggerRef } = useSelectContext('SelectContent');
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        containerRef.current &&
        !containerRef.current.contains(target) &&
        !triggerRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open, setOpen, triggerRef]);

  // Children must remain mounted so <SelectItem> register effects run even when closed.
  return (
    <div
      ref={containerRef}
      role="listbox"
      data-state={open ? 'open' : 'closed'}
      hidden={!open}
      className={`absolute left-0 right-0 top-full z-50 mt-1 min-w-[8rem] overflow-hidden rounded-md border border-border bg-background text-foreground shadow-md ${className}`}
      {...props}
    >
      <div className="max-h-60 overflow-y-auto p-1">{children}</div>
    </div>
  );
};

export interface SelectItemProps extends Omit<HTMLAttributes<HTMLDivElement>, 'role'> {
  value: string;
  disabled?: boolean;
  children?: ReactNode;
}

const SelectItem = ({
  value: itemValue,
  className = '',
  children,
  disabled,
  onClick,
  ...props
}: SelectItemProps) => {
  const { value, onValueChange, registerItem, unregisterItem } = useSelectContext('SelectItem');

  useEffect(() => {
    registerItem(itemValue, children);
    return () => unregisterItem(itemValue);
  }, [itemValue, children, registerItem, unregisterItem]);

  const isSelected = value === itemValue;

  return (
    <div
      role="option"
      aria-selected={isSelected}
      data-state={isSelected ? 'checked' : 'unchecked'}
      data-disabled={disabled ? '' : undefined}
      tabIndex={disabled ? -1 : 0}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented && !disabled) {
          onValueChange(itemValue);
        }
      }}
      onKeyDown={(event) => {
        if (disabled) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onValueChange(itemValue);
        }
      }}
      className={`relative flex w-full cursor-pointer select-none items-center rounded-sm py-1.5 pl-3 pr-8 text-sm outline-none hover:bg-muted focus:bg-muted ${isSelected ? 'bg-muted font-semibold' : ''} ${disabled ? 'pointer-events-none opacity-50' : ''} ${className}`}
      {...props}
    >
      {children}
    </div>
  );
};

export { Select, SelectContent, SelectItem, SelectTrigger, SelectValue };
