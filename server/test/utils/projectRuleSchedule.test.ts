import { describe, expect, test } from 'bun:test';
import {
  getPreviousProjectRulePeriod,
  getProjectRulePeriodForEvaluation,
  isValidTimeZone,
  normalizeProjectRuleSchedule,
} from '../../utils/projectRuleSchedule.ts';

describe('projectRuleSchedule', () => {
  test('calculates the previous calendar month in the configured time zone', () => {
    expect(
      getPreviousProjectRulePeriod(new Date('2026-06-01T00:30:00Z'), {
        frequency: 'monthly',
        timeZone: 'Europe/Rome',
        userIds: [],
        taskIds: [],
      }),
    ).toEqual({
      key: 'monthly:Europe/Rome:2026-05-01:2026-06-01',
      startDate: '2026-05-01',
      endDate: '2026-06-01',
    });
  });

  test('uses Monday-to-Monday windows for weekly checks', () => {
    expect(
      getPreviousProjectRulePeriod(new Date('2026-06-10T12:00:00Z'), {
        frequency: 'weekly',
        timeZone: 'UTC',
        userIds: [],
        taskIds: [],
      }),
    ).toEqual({
      key: 'weekly:UTC:2026-06-01:2026-06-08',
      startDate: '2026-06-01',
      endDate: '2026-06-08',
    });
  });

  test('normalizes duplicate filters and rejects invalid time zones', () => {
    expect(isValidTimeZone('Not/AZone')).toBe(false);
    expect(
      normalizeProjectRuleSchedule({
        frequency: 'daily',
        timeZone: 'Europe/Rome',
        userIds: [' u2 ', 'u1', 'u2'],
        taskIds: ['t2', ' t1 ', 't2'],
      }),
    ).toEqual({
      frequency: 'daily',
      timeZone: 'Europe/Rome',
      userIds: ['u1', 'u2'],
      taskIds: ['t1', 't2'],
    });
  });

  test('keeps long IANA time zones inside the persisted period-key limit', () => {
    const period = getPreviousProjectRulePeriod(new Date('2026-07-29T12:00:00Z'), {
      frequency: 'quarterly',
      timeZone: 'America/Argentina/ComodRivadavia',
      userIds: [],
      taskIds: [],
    });

    expect(period.key.length).toBeLessThanOrEqual(160);
    expect(period.key).toContain('America/Argentina/ComodRivadavia');
  });

  test('returns the next missed period before the latest completed one', () => {
    expect(
      getProjectRulePeriodForEvaluation(
        new Date('2026-06-15T12:00:00Z'),
        {
          frequency: 'monthly',
          timeZone: 'UTC',
          userIds: [],
          taskIds: [],
        },
        'monthly:UTC:2026-02-01:2026-03-01',
      ),
    ).toEqual({
      key: 'monthly:UTC:2026-03-01:2026-04-01',
      startDate: '2026-03-01',
      endDate: '2026-04-01',
    });
  });

  test('falls back to the latest completed period for corrupt or changed schedule keys', () => {
    const schedule = {
      frequency: 'monthly' as const,
      timeZone: 'Europe/Rome',
      userIds: [],
      taskIds: [],
    };

    expect(
      getProjectRulePeriodForEvaluation(
        new Date('2026-06-15T12:00:00Z'),
        schedule,
        'monthly:Europe/Rome:2026-99-01:2026-03-01',
      ),
    ).toEqual({
      key: 'monthly:Europe/Rome:2026-05-01:2026-06-01',
      startDate: '2026-05-01',
      endDate: '2026-06-01',
    });
    expect(
      getProjectRulePeriodForEvaluation(
        new Date('2026-06-15T12:00:00Z'),
        schedule,
        'weekly:Europe/Rome:2026-05-18:2026-05-25',
      ),
    ).toEqual({
      key: 'monthly:Europe/Rome:2026-05-01:2026-06-01',
      startDate: '2026-05-01',
      endDate: '2026-06-01',
    });
    expect(
      getProjectRulePeriodForEvaluation(
        new Date('2026-06-15T12:00:00Z'),
        schedule,
        'monthly:Europe/Rome:2026-01-31:2026-02-28',
      ),
    ).toEqual({
      key: 'monthly:Europe/Rome:2026-05-01:2026-06-01',
      startDate: '2026-05-01',
      endDate: '2026-06-01',
    });
    expect(
      getProjectRulePeriodForEvaluation(
        new Date('2026-06-15T12:00:00Z'),
        schedule,
        'monthly:Europe/Rome:2026-01-31:2026-03-03',
      ),
    ).toEqual({
      key: 'monthly:Europe/Rome:2026-05-01:2026-06-01',
      startDate: '2026-05-01',
      endDate: '2026-06-01',
    });
  });
});
