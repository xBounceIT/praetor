
import React, { useState, useRef, useEffect } from 'react';

export interface Option {
  id: string;
  name: string;
}

interface CustomSelectProps {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  label?: string;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  searchable?: boolean;
  onOpen?: () => void;
  onClose?: () => void;
  buttonClassName?: string;
}

const CustomSelect: React.FC<CustomSelectProps> = ({
  options,
  value,
  onChange,
  label,
  placeholder,
  className = "",
  disabled = false,
  searchable = false,
  onOpen,
  onClose,
  buttonClassName
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find(o => o.id === value);

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
    ? options.filter(o => o.name.toLowerCase().includes(searchTerm.toLowerCase()))
    : options;

  return (
    <div className={`relative ${className}`} ref={containerRef}>
      {label && <label className="block text-xs font-bold text-slate-400 mb-1 uppercase tracking-wider">{label}</label>}
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          const nextState = !isOpen;
          setIsOpen(nextState);
          if (nextState) onOpen?.();
          else onClose?.();
        }}
        className={`w-full flex items-center justify-between rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-left transition-all
          ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:border-slate-300'}
          ${isOpen ? 'ring-2 ring-indigo-500 border-indigo-500' : ''}
          ${buttonClassName ? buttonClassName : 'px-3 py-2.5 bg-slate-50 border border-slate-200 text-sm'}`}
      >
        <span className={`truncate ${selectedOption ? "text-slate-800 font-semibold" : "text-slate-400"}`}>
          {selectedOption ? selectedOption.name : placeholder || 'Select...'}
        </span>
        <i className={`fa-solid fa-chevron-down text-[10px] text-slate-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}></i>
      </button>

      {isOpen && !disabled && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-slate-200 rounded-xl shadow-xl py-1 max-h-60 overflow-y-auto animate-in fade-in zoom-in-95 duration-100 origin-top">
          {searchable && (
            <div className="px-2 pt-2 pb-1 sticky top-0 bg-white border-b border-slate-50 z-10">
              <input
                type="text"
                autoFocus
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search..."
                className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-700"
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          )}

          {filteredOptions.length === 0 ? (
            <div className="px-4 py-3 text-xs text-slate-400 italic text-center">No options found</div>
          ) : (
            filteredOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => {
                  onChange(option.id);
                  setIsOpen(false);
                  onClose?.();
                  setSearchTerm('');
                }}
                className={`w-full text-left px-4 py-2.5 text-sm transition-colors flex items-center justify-between ${value === option.id
                  ? 'bg-indigo-50 text-indigo-700 font-bold'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                  }`}
              >
                <span className="truncate">{option.name}</span>
                {value === option.id && <i className="fa-solid fa-check text-[10px]"></i>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
};

export default CustomSelect;
