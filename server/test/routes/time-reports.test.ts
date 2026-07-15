import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import * as realGeneralSettingsRepo from '../../repositories/generalSettingsRepo.ts';
import * as realRolesRepo from '../../repositories/rolesRepo.ts';
import * as realTimeReportsRepo from '../../repositories/timeReportsRepo.ts';
import * as realUsersRepo from '../../repositories/usersRepo.ts';
import * as realWorkUnitsRepo from '../../repositories/workUnitsRepo.ts';
import * as realTimeReportsService from '../../services/timeReports.ts';
import * as realPermissions from '../../utils/permissions.ts';
import {
  installAuthMiddlewareMock,
  restoreAuthMiddlewareMock,
} from '../helpers/authMiddlewareMock.ts';
import { buildRouteTestApp } from '../helpers/buildRouteTestApp.ts';
import { signToken } from '../helpers/jwt.ts';

const usersRepoSnap = { ...realUsersRepo };
const rolesRepoSnap = { ...realRolesRepo };
const permissionsSnap = { ...realPermissions };
const timeReportsRepoSnap = { ...realTimeReportsRepo };
const workUnitsRepoSnap = { ...realWorkUnitsRepo };
const settingsRepoSnap = { ...realGeneralSettingsRepo };
const serviceSnap = { ...realTimeReportsService };

const findAuthUserByIdMock = mock();
const userHasRoleMock = mock();
const getRolePermissionsMock = mock();
const listAllNonAdminUserIdsMock = mock();
const filterNonAdminUserIdsMock = mock();
const listOptionsMock = mock();
const listManagedUserIdsMock = mock();
const generateTimeReportMock = mock();
const generateCompleteTimeReportMock = mock();
const getGeneralSettingsMock = mock();

let routePlugin: FastifyPluginAsync;

beforeAll(async () => {
  installAuthMiddlewareMock();
  mock.module('../../repositories/usersRepo.ts', () => ({
    ...usersRepoSnap,
    findAuthUserById: findAuthUserByIdMock,
  }));
  mock.module('../../repositories/rolesRepo.ts', () => ({
    ...rolesRepoSnap,
    userHasRole: userHasRoleMock,
  }));
  mock.module('../../utils/permissions.ts', () => ({
    ...permissionsSnap,
    getRolePermissions: getRolePermissionsMock,
  }));
  mock.module('../../repositories/timeReportsRepo.ts', () => ({
    ...timeReportsRepoSnap,
    listAllNonAdminUserIds: listAllNonAdminUserIdsMock,
    filterNonAdminUserIds: filterNonAdminUserIdsMock,
    listOptions: listOptionsMock,
  }));
  mock.module('../../repositories/workUnitsRepo.ts', () => ({
    ...workUnitsRepoSnap,
    listManagedUserIds: listManagedUserIdsMock,
  }));
  mock.module('../../repositories/generalSettingsRepo.ts', () => ({
    ...settingsRepoSnap,
    get: getGeneralSettingsMock,
  }));
  mock.module('../../services/timeReports.ts', () => ({
    ...serviceSnap,
    generateTimeReport: generateTimeReportMock,
    generateCompleteTimeReport: generateCompleteTimeReportMock,
  }));
  routePlugin = (await import('../../routes/time-reports.ts')).default as FastifyPluginAsync;
});

afterAll(() => {
  restoreAuthMiddlewareMock();
  mock.module('../../repositories/usersRepo.ts', () => usersRepoSnap);
  mock.module('../../repositories/rolesRepo.ts', () => rolesRepoSnap);
  mock.module('../../utils/permissions.ts', () => permissionsSnap);
  mock.module('../../repositories/timeReportsRepo.ts', () => timeReportsRepoSnap);
  mock.module('../../repositories/workUnitsRepo.ts', () => workUnitsRepoSnap);
  mock.module('../../repositories/generalSettingsRepo.ts', () => settingsRepoSnap);
  mock.module('../../services/timeReports.ts', () => serviceSnap);
});

const USER = {
  id: 'u1',
  name: 'Alice',
  username: 'alice',
  role: 'user',
  avatarInitials: 'AL',
  isDisabled: false,
  sessionVersion: 1,
};

const definition = {
  periodPreset: 'this_month',
  fromDate: '2026-07-01',
  toDate: '2026-07-31',
  userIds: ['u2'],
  clientId: null,
  projectIds: [],
  task: null,
  noteContains: '',
  fields: ['duration'],
  groupBy: [],
  totalsOnly: false,
};

let app: FastifyInstance;

beforeEach(async () => {
  for (const fn of [
    findAuthUserByIdMock,
    userHasRoleMock,
    getRolePermissionsMock,
    listAllNonAdminUserIdsMock,
    filterNonAdminUserIdsMock,
    listOptionsMock,
    listManagedUserIdsMock,
    generateTimeReportMock,
    generateCompleteTimeReportMock,
    getGeneralSettingsMock,
  ]) {
    fn.mockReset();
  }
  findAuthUserByIdMock.mockResolvedValue(USER);
  userHasRoleMock.mockResolvedValue(true);
  getRolePermissionsMock.mockResolvedValue(['reports.time_report.view']);
  listManagedUserIdsMock.mockResolvedValue([]);
  listAllNonAdminUserIdsMock.mockResolvedValue(['u1', 'u2']);
  filterNonAdminUserIdsMock.mockImplementation(async (ids: string[]) => ids);
  listOptionsMock.mockResolvedValue({ users: [], clients: [], projects: [], tasks: [] });
  generateTimeReportMock.mockResolvedValue({
    rows: [],
    matchedEntryCount: 0,
    outputRowCount: 0,
    truncated: false,
    totals: { duration: 0, cost: null },
  });
  generateCompleteTimeReportMock.mockResolvedValue({
    rows: [],
    matchedEntryCount: 0,
    outputRowCount: 0,
    truncated: false,
    totals: { duration: 0, cost: null },
  });
  getGeneralSettingsMock.mockResolvedValue({ currency: '€' });
  app = await buildRouteTestApp(routePlugin, '/api/reports/time-report');
});

afterEach(async () => {
  await app.close();
});

const auth = () => ({ authorization: `Bearer ${signToken({ userId: 'u1' })}` });

describe('time report RBAC routes', () => {
  test('base permission always forces the current user', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/reports/time-report/generate',
      headers: auth(),
      payload: definition,
    });

    expect(response.statusCode).toBe(200);
    expect(generateTimeReportMock).toHaveBeenCalledTimes(1);
    expect(generateTimeReportMock.mock.calls[0]?.[1]).toEqual(['u1']);
  });

  test('options expose current and managed users as editable with effective Timesheet access', async () => {
    getRolePermissionsMock.mockResolvedValue([
      'reports.time_report.view',
      'reports.time_report_all.view',
      'timesheets.tracker.view',
      'timesheets.tracker.update',
    ]);
    listManagedUserIdsMock.mockResolvedValue(['u2']);

    const response = await app.inject({
      method: 'GET',
      url: '/api/reports/time-report/options',
      headers: auth(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ editableUserIds: ['u1', 'u2'] });
  });

  test('options expose every report user as editable with all-scope Timesheet update', async () => {
    getRolePermissionsMock.mockResolvedValue([
      'reports.time_report.view',
      'reports.time_report_all.view',
      'timesheets.tracker_all.view',
      'timesheets.tracker_all.update',
    ]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/reports/time-report/options',
      headers: auth(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ editableUserIds: ['u1', 'u2'] });
    expect(listManagedUserIdsMock).not.toHaveBeenCalled();
  });

  test('options expose no editable users without effective Timesheet update', async () => {
    getRolePermissionsMock.mockResolvedValue([
      'reports.time_report.view',
      'timesheets.tracker.view',
    ]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/reports/time-report/options',
      headers: auth(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ editableUserIds: [] });
  });

  test('scoped permission accepts managed users and rejects IDs outside scope', async () => {
    getRolePermissionsMock.mockResolvedValue(['reports.time_report_all.view']);
    listManagedUserIdsMock.mockResolvedValue(['u2']);

    const allowed = await app.inject({
      method: 'POST',
      url: '/api/reports/time-report/generate',
      headers: auth(),
      payload: definition,
    });
    const denied = await app.inject({
      method: 'POST',
      url: '/api/reports/time-report/generate',
      headers: auth(),
      payload: { ...definition, userIds: ['u3'] },
    });

    expect(allowed.statusCode).toBe(200);
    expect(denied.statusCode).toBe(403);
  });

  test('rejects cost without reports.cost.view', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/reports/time-report/generate',
      headers: auth(),
      payload: { ...definition, fields: ['duration', 'cost'] },
    });

    expect(response.statusCode).toBe(403);
    expect(generateTimeReportMock).not.toHaveBeenCalled();
  });

  test('always excludes the active admin role', async () => {
    findAuthUserByIdMock.mockResolvedValue({ ...USER, role: 'admin' });
    getRolePermissionsMock.mockResolvedValue(['reports.time_report.view']);

    const response = await app.inject({
      method: 'POST',
      url: '/api/reports/time-report/generate',
      headers: auth(),
      payload: definition,
    });

    expect(response.statusCode).toBe(403);
    expect(generateTimeReportMock).not.toHaveBeenCalled();
  });

  test('CSV export uses the generated definition, BOM and formula-injection protection', async () => {
    generateCompleteTimeReportMock.mockResolvedValue({
      rows: [
        {
          key: 'detail:e1',
          kind: 'detail',
          groupLevel: null,
          label: null,
          date: '2026-07-10',
          userId: 'u1',
          userName: 'Alice',
          clientId: 'c1',
          clientName: 'Acme',
          projectId: 'p1',
          projectName: 'Portal',
          taskId: null,
          taskName: 'Build',
          notes: '  =1+1',
          duration: 2,
          cost: null,
          entry: null,
        },
      ],
      matchedEntryCount: 1,
      outputRowCount: 1,
      truncated: false,
      totals: { duration: 2, cost: null },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/reports/time-report/export.csv',
      headers: auth(),
      payload: {
        definition: { ...definition, fields: ['duration', 'note'] },
        language: 'en',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.body.startsWith('\uFEFF')).toBe(true);
    expect(response.body).toContain("'  =1+1");
    expect(response.body).toContain('Total');
  });

  test('CSV export reports the explicit 50,000-entry limit', async () => {
    generateCompleteTimeReportMock.mockImplementation(async () => {
      throw new serviceSnap.TimeReportExportLimitError(50_001);
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/reports/time-report/export.csv',
      headers: auth(),
      payload: { definition, language: 'it' },
    });

    expect(response.statusCode).toBe(413);
    expect(response.json()).toMatchObject({ count: 50_001 });
  });

  test('all-scope Timesheet view allows every non-admin report user', async () => {
    getRolePermissionsMock.mockResolvedValue([
      'reports.time_report.view',
      'reports.time_report_all.view',
      'timesheets.tracker_all.view',
    ]);

    const response = await app.inject({
      method: 'POST',
      url: '/api/reports/time-report/generate',
      headers: auth(),
      payload: definition,
    });

    expect(response.statusCode).toBe(200);
    expect(generateTimeReportMock.mock.calls[0]?.[1]).toEqual(['u2']);
    expect(listManagedUserIdsMock).not.toHaveBeenCalled();
  });

  test('rejects duplicate grouping levels instead of silently normalizing them', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/reports/time-report/generate',
      headers: auth(),
      payload: { ...definition, groupBy: ['date', 'date'] },
    });

    expect(response.statusCode).toBe(400);
    expect(generateTimeReportMock).not.toHaveBeenCalled();
  });

  test('rejects empty entity identifiers', async () => {
    const emptyClient = await app.inject({
      method: 'POST',
      url: '/api/reports/time-report/generate',
      headers: auth(),
      payload: { ...definition, clientId: '' },
    });
    const emptyTask = await app.inject({
      method: 'POST',
      url: '/api/reports/time-report/generate',
      headers: auth(),
      payload: {
        ...definition,
        task: { projectId: 'p1', taskId: '', name: 'Task' },
      },
    });

    expect(emptyClient.statusCode).toBe(400);
    expect(emptyTask.statusCode).toBe(400);
    expect(generateTimeReportMock).not.toHaveBeenCalled();
  });
});
