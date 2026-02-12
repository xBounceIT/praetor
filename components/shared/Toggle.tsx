import type React from 'react';

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  partial?: boolean;
  color?: 'praetor' | 'red';
  disabled?: boolean;
}

const Toggle: React.FC<ToggleProps> = ({
  checked,
  onChange,
  partial = false,
  color = 'praetor',
  disabled = false,
}) => {
  const bgColor = checked
    ? color === 'red'
      ? 'bg-red-500'
      : 'bg-praetor'
    : partial
      ? 'bg-praetor/40'
      : 'bg-slate-200';

  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      disabled={disabled}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-praetor focus:ring-offset-2 ${bgColor} ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
    >
      <span
        className={`pointer-events-none h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out flex items-center justify-center ${
          checked || partial ? 'translate-x-5' : 'translate-x-0'
        }`}
      >
        {partial && !checked && <span className="w-2.5 h-0.5 bg-praetor/60 rounded-full" />}
      </span>
    </button>
  );
};

export default Toggle;
