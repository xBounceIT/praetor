import type { ReactNode } from 'react';

type StandardTableProps = {
  title: string;
  totalCount?: number;
  totalLabel?: string;
  headerExtras?: ReactNode;
  headerAction?: ReactNode;
  containerClassName?: string;
  tableContainerClassName?: string;
  footer?: ReactNode;
  footerClassName?: string;
  children: ReactNode;
};

const StandardTable = ({
  title,
  totalCount,
  totalLabel = 'TOTAL',
  headerExtras,
  headerAction,
  containerClassName,
  tableContainerClassName,
  footer,
  footerClassName,
  children,
}: StandardTableProps) => {
  return (
    <div className={`bg-white rounded-3xl border border-slate-200 shadow-sm ${containerClassName ?? ''}`.trim()}>
      <div className="px-8 py-5 bg-slate-50 border-b border-slate-200 flex justify-between items-center rounded-t-3xl">
        <div className="flex items-center gap-3">
          <h4 className="font-black text-slate-400 uppercase text-[10px] tracking-widest">{title}</h4>
          {typeof totalCount === 'number' && (
            <span className="bg-slate-100 text-praetor px-3 py-1 rounded-full text-[10px] font-black">
              {totalCount} {totalLabel}
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
      <div className={tableContainerClassName ?? 'overflow-x-auto'}>{children}</div>
      {footer && (
        <div
          className={`px-8 py-4 bg-slate-50 border-t border-slate-200 rounded-b-3xl ${
            footerClassName ?? 'flex justify-between items-center'
          }`}
        >
          {footer}
        </div>
      )}
    </div>
  );
};

export default StandardTable;
