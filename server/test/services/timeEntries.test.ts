import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import * as realEntriesRepo from '../../repositories/entriesRepo.ts';
import * as realTasksRepo from '../../repositories/tasksRepo.ts';
import * as realWorkUnitsRepo from '../../repositories/workUnitsRepo.ts';

const entriesRepoSnap = { ...realEntriesRepo };
const tasksRepoSnap = { ...realTasksRepo };
const workUnitsRepoSnap = { ...realWorkUnitsRepo };

const findContextMock = mock();
const updateMock = mock();
const findIdByProjectAndNameMock = mock();
const isUserManagedByMock = mock();

let updateTimeEntry: typeof import('../../services/timeEntries.ts').updateTimeEntry;

beforeAll(async () => {
  mock.module('../../repositories/entriesRepo.ts', () => ({
    ...entriesRepoSnap,
    findContext: findContextMock,
    update: updateMock,
  }));
  mock.module('../../repositories/tasksRepo.ts', () => ({
    ...tasksRepoSnap,
    findIdByProjectAndName: findIdByProjectAndNameMock,
  }));
  mock.module('../../repositories/workUnitsRepo.ts', () => ({
    ...workUnitsRepoSnap,
    isUserManagedBy: isUserManagedByMock,
  }));

  updateTimeEntry = (await import('../../services/timeEntries.ts')).updateTimeEntry;
});

afterAll(() => {
  mock.module('../../repositories/entriesRepo.ts', () => entriesRepoSnap);
  mock.module('../../repositories/tasksRepo.ts', () => tasksRepoSnap);
  mock.module('../../repositories/workUnitsRepo.ts', () => workUnitsRepoSnap);
});

const ACTOR = {
  id: 'u1',
  permissions: ['timesheets.tracker.update'],
};

const SAMPLE_ENTRY = {
  id: 'te-1',
  userId: 'u1',
  date: '2025-06-02',
  clientId: 'c1',
  clientName: 'Client',
  projectId: 'p1',
  projectName: 'Project',
  task: 'Dev',
  taskId: 't1',
  notes: null,
  duration: 4,
  hourlyCost: 50,
  isPlaceholder: false,
  location: 'remote',
  createdAt: 1_700_000_000_000,
};

beforeEach(() => {
  findContextMock.mockReset();
  updateMock.mockReset();
  findIdByProjectAndNameMock.mockReset();
  isUserManagedByMock.mockReset();

  findContextMock.mockResolvedValue({
    userId: 'u1',
    projectId: 'p1',
    task: 'Dev',
    taskId: 't1',
  });
  updateMock.mockResolvedValue(SAMPLE_ENTRY);
});

describe('updateTimeEntry', () => {
  test('passes valid location through to repo', async () => {
    await updateTimeEntry(ACTOR, 'te-1', { location: 'office' });
    expect(updateMock).toHaveBeenCalledWith(
      'te-1',
      expect.objectContaining({ location: 'office' }),
    );
  });

  test('empty-string location does not touch DB column (regression for High #13)', async () => {
    // Empty string used to pass straight to the DB, violating the
    // CHECK (location IN ('remote', 'office', 'customer_premise', 'transfer'))
    // constraint and surfacing as an unhandled 500.
    await updateTimeEntry(ACTOR, 'te-1', { location: '' });
    expect(updateMock).toHaveBeenCalledTimes(1);
    const patch = updateMock.mock.calls[0][1] as { location?: unknown };
    expect(patch.location).toBeUndefined();
  });

  test('whitespace-only location does not touch DB column', async () => {
    await updateTimeEntry(ACTOR, 'te-1', { location: '   ' });
    const patch = updateMock.mock.calls[0][1] as { location?: unknown };
    expect(patch.location).toBeUndefined();
  });

  test('omitted location leaves DB column untouched', async () => {
    await updateTimeEntry(ACTOR, 'te-1', { duration: 5 });
    const patch = updateMock.mock.calls[0][1] as { location?: unknown };
    expect(patch.location).toBeUndefined();
  });
});
