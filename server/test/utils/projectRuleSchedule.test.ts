import { describe, expect, test } from 'bun:test';
import type {
  ProjectRuleSchedule,
  ProjectRuleScheduleFrequency,
} from '../../db/schema/projectRules.ts';
import {
  getAppTimeZone,
  getPreviousProjectRulePeriod,
  getProjectRulePeriodForEvaluation,
  normalizeProjectRuleSchedule,
} from '../../utils/projectRuleSchedule.ts';

const schedule = (frequency: ProjectRuleScheduleFrequency): ProjectRuleSchedule => ({
  frequency,
  userIds: [],
  taskIds: [],
});

describe('projectRuleSchedule', () => {
  test('uses the application time zone by default', () => {
    expect(getAppTimeZone()).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  });

  test('calculates the previous calendar month on the first day in the application time zone', () => {
    expect(
      getPreviousProjectRulePeriod(
        new Date('2026-06-01T00:30:00Z'),
        schedule('monthly'),
        'Europe/Rome',
      ),
    ).toEqual({
      key: 'monthly:Europe/Rome:2026-05-01:2026-06-01',
      startDate: '2026-05-01',
      endDate: '2026-06-01',
    });
  });

  test('waits for a custom monthly occurrence before exposing the next calendar month', () => {
    expect(
      getPreviousProjectRulePeriod(
        new Date('2026-06-14T12:00:00Z'),
        schedule('monthly:third:1'),
        'UTC',
      ),
    ).toEqual({
      key: 'monthly:UTC:2026-04-01:2026-05-01',
      startDate: '2026-04-01',
      endDate: '2026-05-01',
    });
    expect(
      getPreviousProjectRulePeriod(
        new Date('2026-06-15T00:00:00Z'),
        schedule('monthly:third:1'),
        'UTC',
      ),
    ).toEqual({
      key: 'monthly:UTC:2026-05-01:2026-06-01',
      startDate: '2026-05-01',
      endDate: '2026-06-01',
    });
  });

  test('uses the application time zone to decide when a custom monthly occurrence starts', () => {
    expect(
      getPreviousProjectRulePeriod(
        new Date('2026-06-14T22:30:00Z'),
        schedule('monthly:third:1'),
        'Europe/Rome',
      ),
    ).toMatchObject({
      startDate: '2026-05-01',
      endDate: '2026-06-01',
    });
  });

  test('supports the last selected weekday of the month', () => {
    expect(
      getPreviousProjectRulePeriod(
        new Date('2026-02-21T12:00:00Z'),
        schedule('monthly:last:0'),
        'UTC',
      ),
    ).toMatchObject({
      startDate: '2025-12-01',
      endDate: '2026-01-01',
    });
    expect(
      getPreviousProjectRulePeriod(
        new Date('2026-02-22T00:00:00Z'),
        schedule('monthly:last:0'),
        'UTC',
      ),
    ).toMatchObject({
      startDate: '2026-01-01',
      endDate: '2026-02-01',
    });
  });

  test('uses Monday-to-Monday windows for weekly checks', () => {
    expect(
      getPreviousProjectRulePeriod(new Date('2026-06-10T12:00:00Z'), schedule('weekly'), 'UTC'),
    ).toEqual({
      key: 'weekly:UTC:2026-06-01:2026-06-08',
      startDate: '2026-06-01',
      endDate: '2026-06-08',
    });
  });

  test('normalizes duplicate filters and drops legacy per-rule time zones', () => {
    expect(
      normalizeProjectRuleSchedule({
        frequency: 'daily',
        timeZone: 'Europe/Rome',
        userIds: [' u2 ', 'u1', 'u2'],
        taskIds: ['t2', ' t1 ', 't2'],
      }),
    ).toEqual({
      frequency: 'daily',
      userIds: ['u1', 'u2'],
      taskIds: ['t1', 't2'],
    });
  });

  test('normalizes valid custom monthly patterns and rejects malformed persisted values', () => {
    expect(normalizeProjectRuleSchedule({ frequency: 'monthly:fourth:6' })).toMatchObject({
      frequency: 'monthly:fourth:6',
    });
    expect(normalizeProjectRuleSchedule({ frequency: 'monthly:fifth:1' })).toMatchObject({
      frequency: 'monthly',
    });
    expect(normalizeProjectRuleSchedule({ frequency: 'monthly:first:7' })).toMatchObject({
      frequency: 'monthly',
    });
  });

  test('uses monthly period keys for custom patterns so catch-up remains compatible', () => {
    expect(
      getProjectRulePeriodForEvaluation(
        new Date('2026-06-15T12:00:00Z'),
        schedule('monthly:third:1'),
        'monthly:UTC:2026-02-01:2026-03-01',
        'UTC',
      ),
    ).toEqual({
      key: 'monthly:UTC:2026-03-01:2026-04-01',
      startDate: '2026-03-01',
      endDate: '2026-04-01',
    });
  });

  test('keeps application time zones inside the persisted period-key limit', () => {
    const period = getPreviousProjectRulePeriod(
      new Date('2026-07-29T12:00:00Z'),
      schedule('quarterly'),
      'America/Argentina/ComodRivadavia',
    );

    expect(period.key.length).toBeLessThanOrEqual(160);
    expect(period.key).toContain('America/Argentina/ComodRivadavia');
  });

  test('returns the next missed period before the latest completed one', () => {
    expect(
      getProjectRulePeriodForEvaluation(
        new Date('2026-06-15T12:00:00Z'),
        schedule('monthly'),
        'monthly:UTC:2026-02-01:2026-03-01',
        'UTC',
      ),
    ).toEqual({
      key: 'monthly:UTC:2026-03-01:2026-04-01',
      startDate: '2026-03-01',
      endDate: '2026-04-01',
    });
  });

  test('falls back to the latest completed period for corrupt or changed schedule keys', () => {
    const monthlySchedule = schedule('monthly');
    const expected = {
      key: 'monthly:Europe/Rome:2026-05-01:2026-06-01',
      startDate: '2026-05-01',
      endDate: '2026-06-01',
    };

    expect(
      getProjectRulePeriodForEvaluation(
        new Date('2026-06-15T12:00:00Z'),
        monthlySchedule,
        'monthly:Europe/Rome:2026-99-01:2026-03-01',
        'Europe/Rome',
      ),
    ).toEqual(expected);
    expect(
      getProjectRulePeriodForEvaluation(
        new Date('2026-06-15T12:00:00Z'),
        monthlySchedule,
        'weekly:Europe/Rome:2026-05-18:2026-05-25',
        'Europe/Rome',
      ),
    ).toEqual(expected);
    expect(
      getProjectRulePeriodForEvaluation(
        new Date('2026-06-15T12:00:00Z'),
        monthlySchedule,
        'monthly:Europe/Rome:2026-01-31:2026-02-28',
        'Europe/Rome',
      ),
    ).toEqual(expected);
    expect(
      getProjectRulePeriodForEvaluation(
        new Date('2026-06-15T12:00:00Z'),
        monthlySchedule,
        'monthly:Europe/Rome:2026-01-31:2026-03-03',
        'Europe/Rome',
      ),
    ).toEqual(expected);
  });
});
