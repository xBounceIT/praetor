import type React from 'react';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import Checkbox from './Checkbox';

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
  const selectedValueSet = new Set(selectedValues);

  const displayLabel = useCallback((opt: string) => (opt === '' ? t('table.empty') : opt), [t]);

  const filteredOptions = useMemo(() => {
    if (!searchTerm) return options;
    const needle = searchTerm.toLowerCase();
    return options.filter((opt) => displayLabel(opt).toLowerCase().includes(needle));
  }, [options, searchTerm, displayLabel]);

  const handleCheckboxChange = (value: string) => {
    const newSelected = selectedValueSet.has(value)
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
      const filteredOptionSet = new Set(filteredOptions);
      const newSelected = selectedValues.filter((val) => !filteredOptionSet.has(val));
      onFilterChange(newSelected);
    }
  };

  const isAllSelected =
    filteredOptions.length > 0 && filteredOptions.every((opt) => selectedValueSet.has(opt));
  const isIndeterminate =
    !isAllSelected && filteredOptions.some((opt) => selectedValueSet.has(opt));

  return (
    <div className="w-56 bg-white rounded-2xl shadow-xl border border-zinc-200 flex flex-col text-left font-normal animate-in fade-in zoom-in-95 duration-200">
      {/* Header */}
      <div className="p-2 border-b border-zinc-100 flex items-center justify-between">
        <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
          {title}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('buttons.close')}
          className="text-zinc-400 hover:text-zinc-600 text-xs"
        >
          <i className="fa-solid fa-xmark"></i>
        </button>
      </div>

      {/* Sort Options - Excel Style */}
      <div className="border-b border-zinc-100">
        <button
          type="button"
          onClick={() => onSortChange('asc')}
          className={`w-full px-3 py-2 text-left text-[11px] font-semibold transition-colors flex items-center gap-2 ${
            sortDirection === 'asc' ? 'bg-zinc-100 text-praetor' : 'text-zinc-700 hover:bg-zinc-50'
          }`}
        >
          <i className="fa-solid fa-arrow-down-a-z w-4"></i>
          <span>{t('table.sortAsc')}</span>
        </button>
        <button
          type="button"
          onClick={() => onSortChange('desc')}
          className={`w-full px-3 py-2 text-left text-[11px] font-semibold transition-colors flex items-center gap-2 border-t border-zinc-100 ${
            sortDirection === 'desc' ? 'bg-zinc-100 text-praetor' : 'text-zinc-700 hover:bg-zinc-50'
          }`}
        >
          <i className="fa-solid fa-arrow-up-a-z w-4"></i>
          <span>{t('table.sortDesc')}</span>
        </button>
      </div>

      {/* Search Bar */}
      <div className="p-2 border-b border-zinc-100">
        <div className="relative">
          <i className="fa-solid fa-magnifying-glass absolute left-2 top-1/2 -translate-y-1/2 text-zinc-400 text-[10px]"></i>
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={t('table.search')}
            aria-label={t('table.search')}
            className="w-full pl-6 pr-2 py-1.5 bg-zinc-50 border border-zinc-200 focus:border-praetor rounded-lg text-[11px] outline-none transition-none"
          />
        </div>
      </div>

      {/* Options List */}
      <div className="max-h-40 overflow-y-auto p-1.5 space-y-0.5">
        <label className="flex items-center gap-1.5 px-1.5 py-1 hover:bg-zinc-50 rounded cursor-pointer">
          <Checkbox
            size="sm"
            checked={isAllSelected}
            indeterminate={isIndeterminate}
            onChange={handleSelectAll}
          />
          <span className="text-[11px] text-zinc-600 select-none font-semibold">
            ({t('table.selectAll')})
          </span>
        </label>
        {filteredOptions.length > 0 ? (
          filteredOptions.map((opt) => (
            <label
              key={opt}
              className="flex items-center gap-1.5 px-1.5 py-1 hover:bg-zinc-50 rounded cursor-pointer"
            >
              <Checkbox
                size="sm"
                checked={selectedValueSet.has(opt)}
                onChange={() => handleCheckboxChange(opt)}
              />
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex">
                    <span className="text-[11px] text-zinc-600 truncate select-none">
                      {displayLabel(opt)}
                    </span>
                  </span>
                </TooltipTrigger>
                <TooltipContent>{displayLabel(opt)}</TooltipContent>
              </Tooltip>
            </label>
          ))
        ) : (
          <div className="text-center py-3 text-[11px] text-zinc-400">{t('table.noResults')}</div>
        )}
      </div>

      <div className="p-2 border-t border-zinc-100">
        <button
          type="button"
          onClick={() => {
            onFilterChange([]);
          }}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-zinc-50 px-3 py-1.5 text-[11px] font-semibold text-red-700 transition-all hover:bg-red-500 hover:text-white"
        >
          <i className="fa-solid fa-filter-circle-xmark"></i>
          <span>{t('table.clearFilter')}</span>
        </button>
      </div>
    </div>
  );
};

export default TableFilter;
