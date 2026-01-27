import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

interface TableFilterProps {
  title: string;
  options: string[];
  selectedValues: string[];
  onFilterChange: (selected: string[]) => void;
  sortDirection: 'asc' | 'desc' | null;
  onSortChange: (dir: 'asc' | 'desc' | null) => void;
  onClose: () => void;
}

const TableFilter: React.FC<TableFilterProps> = ({
  title,
  options,
  selectedValues,
  onFilterChange,
  sortDirection,
  onSortChange,
  onClose,
}) => {
  const { t } = useTranslation('common');
  const [searchTerm, setSearchTerm] = useState('');

  const filteredOptions = useMemo(() => {
    if (!searchTerm) return options;
    return options.filter((opt) => String(opt).toLowerCase().includes(searchTerm.toLowerCase()));
  }, [options, searchTerm]);

  const handleCheckboxChange = (value: string) => {
    const newSelected = selectedValues.includes(value)
      ? selectedValues.filter((v) => v !== value)
      : [...selectedValues, value];
    onFilterChange(newSelected);
  };

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      // Select all visible options
      const newSelected = Array.from(new Set([...selectedValues, ...filteredOptions]));
      onFilterChange(newSelected);
    } else {
      // Deselect all visible options
      const newSelected = selectedValues.filter((val) => !filteredOptions.includes(val));
      onFilterChange(newSelected);
    }
  };

  const isAllSelected =
    filteredOptions.length > 0 && filteredOptions.every((opt) => selectedValues.includes(opt));
  const isIndeterminate =
    !isAllSelected && filteredOptions.some((opt) => selectedValues.includes(opt));

  return (
    <div className="absolute top-full left-0 mt-2 w-64 bg-white rounded-xl shadow-xl border border-slate-200 z-50 flex flex-col text-left font-normal animate-in fade-in zoom-in-95 duration-200">
      {/* Header with Sort Controls */}
      <div className="p-3 border-b border-slate-100 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">
            {title}
          </span>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <i className="fa-solid fa-xmark"></i>
          </button>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => onSortChange('asc')}
            className={`flex-1 py-2 text-xs font-bold rounded-lg border transition-colors flex items-center justify-center gap-2 ${
              sortDirection === 'asc'
                ? 'bg-praetor text-white border-praetor'
                : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
            }`}
          >
            <i className="fa-solid fa-arrow-down-a-z"></i> {t('table.sortAsc')}
          </button>
          <button
            onClick={() => onSortChange('desc')}
            className={`flex-1 py-2 text-xs font-bold rounded-lg border transition-colors flex items-center justify-center gap-2 ${
              sortDirection === 'desc'
                ? 'bg-praetor text-white border-praetor'
                : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
            }`}
          >
            <i className="fa-solid fa-arrow-up-a-z"></i> {t('table.sortDesc')}
          </button>
        </div>
      </div>

      {/* Search Bar */}
      <div className="p-3 border-b border-slate-100">
        <div className="relative">
          <i className="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs"></i>
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={t('table.search')}
            className="w-full pl-8 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs outline-none focus:ring-2 focus:ring-praetor transition-all"
            autoFocus
          />
        </div>
      </div>

      {/* Options List */}
      <div className="max-h-48 overflow-y-auto p-2 space-y-1">
        <label className="flex items-center gap-2 px-2 py-1.5 hover:bg-slate-50 rounded-lg cursor-pointer">
          <input
            type="checkbox"
            checked={isAllSelected}
            ref={(input) => {
              if (input) input.indeterminate = isIndeterminate;
            }}
            onChange={handleSelectAll}
            className="w-4 h-4 rounded text-praetor focus:ring-praetor border-gray-300"
          />
          <span className="text-xs text-slate-600 select-none">({t('table.selectAll')})</span>
        </label>
        {filteredOptions.length > 0 ? (
          filteredOptions.map((opt) => (
            <label
              key={opt}
              className="flex items-center gap-2 px-2 py-1.5 hover:bg-slate-50 rounded-lg cursor-pointer"
            >
              <input
                type="checkbox"
                checked={selectedValues.includes(opt)}
                onChange={() => handleCheckboxChange(opt)}
                className="w-4 h-4 rounded text-praetor focus:ring-praetor border-gray-300"
              />
              <span className="text-xs text-slate-600 truncate select-none" title={opt}>
                {opt}
              </span>
            </label>
          ))
        ) : (
          <div className="text-center py-4 text-xs text-slate-400">{t('table.noResults')}</div>
        )}
      </div>

      {/* Footer */}
      <div className="p-3 border-t border-slate-100 bg-slate-50 rounded-b-xl flex justify-between items-center">
        <button
          onClick={() => {
            onFilterChange([]);
            // onSortChange(null); // Optional: clear sort too? usually separate.
          }}
          className="text-xs font-bold text-slate-500 hover:text-red-500 transition-colors"
        >
          {t('table.clearFilter')}
        </button>
      </div>
    </div>
  );
};

export default TableFilter;
