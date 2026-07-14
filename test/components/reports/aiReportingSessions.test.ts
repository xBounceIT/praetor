import { describe, expect, test } from 'bun:test';
import { filterAndGroupAiReportingSessions } from '@/components/reports/aiReportingSessions';
import type { ReportChatSessionSummary } from '@/types';

const NOW = new Date(2026, 6, 14, 12, 0, 0).getTime();

const daysAgo = (days: number) => {
  const date = new Date(NOW);
  date.setDate(date.getDate() - days);
  return date.getTime();
};

const session = (id: string, title: string, updatedAt: number): ReportChatSessionSummary => ({
  id,
  title,
  createdAt: updatedAt,
  updatedAt,
});

describe('filterAndGroupAiReportingSessions', () => {
  test('groups sessions by local calendar period while preserving server order', () => {
    const groups = filterAndGroupAiReportingSessions(
      [
        session('today', 'Today session', daysAgo(0)),
        session('yesterday', 'Yesterday session', daysAgo(1)),
        session('recent-a', 'Recent A', daysAgo(3)),
        session('recent-b', 'Recent B', daysAgo(6)),
        session('older', 'Older session', daysAgo(10)),
      ],
      '',
      NOW,
    );

    expect(groups.map((group) => group.key)).toEqual([
      'today',
      'yesterday',
      'lastSevenDays',
      'older',
    ]);
    expect(groups[2]?.sessions.map((item) => item.id)).toEqual(['recent-a', 'recent-b']);
  });

  test('filters titles case-insensitively and omits empty groups', () => {
    const groups = filterAndGroupAiReportingSessions(
      [
        session('one', 'Quarterly Revenue', daysAgo(0)),
        session('two', 'Project capacity', daysAgo(2)),
      ],
      'REVENUE',
      NOW,
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]?.key).toBe('today');
    expect(groups[0]?.sessions.map((item) => item.id)).toEqual(['one']);
    expect(filterAndGroupAiReportingSessions(groups[0]?.sessions ?? [], 'missing', NOW)).toEqual(
      [],
    );
  });
});
