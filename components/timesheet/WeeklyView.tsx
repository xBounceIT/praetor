import type React from 'react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { Client, Project, ProjectTask, TimeEntry } from '../../types';
import { getLocalDateString } from '../../utils/date';
import { isItalianHoliday } from '../../utils/holidays';

export interface WeeklyViewProps {
  entries: TimeEntry[];
  clients: Client[];
  projects: Project[];
  projectTasks: ProjectTask[];
  viewingUserId: string;
  selectedDate: string;
  onSelectedDateChange: (date: string) => void;
  startOfWeek: 'Monday' | 'Sunday';
  treatSaturdayAsHoliday: boolean;
  allowWeekendSelection?: boolean;
  dailyGoal: number;
}

const getWeekStart = (date: Date, startOfWeek: 'Monday' | 'Sunday'): Date => {
  const d = new Date(date);
  const day = d.getDay();
  // Sunday-first: shift back by `day` days. Monday-first: shift back by `day - 1`
  // days, except for Sunday (day === 0) which should jump back 6 days.
  const diff =
    startOfWeek === 'Sunday' ? d.getDate() - day : d.getDate() - day + (day === 0 ? -6 : 1);
  const start = new Date(d.setDate(diff));
  start.setHours(0, 0, 0, 0);
  return start;
};

const dateOnlyToLocalDate = (dateOnly: string): Date => {
  const [year, month, day] = dateOnly.split('-').map(Number);
  return new Date(year, month - 1, day);
};

type EntryRow = {
  key: string;
  label: string;
  days: Record<string, number>;
  maxCreatedAt: number;
};

const WeeklyView: React.FC<WeeklyViewProps> = ({
  entries,
  clients,
  projects,
  projectTasks,
  viewingUserId,
  selectedDate,
  onSelectedDateChange,
  startOfWeek,
  treatSaturdayAsHoliday,
  allowWeekendSelection = false,
  dailyGoal,
}) => {
  const { t, i18n } = useTranslation('timesheets');

  const currentWeekStart = useMemo(
    () => getWeekStart(dateOnlyToLocalDate(selectedDate), startOfWeek),
    [selectedDate, startOfWeek],
  );

  const weekDays = useMemo(() => {
    return [0, 1, 2, 3, 4, 5, 6].map((offset) => {
      const d = new Date(currentWeekStart);
      d.setDate(d.getDate() + offset);
      const dateStr = getLocalDateString(d);
      const holidayName = isItalianHoliday(new Date(`${dateStr}T00:00:00`));
      const isSunday = d.getDay() === 0;
      const isSaturday = d.getDay() === 6;
      const isWeekendOrHoliday =
        isSunday || (treatSaturdayAsHoliday && isSaturday) || !!holidayName;
      const isForbidden = !allowWeekendSelection && isWeekendOrHoliday;
      const dayKey = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][d.getDay()];

      return {
        dateStr,
        dayKey,
        dayNum: d.getDate(),
        isToday: dateStr === getLocalDateString(new Date()),
        isForbidden,
        isWeekendOrHoliday,
        holidayName,
      };
    });
  }, [currentWeekStart, treatSaturdayAsHoliday, allowWeekendSelection]);

  const weekDates = useMemo(() => weekDays.map((d) => d.dateStr), [weekDays]);

  const userEntries = useMemo(
    () => entries.filter((e) => e.userId === viewingUserId),
    [entries, viewingUserId],
  );

  // Every distinct (client, project, task) combination with at least one entry
  // in the current week, in-scope of the user's catalogs. No row cap — the
  // grid mirrors exactly what's logged for the visible week.
  const entryRows: EntryRow[] = useMemo(() => {
    const groups = new Map<string, EntryRow>();
    const clientById = new Map(clients.map((c) => [c.id, c]));
    const projectById = new Map(projects.map((p) => [p.id, p]));
    const taskKey = (projectId: string, name: string) => `${projectId}|${name}`;
    const taskSet = new Set(projectTasks.map((task) => taskKey(task.projectId, task.name)));

    for (const entry of userEntries) {
      if (!weekDates.includes(entry.date)) continue;
      if (!clientById.has(entry.clientId)) continue;
      if (!projectById.has(entry.projectId)) continue;
      if (!taskSet.has(taskKey(entry.projectId, entry.task))) continue;

      const key = `${entry.clientId}|${entry.projectId}|${entry.task}`;
      let row = groups.get(key);
      if (!row) {
        const client = clientById.get(entry.clientId);
        const project = projectById.get(entry.projectId);
        row = {
          key,
          label: [client?.name, project?.name, entry.task].filter(Boolean).join(' · '),
          days: {},
          maxCreatedAt: entry.createdAt,
        };
        groups.set(key, row);
      }
      if (entry.createdAt > row.maxCreatedAt) row.maxCreatedAt = entry.createdAt;
      // Multiple entries on the same day for the same combo are summed — the
      // grid shows the day's total hours per task, not individual entries.
      row.days[entry.date] = (row.days[entry.date] ?? 0) + entry.duration;
    }

    return Array.from(groups.values()).sort((a, b) => b.maxCreatedAt - a.maxCreatedAt);
  }, [userEntries, weekDates, clients, projects, projectTasks]);

  const dayTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const day of weekDays) {
      let sum = 0;
      for (const row of entryRows) sum += row.days[day.dateStr] ?? 0;
      totals[day.dateStr] = sum;
    }
    return totals;
  }, [weekDays, entryRows]);

  const weekTotal = useMemo(() => Object.values(dayTotals).reduce((a, b) => a + b, 0), [dayTotals]);

  const monthTotal = useMemo(() => {
    const monthYear = `${currentWeekStart.getFullYear()}-${String(currentWeekStart.getMonth() + 1).padStart(2, '0')}`;
    return userEntries
      .filter((e) => e.date.startsWith(monthYear))
      .reduce((sum, e) => sum + e.duration, 0);
  }, [userEntries, currentWeekStart]);

  const weekRangeLabel = useMemo(() => {
    const end = new Date(currentWeekStart);
    end.setDate(end.getDate() + 6);
    return `${currentWeekStart.toLocaleDateString(i18n.language, {
      month: 'short',
      day: 'numeric',
    })} – ${end.toLocaleDateString(i18n.language, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })}`;
  }, [currentWeekStart, i18n.language]);

  // Use `dailyGoal * 5` as the typical full-week target so the week-total stat
  // can flip red once it's exceeded.
  const weeklyGoal = dailyGoal * 5;

  const shiftSelectedDate = (offsetDays: number) => {
    const d = dateOnlyToLocalDate(selectedDate);
    d.setDate(d.getDate() + offsetDays);
    onSelectedDateChange(getLocalDateString(d));
  };

  return (
    <Card className="px-0 py-0 overflow-hidden">
      <div className="flex flex-col gap-2 px-4 pt-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
          <div className="flex items-baseline gap-2">
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
              {t('weekly.weekTotal')}
            </span>
            <span
              className={cn(
                'text-lg font-black transition-colors',
                weekTotal > weeklyGoal ? 'text-destructive' : 'text-praetor',
              )}
            >
              {weekTotal.toFixed(2)} h
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
              {t('weekly.monthTotal')}
            </span>
            <span className="text-lg font-black text-foreground">{monthTotal.toFixed(2)} h</span>
          </div>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-auto">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => shiftSelectedDate(-7)}
            aria-label={t('weekly.weekView')}
          >
            <i className="fa-solid fa-chevron-left"></i>
          </Button>
          <span className="text-xs font-semibold text-foreground uppercase tracking-wide whitespace-nowrap">
            {weekRangeLabel}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => shiftSelectedDate(7)}
            aria-label={t('weekly.weekView')}
          >
            <i className="fa-solid fa-chevron-right"></i>
          </Button>
          <Button
            type="button"
            size="xs"
            onClick={() => onSelectedDateChange(getLocalDateString(new Date()))}
            className="rounded-full text-[10px] font-bold uppercase tracking-widest"
          >
            {t('weekly.goToToday')}
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <Table className="min-w-max border-collapse">
          <TableHeader className="bg-muted/40">
            <TableRow className="border-b border-border">
              <TableHead className="px-4 py-3 text-[10px] font-bold text-muted-foreground uppercase tracking-tighter min-w-56">
                {t('weekly.task')}
              </TableHead>
              {weekDays.map((day) => (
                <TableHead
                  key={day.dateStr}
                  className={cn(
                    'w-28 px-2 py-2 text-center relative align-middle',
                    day.isToday && 'bg-accent',
                    day.isWeekendOrHoliday && 'bg-destructive/5',
                  )}
                >
                  <div
                    className={cn(
                      'flex items-center justify-center gap-1 text-[10px] font-black uppercase',
                      day.isToday
                        ? 'text-praetor'
                        : day.isWeekendOrHoliday
                          ? 'text-destructive'
                          : 'text-muted-foreground',
                    )}
                  >
                    {t(`weekly.days.${day.dayKey}`)}
                    {day.holidayName && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="inline-flex">
                            <span className="size-1.5 bg-destructive rounded-full animate-pulse block"></span>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>{day.holidayName}</TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                  <p
                    className={cn(
                      'text-sm font-black leading-none mt-0.5',
                      day.isToday
                        ? 'text-praetor'
                        : day.isWeekendOrHoliday
                          ? 'text-destructive'
                          : 'text-foreground',
                    )}
                  >
                    {day.dayNum}
                  </p>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody className="divide-y divide-border">
            {entryRows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={1 + weekDays.length}
                  className="px-4 py-10 text-center text-xs text-muted-foreground"
                >
                  {t('weekly.noRecentTasks')}
                </TableCell>
              </TableRow>
            ) : (
              entryRows.map((row) => (
                <TableRow key={row.key} className="hover:bg-muted/30">
                  <TableCell className="px-4 py-3 align-middle whitespace-normal">
                    <p
                      className="text-xs font-semibold text-foreground line-clamp-2"
                      title={row.label}
                    >
                      {row.label}
                    </p>
                  </TableCell>
                  {weekDays.map((day) => {
                    const hours = row.days[day.dateStr];
                    return (
                      <TableCell
                        key={day.dateStr}
                        className={cn(
                          'w-28 px-2 py-3 text-center align-middle',
                          day.isToday && 'bg-accent/60',
                          day.isWeekendOrHoliday && 'bg-destructive/5',
                        )}
                      >
                        {hours ? (
                          <span className="text-sm font-bold text-foreground">
                            {hours.toFixed(2)}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground/50">—</span>
                        )}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))
            )}
          </TableBody>
          <TableFooter className="bg-muted/30">
            <TableRow className="border-t border-border">
              <TableCell className="px-4 py-3 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                {t('weekly.total')}
              </TableCell>
              {weekDays.map((day) => (
                <TableCell
                  key={day.dateStr}
                  className={cn(
                    'w-28 px-2 py-3 text-center',
                    day.isToday && 'bg-accent',
                    day.isWeekendOrHoliday && 'bg-destructive/5',
                  )}
                >
                  <p
                    className={cn(
                      'text-sm font-black',
                      dayTotals[day.dateStr] > dailyGoal ? 'text-destructive' : 'text-praetor',
                    )}
                  >
                    {dayTotals[day.dateStr].toFixed(1)}
                  </p>
                </TableCell>
              ))}
            </TableRow>
          </TableFooter>
        </Table>
      </div>
    </Card>
  );
};

export default WeeklyView;
