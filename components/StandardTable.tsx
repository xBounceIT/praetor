import { ReactNode, useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import TableFilter from './TableFilter';
import CustomSelect from './CustomSelect';

export type Column<T> = {
  header: string;
  accessorKey?: keyof T;
  accessorFn?: (row: T) => string | number | boolean | null | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cell?: (info: { getValue: () => any; row: T; value: any }) => ReactNode;
  id?: string; // Unique ID for the column, required if accessorKey is missing
  className?: string;
  headerClassName?: string;
  disableSorting?: boolean;
  disableFiltering?: boolean;
  filterFormat?: (value: unknown) => string;
  align?: 'left' | 'center' | 'right';
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type StandardTableProps<T = any> = {
  title: string;
  totalCount?: number;
  totalLabel?: string;
  headerExtras?: ReactNode;
  headerAction?: ReactNode;
  containerClassName?: string;
  tableContainerClassName?: string;
  footer?: ReactNode;
  footerClassName?: string;
  children?: ReactNode;
  emptyState?: ReactNode;
  // Data-driven props
  data?: T[];
  columns?: Column<T>[];
  defaultRowsPerPage?: number;
  rowClassName?: (row: T) => string;
  onRowClick?: (row: T) => void;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const StandardTable = <T extends Record<string, any>>({
  title,
  totalCount: externalTotalCount,
  totalLabel,
  headerExtras,
  headerAction,
  containerClassName,
  tableContainerClassName,
  footer: externalFooter,
  footerClassName,
  children,
  emptyState,
  data,
  columns,
  defaultRowsPerPage = 10,
  rowClassName,
  onRowClick,
}: StandardTableProps<T>) => {
  const { t } = useTranslation('common');
  const filterRef = useRef<HTMLDivElement>(null); // Ref for the filter logic/container in the table
  const popupRef = useRef<HTMLDivElement>(null); // Ref for the Portal popup

  // Internal State for Data Mode
  // Helper for key generation
  const getStorageKey = (t: string) =>
    `praetor_table_rows_${t.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()}`;

  const [sortState, setSortState] = useState<{ colId: string; px: 'asc' | 'desc' } | null>(null);
  const [filterState, setFilterState] = useState<Record<string, string[]>>({});
  const [activeFilterCol, setActiveFilterCol] = useState<string | null>(null);
  const [filterPos, setFilterPos] = useState<{ top: number; left: number } | null>(null);
  const [currentPage, setCurrentPage] = useState(1);

  // Lazy initialization for rowsPerPage
  const [rowsPerPage, setRowsPerPage] = useState(() => {
    if (typeof window === 'undefined') return defaultRowsPerPage;
    const key = getStorageKey(title);
    const saved = localStorage.getItem(key);
    if (saved) {
      const val = Number(saved);
      if ([5, 10, 20, 50].includes(val)) {
        return val;
      }
    }
    return defaultRowsPerPage;
  });

  const storageKey = useMemo(() => getStorageKey(title), [title]);

  // Close filter popup when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      // Check if click is outside BOTH the trigger button (filterRef) AND the popup (popupRef)
      if (
        filterRef.current &&
        !filterRef.current.contains(event.target as Node) &&
        popupRef.current &&
        !popupRef.current.contains(event.target as Node)
      ) {
        setActiveFilterCol(null);
      }
    };

    if (activeFilterCol) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [activeFilterCol]);

  // Helper to resolve value
  const getValue = useCallback((row: T, col: Column<T>) => {
    if (col.accessorFn) return col.accessorFn(row);
    if (col.accessorKey) return row[col.accessorKey];
    return null;
  }, []);

  const getColId = useCallback(
    (col: Column<T>) => col.id || (col.accessorKey as string) || col.header,
    [],
  );

  // Derived Data
  const processedData = useMemo(() => {
    if (!data || !columns) return [];
    let result = [...data];

    // 1. Filtering
    Object.keys(filterState).forEach((filterColId) => {
      const selectedValues = filterState[filterColId];
      if (selectedValues && selectedValues.length > 0) {
        const col = columns.find((c) => getColId(c) === filterColId);
        if (col) {
          result = result.filter((row) => {
            const rawVal = getValue(row, col);
            const val = col.filterFormat ? col.filterFormat(rawVal) : String(rawVal);
            return selectedValues.includes(val);
          });
        }
      }
    });

    // 2. Sorting
    if (sortState) {
      const col = columns.find((c) => getColId(c) === sortState.colId);
      if (col) {
        result.sort((a, b) => {
          const valA = getValue(a, col);
          const valB = getValue(b, col);

          // Simple comparison handling numbers and strings
          if (typeof valA === 'number' && typeof valB === 'number') {
            return sortState.px === 'asc' ? valA - valB : valB - valA;
          }
          const strA = String(valA || '').toLowerCase();
          const strB = String(valB || '').toLowerCase();
          if (strA < strB) return sortState.px === 'asc' ? -1 : 1;
          if (strA > strB) return sortState.px === 'asc' ? 1 : -1;
          return 0;
        });
      }
    }

    return result;
  }, [data, columns, filterState, sortState, getValue, getColId]);

  // Pagination
  const totalItems = data ? processedData.length : externalTotalCount || 0;
  const totalPages = Math.ceil(totalItems / rowsPerPage);
  const startIndex = (currentPage - 1) * rowsPerPage;
  const paginatedData = data ? processedData.slice(startIndex, startIndex + rowsPerPage) : [];

  // Filter Options Generator
  const getFilterOptions = (colId: string) => {
    if (!data || !columns) return [];
    const col = columns.find((c) => getColId(c) === colId);
    if (!col) return [];

    // Get all unique values from the FULL dataset
    const values = new Set<string>();
    data.forEach((row) => {
      const val = getValue(row, col);
      values.add(col.filterFormat ? col.filterFormat(val) : String(val));
    });
    return Array.from(values).sort();
  };

  // Handlers
  const handleSort = (colId: string, dir: 'asc' | 'desc' | null) => {
    if (!dir) setSortState(null);
    else setSortState({ colId, px: dir });
  };

  const handleFilter = (colId: string, selected: string[]) => {
    setFilterState((prev) => {
      const next = { ...prev };
      if (selected.length === 0) delete next[colId];
      else next[colId] = selected;
      return next;
    });
    setCurrentPage(1); // Reset to page 1 on filter
  };

  // Close popup on click outside (simplified, relies on conditional rendering)

  // Internal Footer Render
  const renderInternalFooter = () => (
    <>
      <div className="flex items-center gap-3">
        <span className="text-xs font-bold text-slate-500">{t('pagination.rowsPerPage')}</span>
        <CustomSelect
          options={[
            { id: '5', name: '5' },
            { id: '10', name: '10' },
            { id: '20', name: '20' },
            { id: '50', name: '50' },
          ]}
          value={rowsPerPage.toString()}
          onChange={(val) => {
            const newValue = Number(val);
            setRowsPerPage(newValue);
            setCurrentPage(1);
            if (storageKey) {
              localStorage.setItem(storageKey, String(newValue));
            }
          }}
          className="w-20"
          buttonClassName="px-2 py-1 bg-white border border-slate-200 text-xs font-bold text-slate-700 rounded-lg"
          searchable={false}
        />
        <span className="text-xs font-bold text-slate-400 ml-2">
          {t('pagination.showing')
            .replace('{{start}}', String(totalItems > 0 ? startIndex + 1 : 0))
            .replace('{{end}}', String(Math.min(startIndex + rowsPerPage, totalItems)))
            .replace('{{total}}', String(totalItems))}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
          disabled={currentPage === 1}
          className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
        >
          <i className="fa-solid fa-chevron-left text-xs"></i>
        </button>
        <div className="flex items-center gap-1">
          {/* Simple pagination logic: show all pages logic might be too big, limiting to 5 mostly used in InternalListingView */}
          {Array.from({ length: totalPages }, (_, i) => i + 1)
            .filter(
              (p) => p === 1 || p === totalPages || (p >= currentPage - 1 && p <= currentPage + 1),
            )
            .map((page, i, arr) => (
              <div key={page} className="flex items-center">
                {i > 0 && page - arr[i - 1] > 1 && <span className="text-slate-400 mx-1">...</span>}
                <button
                  onClick={() => setCurrentPage(page)}
                  className={`w-8 h-8 flex items-center justify-center rounded-lg text-xs font-bold transition-all ${
                    currentPage === page
                      ? 'bg-praetor text-white shadow-md shadow-slate-200'
                      : 'text-slate-500 hover:bg-slate-100'
                  }`}
                >
                  {page}
                </button>
              </div>
            ))}
        </div>
        <button
          onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
          disabled={currentPage === totalPages || totalPages === 0}
          className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
        >
          <i className="fa-solid fa-chevron-right text-xs"></i>
        </button>
      </div>
    </>
  );

  // Render Columns
  return (
    <div
      className={`bg-white rounded-3xl border border-slate-200 shadow-sm ${containerClassName ?? ''}`.trim()}
    >
      <div className="px-8 py-5 bg-slate-50 border-b border-slate-200 flex justify-between items-center rounded-t-3xl">
        <div className="flex items-center gap-3">
          <h4 className="font-black text-slate-400 uppercase text-[10px] tracking-widest">
            {title}
          </h4>
          {typeof totalItems === 'number' && (
            <span className="bg-slate-100 text-praetor px-3 py-1 rounded-full text-[10px] font-black uppercase">
              {totalItems} {totalLabel || t('table.total')}
            </span>
          )}
        </div>
        {(headerExtras || headerAction) && (
          <div className="flex items-center gap-3">
            {headerExtras}
            {headerAction}
          </div>
        )}
      </div>

      <div className={tableContainerClassName ?? 'overflow-x-auto custom-horizontal-scrollbar'}>
        {columns && data ? (
          <table className="w-full text-left border-collapse">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                {columns.map((col) => {
                  const colId = getColId(col);
                  const isFiltered = filterState[colId] && filterState[colId].length > 0;
                  const isSorted = sortState?.colId === colId;

                  return (
                    <th
                      key={colId}
                      className={`px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest ${col.headerClassName || ''}`}
                    >
                      {/* Full-width wrapper for proper positioning context */}
                      <div
                        className={`relative w-full flex items-center ${col.align === 'right' ? 'justify-end' : col.align === 'center' ? 'justify-center' : ''}`}
                      >
                        {/* Header text - with padding to avoid filter button overlap */}
                        <span className={col.align === 'right' ? 'pr-6' : ''}>{col.header}</span>

                        {/* Filter button - absolutely positioned within the full-width wrapper */}
                        {!col.disableFiltering && (
                          <div
                            ref={activeFilterCol === colId ? filterRef : undefined}
                            className={`absolute ${col.align === 'right' ? 'left-0' : 'right-0'} top-1/2 -translate-y-1/2`}
                          >
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (activeFilterCol === colId) {
                                  setActiveFilterCol(null);
                                } else {
                                  const rect = e.currentTarget.getBoundingClientRect();
                                  setFilterPos({
                                    top: rect.bottom + window.scrollY + 4,
                                    left: rect.left + window.scrollX,
                                  });
                                  setActiveFilterCol(colId);
                                }
                              }}
                              className={`p-1 rounded hover:bg-slate-200 transition-colors ${
                                isFiltered || isSorted || activeFilterCol === colId
                                  ? 'text-praetor'
                                  : 'text-slate-400'
                              }`}
                            >
                              <i className="fa-solid fa-filter"></i>
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Portal for filter popup - outside the wrapper */}
                      {activeFilterCol === colId &&
                        filterPos &&
                        createPortal(
                          <div
                            ref={popupRef}
                            style={{
                              top: filterPos.top,
                              left: filterPos.left,
                              position: 'absolute',
                              zIndex: 9999,
                            }}
                          >
                            <TableFilter
                              title={col.header}
                              options={getFilterOptions(colId)}
                              selectedValues={filterState[colId] || []}
                              onFilterChange={(selected) => handleFilter(colId, selected)}
                              sortDirection={sortState?.colId === colId ? sortState.px : null}
                              onSortChange={(dir) => handleSort(colId, dir)}
                              onClose={() => setActiveFilterCol(null)}
                            />
                          </div>,
                          document.body,
                        )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {paginatedData.length > 0 ? (
                paginatedData.map((row, idx) => (
                  <tr
                    key={idx}
                    onClick={() => onRowClick && onRowClick(row)}
                    className={`transition-colors text-sm ${onRowClick ? 'cursor-pointer' : ''} ${rowClassName ? rowClassName(row) : 'hover:bg-slate-50/50'}`}
                  >
                    {columns.map((col) => {
                      const val = getValue(row, col);
                      return (
                        <td
                          key={getColId(col)}
                          className={`px-6 py-5 ${col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : ''} ${col.className || ''}`}
                        >
                          {col.cell
                            ? col.cell({ getValue: () => val, row, value: val })
                            : (val as ReactNode)}
                        </td>
                      );
                    })}
                  </tr>
                ))
              ) : (
                <tr>
                  <td
                    colSpan={columns.length}
                    className="p-12 text-center text-slate-400 text-sm font-bold"
                  >
                    {emptyState ?? t('table.noResults')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        ) : (
          children
        )}
      </div>

      {(externalFooter || (data && columns)) && (
        <div
          className={`px-8 py-4 bg-slate-50 border-t border-slate-200 rounded-b-3xl ${
            footerClassName ?? 'flex justify-between items-center flex-wrap gap-4'
          }`}
        >
          {data && columns ? renderInternalFooter() : externalFooter}
        </div>
      )}
    </div>
  );
};

export default StandardTable;
