import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

export interface Option {
  id: string;
  name: string;
}

interface CustomSelectProps {
  options: Option[];
  value: string | string[];
  onChange: (value: string | string[]) => void;
  label?: string;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  searchable?: boolean;
  isMulti?: boolean;
  onOpen?: () => void;
  onClose?: () => void;
  buttonClassName?: string;
  dropdownPosition?: 'top' | 'bottom';
  displayValue?: string; // Custom display value to override the default label
}

const CustomSelect: React.FC<CustomSelectProps> = ({
  options,
  value,
  onChange,
  label,
  placeholder,
  className = '',
  disabled = false,
  searchable = false,
  isMulti = false,
  onOpen,
  onClose,
  buttonClassName,
  dropdownPosition = 'bottom',
  displayValue,
}) => {
  const { t } = useTranslation('common');
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedOptions = isMulti
    ? options.filter((o) => (value as string[]).includes(o.id))
    : options.find((o) => o.id === value);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        onClose?.();
        setSearchTerm(''); // Reset search on close
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  const filteredOptions = searchable
    ? options.filter((o) => o.name.toLowerCase().includes(searchTerm.toLowerCase()))
    : options;

  const handleToggle = (id: string, e?: React.MouseEvent) => {
    if (isMulti) {
      e?.stopPropagation(); // Prevent dropdown from closing
      const currentValues = Array.isArray(value) ? value : [];
      const newValues = currentValues.includes(id)
        ? currentValues.filter((v) => v !== id)
        : [...currentValues, id];
      onChange(newValues);
    } else {
      onChange(id);
      setIsOpen(false);
      onClose?.();
      setSearchTerm('');
    }
  };

  const getButtonLabel = () => {
    if (displayValue) return displayValue;

    if (isMulti) {
      const selected = selectedOptions as Option[];
      if (selected.length === 0) return placeholder || t('select.placeholder');
      if (selected.length === 1) return selected[0].name;
      return `${selected.length} ${t('select.selected').toLowerCase()}`;
    }
    const selected = selectedOptions as Option | undefined;
    return selected ? selected.name : placeholder || t('select.placeholder');
  };

  const isSelected = (id: string) => {
    if (isMulti) return (value as string[]).includes(id);
    return value === id;
  };

  return (
    <div className={`relative ${className}`} ref={containerRef}>
      {label && (
        <label className="block text-xs font-bold text-slate-400 mb-1 uppercase tracking-wider">
          {label}
        </label>
      )}
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          const nextState = !isOpen;
          setIsOpen(nextState);
          if (nextState) onOpen?.();
          else onClose?.();
        }}
        className={`w-full flex items-center justify-between rounded-xl focus:ring-2 focus:ring-praetor outline-none text-left transition-all
          ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:border-slate-300'}
          ${isOpen ? 'ring-2 ring-praetor border-praetor' : ''}
          bg-slate-50 border border-slate-200 px-3
          ${buttonClassName ? buttonClassName : 'py-2.5 text-sm'}`}
      >
        <div className="flex-1 min-w-0">
          {isMulti && (value as string[]).length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {(selectedOptions as Option[]).map((option) => (
                <span
                  key={option.id}
                  className="bg-slate-100 text-praetor px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 border border-slate-200"
                  onClick={(e) => e.stopPropagation()}
                >
                  {option.name}
                  <button
                    type="button"
                    onClick={(e) => handleToggle(option.id, e)}
                    className="hover:text-slate-900 text-slate-400 transition-colors w-3 h-3 flex items-center justify-center rounded-full hover:bg-slate-200"
                  >
                    <i className="fa-solid fa-xmark text-[10px]"></i>
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <span
              className={`truncate block ${!isMulti && value ? 'text-slate-800 font-semibold' : 'text-slate-400'}`}
              title={
                typeof getButtonLabel() === 'string' ? (getButtonLabel() as string) : undefined
              }
            >
              {getButtonLabel()}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 ml-2 shrink-0">
          {isMulti && (value as string[]).length > 0 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onChange([]);
              }}
              className="hover:text-red-500 text-slate-300 transition-colors"
            >
              <i className="fa-solid fa-circle-xmark text-xs"></i>
            </button>
          )}
          <i
            className={`fa-solid fa-chevron-down text-[10px] text-slate-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
          ></i>
        </div>
      </button>

      {isOpen && !disabled && (
        <div
          className={`absolute z-[100] min-w-full w-max bg-white border border-slate-200 rounded-xl shadow-xl py-1 max-h-60 overflow-y-auto animate-in fade-in zoom-in-95 duration-100 ${dropdownPosition === 'top' ? 'bottom-full mb-1 origin-bottom' : 'mt-1 origin-top'}`}
        >
          {searchable && (
            <div className="px-2 pt-2 pb-1 sticky top-0 bg-white border-b border-slate-50 z-10">
              <input
                type="text"
                autoFocus
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder={t('select.search')}
                className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-praetor text-slate-700"
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          )}

          {filteredOptions.length === 0 ? (
            <div className="px-4 py-3 text-xs text-slate-400 italic text-center">
              {t('select.noOptions')}
            </div>
          ) : (
            <>
              {isMulti && filteredOptions.length > 1 && (
                <div className="px-2 py-1 border-b border-slate-50 mb-1 flex gap-1">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      const allIds = options.map((o) => o.id);
                      onChange(allIds);
                    }}
                    className="flex-1 text-[10px] font-bold py-1 px-2 rounded bg-slate-100 text-praetor hover:bg-slate-200 transition-colors"
                  >
                    {t('select.selectAll')}
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onChange([]);
                    }}
                    className="flex-1 text-[10px] font-bold py-1 px-2 rounded bg-slate-50 text-slate-500 hover:bg-slate-100 transition-colors"
                  >
                    {t('select.clear')}
                  </button>
                </div>
              )}
              {filteredOptions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={(e) => handleToggle(option.id, e)}
                  className={`w-full text-left px-4 py-2.5 text-sm transition-colors flex items-center justify-between ${
                    isSelected(option.id)
                      ? 'bg-slate-100 text-praetor font-bold'
                      : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                  }`}
                >
                  <span className="truncate">{option.name}</span>
                  {isSelected(option.id) && <i className="fa-solid fa-check text-[10px]"></i>}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default CustomSelect;
