import { formatInsertDateTime } from '@/utils/date';

export interface VersionHistoryFilterableRow {
  id: string;
  createdAt: number;
  reason: 'update' | 'restore';
  revisionCode?: string;
  createdByUserName?: string | null;
}

export interface VersionHistoryFilterLabels {
  reasonRestore: string;
  reasonUpdate: string;
}

/**
 * Filters history rows by a free-text query against code, reason label,
 * formatted date, and author name.
 */
export function filterVersionHistoryRows<Row extends VersionHistoryFilterableRow>(
  rows: Row[],
  query: string,
  locale: string,
  labels: VersionHistoryFilterLabels,
): Row[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return rows;

  return rows.filter((row) => {
    const haystack = [
      row.revisionCode ?? '',
      row.createdByUserName ?? '',
      formatInsertDateTime(row.createdAt, locale),
      row.reason === 'restore' ? labels.reasonRestore : labels.reasonUpdate,
    ]
      .join(' ')
      .toLocaleLowerCase();

    return haystack.includes(normalized);
  });
}
