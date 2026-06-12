import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import * as realDrizzle from '../../db/drizzle.ts';
import * as realEntriesRepo from '../../repositories/entriesRepo.ts';
import * as realNotificationsRepo from '../../repositories/notificationsRepo.ts';
import * as realOvertimeEventsRepo from '../../repositories/overtimeNotificationEventsRepo.ts';
import * as realUsersRepo from '../../repositories/usersRepo.ts';
import * as realWorkUnitsRepo from '../../repositories/workUnitsRepo.ts';
import { TX_SENTINEL } from '../helpers/txSentinel.ts';

const drizzleSnap = { ...realDrizzle };
const entriesRepoSnap = { ...realEntriesRepo };
const notificationsRepoSnap = { ...realNotificationsRepo };
const overtimeEventsRepoSnap = { ...realOvertimeEventsRepo };
const usersRepoSnap = { ...realUsersRepo };
const workUnitsRepoSnap = { ...realWorkUnitsRepo };

const runAtomicallyMock = mock(async (_exec: unknown, cb: (tx: unknown) => unknown) =>
  cb(TX_SENTINEL),
);
const sumDurationForUserDateMock = mock();
const createIfAbsentMock = mock();
const createForUsersMock = mock();
const listTopManagerIdsMock = mock();
const listManagerIdsForUserMock = mock();

let service: typeof import('../../services/overtimeNotifications.ts');

beforeAll(async () => {
  mock.module('../../db/drizzle.ts', () => ({
    ...drizzleSnap,
    db: TX_SENTINEL,
    runAtomically: runAtomicallyMock,
  }));
  mock.module('../../repositories/entriesRepo.ts', () => ({
    ...entriesRepoSnap,
    sumDurationForUserDate: sumDurationForUserDateMock,
  }));
  mock.module('../../repositories/overtimeNotificationEventsRepo.ts', () => ({
    ...overtimeEventsRepoSnap,
    createIfAbsent: createIfAbsentMock,
  }));
  mock.module('../../repositories/notificationsRepo.ts', () => ({
    ...notificationsRepoSnap,
    createForUsers: createForUsersMock,
  }));
  mock.module('../../repositories/usersRepo.ts', () => ({
    ...usersRepoSnap,
    listTopManagerIds: listTopManagerIdsMock,
  }));
  mock.module('../../repositories/workUnitsRepo.ts', () => ({
    ...workUnitsRepoSnap,
    listManagerIdsForUser: listManagerIdsForUserMock,
  }));

  service = await import('../../services/overtimeNotifications.ts');
});

afterAll(() => {
  mock.module('../../db/drizzle.ts', () => drizzleSnap);
  mock.module('../../repositories/entriesRepo.ts', () => entriesRepoSnap);
  mock.module('../../repositories/overtimeNotificationEventsRepo.ts', () => overtimeEventsRepoSnap);
  mock.module('../../repositories/notificationsRepo.ts', () => notificationsRepoSnap);
  mock.module('../../repositories/usersRepo.ts', () => usersRepoSnap);
  mock.module('../../repositories/workUnitsRepo.ts', () => workUnitsRepoSnap);
});

beforeEach(() => {
  for (const fn of [
    runAtomicallyMock,
    sumDurationForUserDateMock,
    createIfAbsentMock,
    createForUsersMock,
    listTopManagerIdsMock,
    listManagerIdsForUserMock,
  ]) {
    fn.mockReset();
  }
  runAtomicallyMock.mockImplementation(async (_exec, cb) => cb(TX_SENTINEL));
  createIfAbsentMock.mockResolvedValue(true);
  createForUsersMock.mockResolvedValue(3);
  listManagerIdsForUserMock.mockResolvedValue(['manager-1', 'top-1']);
  listTopManagerIdsMock.mockResolvedValue(['top-1', 'top-2']);
});

describe('overtime notification evaluation', () => {
  test('detects daily-limit, weekend, and Italian-holiday overtime', () => {
    expect(service.evaluateOvertime('2026-05-04', 8)).toEqual({
      isOvertime: false,
      reasons: [],
    });
    expect(service.evaluateOvertime('2026-05-04', 8.25)).toEqual({
      isOvertime: true,
      reasons: ['daily_limit'],
    });
    expect(service.evaluateOvertime('2026-05-02', 1)).toEqual({
      isOvertime: true,
      reasons: ['weekend_or_holiday'],
    });
    expect(service.evaluateOvertime('2026-05-01', 1)).toEqual({
      isOvertime: true,
      reasons: ['weekend_or_holiday'],
    });
  });

  test('calculates RIL worked hours using the configured lunch break', () => {
    expect(service.calculateRilWorkedHoursFromTimes('09:00', '18:00', 60)).toBe(8);
    expect(service.calculateRilWorkedHoursFromTimes('09:00', '13:30', 60)).toBe(4);
    expect(service.calculateRilWorkedHoursFromTimes('14:00', '18:00', 60)).toBe(4);
  });
});

describe('notifyOvertimeIfNeeded', () => {
  test('does not write an event for a non-overtime weekday', async () => {
    await expect(
      service.notifyOvertimeIfNeeded({
        userId: 'u1',
        date: '2026-05-04',
        hours: 8,
        source: 'tracker',
        createdBy: 'u1',
      }),
    ).resolves.toEqual({ notified: 0, created: false });

    expect(createIfAbsentMock).not.toHaveBeenCalled();
    expect(createForUsersMock).not.toHaveBeenCalled();
  });

  test('creates one event and notifies competence-center managers plus top managers', async () => {
    const result = await service.notifyOvertimeIfNeeded({
      userId: 'u1',
      date: '2026-05-04',
      hours: 8.5,
      source: 'tracker',
      createdBy: 'u1',
    });

    expect(result).toEqual({ notified: 3, created: true });
    expect(createIfAbsentMock).toHaveBeenCalledWith(
      {
        userId: 'u1',
        eventDate: '2026-05-04',
        source: 'tracker',
        hours: 8.5,
        reasons: ['daily_limit'],
        createdBy: 'u1',
      },
      TX_SENTINEL,
    );
    expect(listManagerIdsForUserMock).toHaveBeenCalledWith('u1', TX_SENTINEL);
    expect(listTopManagerIdsMock).toHaveBeenCalledWith(TX_SENTINEL);
    expect(createForUsersMock).toHaveBeenCalledWith(
      ['manager-1', 'top-1', 'top-2'],
      expect.objectContaining({
        type: 'overtime_recorded',
        data: expect.objectContaining({
          userId: 'u1',
          date: '2026-05-04',
          source: 'tracker',
          reasons: ['daily_limit'],
        }),
      }),
      TX_SENTINEL,
    );
  });

  test('skips recipients and notifications when the dedupe event already exists', async () => {
    createIfAbsentMock.mockResolvedValue(false);

    const result = await service.notifyOvertimeIfNeeded({
      userId: 'u1',
      date: '2026-05-02',
      hours: 1,
      source: 'tracker',
      createdBy: 'u1',
    });

    expect(result).toEqual({ notified: 0, created: false });
    expect(createIfAbsentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        eventDate: '2026-05-02',
        source: 'tracker',
        reasons: ['weekend_or_holiday'],
      }),
      TX_SENTINEL,
    );
    expect(listManagerIdsForUserMock).not.toHaveBeenCalled();
    expect(createForUsersMock).not.toHaveBeenCalled();
  });
});

describe('source-specific overtime checks', () => {
  test('tracker checks use the affected day total', async () => {
    sumDurationForUserDateMock.mockResolvedValue(9);

    await service.notifyTrackerOvertimeForDate('u1', '2026-05-04', 'actor-1');

    expect(sumDurationForUserDateMock).toHaveBeenCalledWith('u1', '2026-05-04', TX_SENTINEL);
    expect(createIfAbsentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        eventDate: '2026-05-04',
        source: 'tracker',
        hours: 9,
        reasons: ['daily_limit'],
        createdBy: 'actor-1',
      }),
      TX_SENTINEL,
    );
  });

  test('RIL manual checks only changed days and ignores generated tracker overtime', async () => {
    const result = await service.notifyRilManualOvertimeForRows({
      userId: 'u1',
      monthKey: '2026-05',
      rows: {
        '1': { entrance: '09:00', exit: '11:00' },
        '2': { entrance: '09:00', exit: '13:00' },
        '4': { entrance: '09:00', exit: '18:30' },
      },
      changedDays: [4],
      createdBy: 'u1',
      lunchBreakMinutes: 60,
    });

    expect(result).toEqual({ checked: 1, created: 1, notified: 3 });
    expect(createIfAbsentMock).toHaveBeenCalledTimes(1);
    expect(createIfAbsentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        eventDate: '2026-05-04',
        source: 'ril_manual',
        hours: 8.5,
        reasons: ['daily_limit'],
      }),
      TX_SENTINEL,
    );
  });
});
