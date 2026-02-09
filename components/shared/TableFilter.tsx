import type React from 'react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Checkbox from './Checkbox';
import Tooltip from './Tooltip';

export interface TableFilterProps {
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
    <div className="w-56 bg-white rounded-2xl shadow-xl border border-slate-200 flex flex-col text-left font-normal animate-in fade-in zoom-in-95 duration-200">
      {/* Header */}
      <div className="p-2 border-b border-slate-100 flex items-center justify-between">
        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
          {title}
        </span>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xs">
          <i className="fa-solid fa-xmark"></i>
        </button>
      </div>

      {/* Sort Options - Excel Style */}
      <div className="border-b border-slate-100">
        <button
          onClick={() => onSortChange('asc')}
          className={`w-full px-3 py-2 text-left text-[11px] font-semibold transition-colors flex items-center gap-2 ${
            sortDirection === 'asc'
              ? 'bg-slate-100 text-praetor'
              : 'text-slate-700 hover:bg-slate-50'
          }`}
        >
          <i className="fa-solid fa-arrow-down-a-z w-4"></i>
          <span>{t('table.sortAsc')}</span>
        </button>
        <button
          onClick={() => onSortChange('desc')}
          className={`w-full px-3 py-2 text-left text-[11px] font-semibold transition-colors flex items-center gap-2 border-t border-slate-100 ${
            sortDirection === 'desc'
              ? 'bg-slate-100 text-praetor'
              : 'text-slate-700 hover:bg-slate-50'
          }`}
        >
          <i className="fa-solid fa-arrow-up-a-z w-4"></i>
          <span>{t('table.sortDesc')}</span>
        </button>
      </div>

      {/* Search Bar */}
      <div className="p-2 border-b border-slate-100">
        <div className="relative">
          <i className="fa-solid fa-magnifying-glass absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-[10px]"></i>
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={t('table.search')}
            className="w-full pl-6 pr-2 py-1.5 bg-slate-50 border border-slate-200 focus:border-praetor rounded-lg text-[11px] outline-none transition-none"
            autoFocus
          />
        </div>
      </div>

      {/* Options List */}
      <div className="max-h-40 overflow-y-auto p-1.5 space-y-0.5">
        <label className="flex items-center gap-1.5 px-1.5 py-1 hover:bg-slate-50 rounded cursor-pointer">
          <Checkbox
            size="sm"
            checked={isAllSelected}
            indeterminate={isIndeterminate}
            onChange={handleSelectAll}
          />
          <span className="text-[11px] text-slate-600 select-none font-semibold">
            ({t('table.selectAll')})
          </span>
        </label>
        {filteredOptions.length > 0 ? (
          filteredOptions.map((opt) => (
            <label
              key={opt}
              className="flex items-center gap-1.5 px-1.5 py-1 hover:bg-slate-50 rounded cursor-pointer"
            >
              <Checkbox
                size="sm"
                checked={selectedValues.includes(opt)}
                onChange={() => handleCheckboxChange(opt)}
              />
              <Tooltip label={opt}>
                {() => (
                  <span className="text-[11px] text-slate-600 truncate select-none">{opt}</span>
                )}
              </Tooltip>
            </label>
          ))
        ) : (
          <div className="text-center py-3 text-[11px] text-slate-400">{t('table.noResults')}</div>
        )}
      </div>

      <div className="p-2 border-t border-slate-100">
        <button
          onClick={() => {
            onFilterChange([]);
          }}
          className="w-full px-3 py-1.5 text-[11px] font-semibold text-slate-600 hover:text-white bg-slate-50 hover:bg-red-500 rounded-lg transition-all flex items-center justify-center gap-1.5"
        >
          <i className="fa-solid fa-filter-circle-xmark"></i>
          <span>{t('table.clearFilter')}</span>
        </button>
      </div>
    </div>
  );
};

export default TableFilter;
