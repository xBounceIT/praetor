import type { ReportChatSessionSummary } from '@/types';

export type AiReportingSessionGroupKey = 'today' | 'yesterday' | 'lastSevenDays' | 'older';

export interface AiReportingSessionGroup {
  key: AiReportingSessionGroupKey;
  sessions: ReportChatSessionSummary[];
}

const SESSION_GROUP_ORDER: AiReportingSessionGroupKey[] = [
  'today',
  'yesterday',
  'lastSevenDays',
  'older',
];

const startOfLocalDay = (timestamp: number) => {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

export const filterAndGroupAiReportingSessions = (
  sessions: ReportChatSessionSummary[],
  query: string,
  now = Date.now(),
): AiReportingSessionGroup[] => {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const todayStart = startOfLocalDay(now);
  const yesterdayStartDate = new Date(todayStart);
  yesterdayStartDate.setDate(yesterdayStartDate.getDate() - 1);
  const yesterdayStart = yesterdayStartDate.getTime();
  const lastSevenDaysStartDate = new Date(todayStart);
  lastSevenDaysStartDate.setDate(lastSevenDaysStartDate.getDate() - 6);
  const lastSevenDaysStart = lastSevenDaysStartDate.getTime();

  const grouped = new Map<AiReportingSessionGroupKey, ReportChatSessionSummary[]>(
    SESSION_GROUP_ORDER.map((key) => [key, []]),
  );

  for (const session of sessions) {
    if (normalizedQuery && !session.title.toLocaleLowerCase().includes(normalizedQuery)) continue;

    const updatedAt = Number.isFinite(session.updatedAt) ? session.updatedAt : 0;
    const key: AiReportingSessionGroupKey =
      updatedAt >= todayStart
        ? 'today'
        : updatedAt >= yesterdayStart
          ? 'yesterday'
          : updatedAt >= lastSevenDaysStart
            ? 'lastSevenDays'
            : 'older';
    grouped.get(key)?.push(session);
  }

  return SESSION_GROUP_ORDER.flatMap((key) => {
    const groupedSessions = grouped.get(key) ?? [];
    return groupedSessions.length > 0 ? [{ key, sessions: groupedSessions }] : [];
  });
};
