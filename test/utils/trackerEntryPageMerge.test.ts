import { describe, expect, test } from 'bun:test';
import { Buffer } from 'node:buffer';
import type { TimeEntry } from '../../types';
import { mergeTrackerEntryPage } from '../../utils/trackerEntryPageMerge';

const entry = (id: string, userId: string, createdAt: number): TimeEntry => ({
  id,
  userId,
  createdAt,
  date: '2026-05-05',
  clientId: 'client-1',
  clientName: 'Client',
  projectId: 'project-1',
  projectName: 'Project',
  task: 'Task',
  duration: 8,
  version: 1,
});

describe('mergeTrackerEntryPage', () => {
  test('an empty complete response clears only the selected user snapshot', () => {
    const selectedCached = entry('selected-cached', 'selected-user', 100);
    const otherCached = entry('other-cached', 'other-user', 100);
    const selectedCreatedDuringLoad = entry('selected-new', 'selected-user', 110);

    expect(
      mergeTrackerEntryPage([selectedCached, otherCached, selectedCreatedDuringLoad], [], {
        userId: 'selected-user',
        baselineEntryIds: new Set([selectedCached.id]),
        inputCursor: null,
        nextCursor: null,
      }),
    ).toEqual([otherCached, selectedCreatedDuringLoad]);
  });

  test('a partial first page preserves uncached writes and rows outside its window', () => {
    const deletedInWindow = entry('deleted-in-window', 'selected-user', 250);
    const pendingOlderPage = entry('pending-older-page', 'selected-user', 150);
    const otherUserInWindow = entry('other-user-in-window', 'other-user', 250);
    const selectedCreatedDuringLoad = entry('selected-new', 'selected-user', 350);
    const newest = entry('newest', 'selected-user', 300);
    const oldest = entry('oldest', 'selected-user', 200);

    expect(
      mergeTrackerEntryPage(
        [deletedInWindow, pendingOlderPage, otherUserInWindow, selectedCreatedDuringLoad],
        [newest, oldest],
        {
          userId: 'selected-user',
          baselineEntryIds: new Set([deletedInWindow.id, pendingOlderPage.id]),
          inputCursor: null,
          nextCursor: 'next-page',
        },
      ),
    ).toEqual([pendingOlderPage, otherUserInWindow, selectedCreatedDuringLoad, newest, oldest]);
  });

  test('an empty final continuation removes baseline rows below its cursor', () => {
    const newerThanCursor = entry('newer', 'selected-user', 300);
    const olderThanCursor = entry('older', 'selected-user', 100);
    const equalMillisecondBoundary = entry('equal-boundary', 'selected-user', 200);
    const cursor = Buffer.from(
      JSON.stringify({ createdAt: '1970-01-01T00:00:00.200Z', id: 'cursor-id' }),
    ).toString('base64url');

    expect(
      mergeTrackerEntryPage([newerThanCursor, equalMillisecondBoundary, olderThanCursor], [], {
        userId: 'selected-user',
        baselineEntryIds: new Set([
          newerThanCursor.id,
          equalMillisecondBoundary.id,
          olderThanCursor.id,
        ]),
        inputCursor: cursor,
        nextCursor: null,
      }),
    ).toEqual([newerThanCursor, equalMillisecondBoundary]);
  });
});
