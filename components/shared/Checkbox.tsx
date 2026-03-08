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
  const checkmarkSizeClasses = size === 'sm' ? 'w-2 h-2' : 'w-3 h-3';
  const indeterminateSizeClasses = size === 'sm' ? 'w-1.5 h-0.5' : 'w-2 h-0.5';

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
          <span className={`${indeterminateSizeClasses} bg-white rounded-full`} />
        ) : (
          <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            fill="none"
            className={`${checkmarkSizeClasses} block text-white transition-transform duration-200 ${checked ? 'scale-100' : 'scale-0'}`}
          >
            <path
              d="M3.5 8.5L6.5 11.5L12.5 4.5"
              stroke="currentColor"
              strokeWidth="2.25"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </div>
    </label>
  );
};

export default Checkbox;
