import type React from 'react';

export interface CheckboxProps {
  checked: boolean;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  disabled?: boolean;
  indeterminate?: boolean;
  size?: 'sm' | 'md';
}

const Checkbox: React.FC<CheckboxProps> = ({
  checked,
  onChange,
  disabled = false,
  indeterminate = false,
  size = 'md',
}) => {
  const sizeClasses = size === 'sm' ? 'w-3.5 h-3.5' : 'w-5 h-5';
  const iconSize = size === 'sm' ? 'text-[8px]' : 'text-[10px]';

  return (
    <label
      className={`relative inline-flex items-center justify-center ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'} group`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        className="peer sr-only"
      />
      <div
        className={`${sizeClasses} bg-white border-2 border-slate-300 rounded-md transition-all duration-200 peer-checked:bg-praetor peer-checked:border-praetor ${!disabled ? 'group-hover:border-praetor/50' : ''} peer-focus:ring-2 peer-focus:ring-praetor/20 flex items-center justify-center ${indeterminate && !checked ? 'bg-praetor border-praetor' : ''}`}
      >
        {indeterminate && !checked ? (
          <span className="w-2 h-0.5 bg-white rounded-full" />
        ) : (
          <i
            className={`fa-solid fa-check text-white ${iconSize} leading-none w-full h-full text-center flex items-center justify-center transition-transform duration-200 ${checked ? 'scale-100' : 'scale-0'}`}
          />
        )}
      </div>
    </label>
  );
};

export default Checkbox;
