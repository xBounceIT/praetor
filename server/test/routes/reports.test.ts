import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import * as realDrizzle from '../../db/drizzle.ts';
import * as realGeneralSettingsRepo from '../../repositories/generalSettingsRepo.ts';
import * as realReportsAiChatRepo from '../../repositories/reportsAiChatRepo.ts';
import * as realReportsCatalogRepo from '../../repositories/reportsCatalogRepo.ts';
import * as realReportsClientsRepo from '../../repositories/reportsClientsRepo.ts';
import * as realReportsHoursRepo from '../../repositories/reportsHoursRepo.ts';
import * as realReportsRevenueRepo from '../../repositories/reportsRevenueRepo.ts';
import * as realRolesRepo from '../../repositories/rolesRepo.ts';
import * as realUsersRepo from '../../repositories/usersRepo.ts';
import * as realWorkUnitsRepo from '../../repositories/workUnitsRepo.ts';
import * as realPermissions from '../../utils/permissions.ts';
import {
  installAuthMiddlewareMock,
  restoreAuthMiddlewareMock,
} from '../helpers/authMiddlewareMock.ts';
import { buildRouteTestApp } from '../helpers/buildRouteTestApp.ts';
import { signToken } from '../helpers/jwt.ts';
import { TX_SENTINEL } from '../helpers/txSentinel.ts';
import { makeWithDbTransactionMock } from '../helpers/withDbTransactionMock.ts';

const usersRepoSnap = { ...realUsersRepo };
const rolesRepoSnap = { ...realRolesRepo };
const permissionsSnap = { ...realPermissions };
const generalSettingsRepoSnap = { ...realGeneralSettingsRepo };
const aiChatSnap = { ...realReportsAiChatRepo };
const reportsCatalogSnap = { ...realReportsCatalogRepo };
const reportsClientsSnap = { ...realReportsClientsRepo };
const reportsHoursSnap = { ...realReportsHoursRepo };
const reportsRevenueSnap = { ...realReportsRevenueRepo };
const workUnitsSnap = { ...realWorkUnitsRepo };
const drizzleSnap = { ...realDrizzle };

const { withDbTransactionMock, resetWithDbTransactionMock } = makeWithDbTransactionMock();

const findAuthUserByIdMock = mock();
const userHasRoleMock = mock();
const getRolePermissionsMock = mock();
const getGeneralSettingsMock = mock();

const listSessionsForUserMock = mock();
const createSessionMock = mock();
const archiveSessionMock = mock();
const renameSessionMock = mock();
const sessionExistsForUserMock = mock();
const getActiveSessionForUserMock = mock();
const updateSessionTitleAndTouchMock = mock();
const touchSessionMock = mock();
const listMessagesForSessionMock = mock();
const listRecentMessagesMock = mock();
const insertUserMessageMock = mock();
const insertAssistantMessageMock = mock();
const findUserMessageMock = mock();
const findFirstAssistantAfterMock = mock();
const deleteMessageMock = mock();
const updateMessageContentMock = mock();
const getFirstUserMessageContentMock = mock();

const getTimesheetsSectionMock = mock(async () => ({}));
const getProjectsSectionMock = mock(async () => ({}));
const getTasksSectionMock = mock(async () => ({}));
const getClientsSectionMock = mock(async () => ({}));
const getQuotesSectionMock = mock(async () => ({}));
const getOrdersSectionMock = mock(async () => ({}));
const getInvoicesSectionMock = mock(async () => ({}));
const getSuppliersSectionMock = mock(async () => ({}));
const getSupplierQuotesSectionMock = mock(async () => ({}));
const getCatalogSectionMock = mock(async () => ({}));
const listManagedUserIdsMock = mock(async () => [] as string[]);

let originalFetch: typeof fetch;
const fetchMock = mock();

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
  mock.module('../../repositories/generalSettingsRepo.ts', () => ({
    ...generalSettingsRepoSnap,
    get: getGeneralSettingsMock,
  }));
  mock.module('../../repositories/reportsAiChatRepo.ts', () => ({
    ...aiChatSnap,
    listSessionsForUser: listSessionsForUserMock,
    createSession: createSessionMock,
    archiveSession: archiveSessionMock,
    renameSession: renameSessionMock,
    sessionExistsForUser: sessionExistsForUserMock,
    getActiveSessionForUser: getActiveSessionForUserMock,
    updateSessionTitleAndTouch: updateSessionTitleAndTouchMock,
    touchSession: touchSessionMock,
    listMessagesForSession: listMessagesForSessionMock,
    listRecentMessages: listRecentMessagesMock,
    insertUserMessage: insertUserMessageMock,
    insertAssistantMessage: insertAssistantMessageMock,
    findUserMessage: findUserMessageMock,
    findFirstAssistantAfter: findFirstAssistantAfterMock,
    deleteMessage: deleteMessageMock,
    updateMessageContent: updateMessageContentMock,
    getFirstUserMessageContent: getFirstUserMessageContentMock,
  }));
  mock.module('../../repositories/reportsCatalogRepo.ts', () => ({
    ...reportsCatalogSnap,
    getSuppliersSection: getSuppliersSectionMock,
    getSupplierQuotesSection: getSupplierQuotesSectionMock,
    getCatalogSection: getCatalogSectionMock,
  }));
  mock.module('../../repositories/reportsClientsRepo.ts', () => ({
    ...reportsClientsSnap,
    getClientsSection: getClientsSectionMock,
  }));
  mock.module('../../repositories/reportsHoursRepo.ts', () => ({
    ...reportsHoursSnap,
    getTimesheetsSection: getTimesheetsSectionMock,
    getProjectsSection: getProjectsSectionMock,
    getTasksSection: getTasksSectionMock,
  }));
  mock.module('../../repositories/reportsRevenueRepo.ts', () => ({
    ...reportsRevenueSnap,
    getQuotesSection: getQuotesSectionMock,
    getOrdersSection: getOrdersSectionMock,
    getInvoicesSection: getInvoicesSectionMock,
  }));
  mock.module('../../repositories/workUnitsRepo.ts', () => ({
    ...workUnitsSnap,
    listManagedUserIds: listManagedUserIdsMock,
  }));
  mock.module('../../db/drizzle.ts', () => ({
    ...drizzleSnap,
    withDbTransaction: withDbTransactionMock,
  }));

  routePlugin = (await import('../../routes/reports.ts')).default as FastifyPluginAsync;

  originalFetch = globalThis.fetch;
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterAll(() => {
  restoreAuthMiddlewareMock();
  mock.module('../../repositories/usersRepo.ts', () => usersRepoSnap);
  mock.module('../../repositories/rolesRepo.ts', () => rolesRepoSnap);
  mock.module('../../utils/permissions.ts', () => permissionsSnap);
  mock.module('../../repositories/generalSettingsRepo.ts', () => generalSettingsRepoSnap);
  mock.module('../../repositories/reportsAiChatRepo.ts', () => aiChatSnap);
  mock.module('../../repositories/reportsCatalogRepo.ts', () => reportsCatalogSnap);
  mock.module('../../repositories/reportsClientsRepo.ts', () => reportsClientsSnap);
  mock.module('../../repositories/reportsHoursRepo.ts', () => reportsHoursSnap);
  mock.module('../../repositories/reportsRevenueRepo.ts', () => reportsRevenueSnap);
  mock.module('../../repositories/workUnitsRepo.ts', () => workUnitsSnap);
  mock.module('../../db/drizzle.ts', () => drizzleSnap);
  globalThis.fetch = originalFetch;
});

const HAPPY_USER = {
  id: 'u1',
  name: 'Alice',
  username: 'alice',
  role: 'manager',
  avatarInitials: 'AL',
  isDisabled: false,
  sessionVersion: 1,
};

const FULL_PERMS = ['reports.ai_reporting.view', 'reports.ai_reporting.create'];

const AI_ENABLED_SETTINGS = {
  enableAiReporting: true,
  aiProvider: 'gemini',
  geminiApiKey: 'test-gemini-key',
  geminiModelId: 'gemini-pro',
  openrouterApiKey: '',
  openrouterModelId: '',
  anthropicApiKey: '',
  anthropicModelId: '',
  openaiApiKey: '',
  openaiModelId: '',
  currency: 'EUR',
};

const allMocks = [
  findAuthUserByIdMock,
  userHasRoleMock,
  getRolePermissionsMock,
  getGeneralSettingsMock,
  listSessionsForUserMock,
  createSessionMock,
  archiveSessionMock,
  renameSessionMock,
  sessionExistsForUserMock,
  getActiveSessionForUserMock,
  updateSessionTitleAndTouchMock,
  touchSessionMock,
  listMessagesForSessionMock,
  listRecentMessagesMock,
  insertUserMessageMock,
  insertAssistantMessageMock,
  findUserMessageMock,
  findFirstAssistantAfterMock,
  deleteMessageMock,
  updateMessageContentMock,
  getFirstUserMessageContentMock,
  getTimesheetsSectionMock,
  getProjectsSectionMock,
  getTasksSectionMock,
  getClientsSectionMock,
  getQuotesSectionMock,
  getOrdersSectionMock,
  getInvoicesSectionMock,
  getSuppliersSectionMock,
  getSupplierQuotesSectionMock,
  getCatalogSectionMock,
  listManagedUserIdsMock,
  fetchMock,
  withDbTransactionMock,
];

let testApp: FastifyInstance;

beforeEach(async () => {
  for (const m of allMocks) m.mockReset();
  resetWithDbTransactionMock();
  findAuthUserByIdMock.mockResolvedValue(HAPPY_USER);
  userHasRoleMock.mockResolvedValue(true);
  getRolePermissionsMock.mockResolvedValue(FULL_PERMS);
  getGeneralSettingsMock.mockResolvedValue(AI_ENABLED_SETTINGS);
  listManagedUserIdsMock.mockResolvedValue([]);

  testApp = await buildRouteTestApp(routePlugin, '/api/reports');
});

afterEach(async () => {
  await testApp.close();
});

const authHeader = () => ({ authorization: `Bearer ${signToken({ userId: 'u1' })}` });

const okFetchResponse = (body: unknown, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as unknown as Response;

const openAiStreamResponse = (events: Array<Record<string, unknown>>) =>
  ({
    ok: true,
    status: 200,
    body: new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        for (const event of events) {
          controller.enqueue(
            encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`),
          );
        }
        controller.close();
      },
    }),
  }) as unknown as Response;

describe('GET /api/reports/ai-reporting/sessions', () => {
  test('200 returns sessions list for current user', async () => {
    listSessionsForUserMock.mockResolvedValue([
      { id: 'rpt-chat-1', title: 'My chat', createdAt: 1000, updatedAt: 2000 },
    ]);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/reports/ai-reporting/sessions',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe('rpt-chat-1');
    expect(listSessionsForUserMock).toHaveBeenCalledWith('u1');
  });

  test('400 when AI Reporting is disabled in settings', async () => {
    getGeneralSettingsMock.mockResolvedValue({
      ...AI_ENABLED_SETTINGS,
      enableAiReporting: false,
    });

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/reports/ai-reporting/sessions',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({
      error: 'AI Reporting is disabled by administration.',
    });
  });

  test('401 missing token', async () => {
    const res = await testApp.inject({
      method: 'GET',
      url: '/api/reports/ai-reporting/sessions',
    });
    expect(res.statusCode).toBe(401);
  });

  test('403 missing reports.ai_reporting.view permission', async () => {
    getRolePermissionsMock.mockResolvedValue([]);
    const res = await testApp.inject({
      method: 'GET',
      url: '/api/reports/ai-reporting/sessions',
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('POST /api/reports/ai-reporting/sessions', () => {
  test('200 creates a new session and returns its id', async () => {
    createSessionMock.mockResolvedValue(undefined);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/reports/ai-reporting/sessions',
      headers: authHeader(),
      payload: { title: 'My new chat' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.id).toMatch(/^rpt-chat/);
    expect(createSessionMock).toHaveBeenCalledWith(expect.any(String), 'u1', 'My new chat');
  });

  test('200 creates a session with empty title', async () => {
    createSessionMock.mockResolvedValue(undefined);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/reports/ai-reporting/sessions',
      headers: authHeader(),
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    expect(createSessionMock).toHaveBeenCalledWith(expect.any(String), 'u1', '');
  });

  test('400 when AI Reporting is disabled', async () => {
    getGeneralSettingsMock.mockResolvedValue({
      ...AI_ENABLED_SETTINGS,
      enableAiReporting: false,
    });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/reports/ai-reporting/sessions',
      headers: authHeader(),
      payload: {},
    });

    expect(res.statusCode).toBe(400);
  });

  test('401 missing token', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/reports/ai-reporting/sessions',
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });

  test('403 missing reports.ai_reporting.create permission', async () => {
    getRolePermissionsMock.mockResolvedValue(['reports.ai_reporting.view']);
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/reports/ai-reporting/sessions',
      headers: authHeader(),
      payload: {},
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('GET /api/reports/ai-reporting/sessions/:id/messages', () => {
  test('200 returns reversed messages for an existing session', async () => {
    sessionExistsForUserMock.mockResolvedValue(true);
    listMessagesForSessionMock.mockResolvedValue([
      {
        id: 'rpt-msg-2',
        sessionId: 'rpt-chat-1',
        role: 'assistant',
        content: 'World',
        thoughtContent: null,
        createdAt: 2000,
      },
      {
        id: 'rpt-msg-1',
        sessionId: 'rpt-chat-1',
        role: 'user',
        content: 'Hello',
        thoughtContent: null,
        createdAt: 1000,
      },
    ]);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/reports/ai-reporting/sessions/rpt-chat-1/messages',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveLength(2);
    // Result is `messages.reverse()`, so the user message comes first now.
    expect(body[0].id).toBe('rpt-msg-1');
    expect(body[1].id).toBe('rpt-msg-2');
  });

  test('200 honors limit and before query params', async () => {
    sessionExistsForUserMock.mockResolvedValue(true);
    listMessagesForSessionMock.mockResolvedValue([]);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/reports/ai-reporting/sessions/rpt-chat-1/messages?limit=50&before=1700000000000',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(listMessagesForSessionMock).toHaveBeenCalledWith('rpt-chat-1', {
      beforeMs: 1_700_000_000_000,
      limit: 50,
    });
  });

  test('400 limit must be a positive integer', async () => {
    const res = await testApp.inject({
      method: 'GET',
      url: '/api/reports/ai-reporting/sessions/rpt-chat-1/messages?limit=0',
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(400);
  });

  test('400 before must be a positive timestamp', async () => {
    const res = await testApp.inject({
      method: 'GET',
      url: '/api/reports/ai-reporting/sessions/rpt-chat-1/messages?before=-1',
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(400);
  });

  test('404 when session is not found', async () => {
    sessionExistsForUserMock.mockResolvedValue(false);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/reports/ai-reporting/sessions/rpt-chat-missing/messages',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toEqual({ error: 'Session not found' });
  });

  test('401 missing token', async () => {
    const res = await testApp.inject({
      method: 'GET',
      url: '/api/reports/ai-reporting/sessions/rpt-chat-1/messages',
    });
    expect(res.statusCode).toBe(401);
  });

  test('403 missing view permission', async () => {
    getRolePermissionsMock.mockResolvedValue([]);
    const res = await testApp.inject({
      method: 'GET',
      url: '/api/reports/ai-reporting/sessions/rpt-chat-1/messages',
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('PATCH /api/reports/ai-reporting/sessions/:id', () => {
  test('200 trims and renames a session successfully', async () => {
    renameSessionMock.mockResolvedValue(true);

    const res = await testApp.inject({
      method: 'PATCH',
      url: '/api/reports/ai-reporting/sessions/rpt-chat-1',
      headers: authHeader(),
      payload: { title: '  Revenue review  ' },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ success: true });
    expect(renameSessionMock).toHaveBeenCalledWith('rpt-chat-1', 'u1', 'Revenue review');
  });

  test('404 when the session does not exist', async () => {
    renameSessionMock.mockResolvedValue(false);
    const res = await testApp.inject({
      method: 'PATCH',
      url: '/api/reports/ai-reporting/sessions/missing',
      headers: authHeader(),
      payload: { title: 'Renamed chat' },
    });
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toEqual({ error: 'Session not found' });
  });

  test.each(['   ', 'x'.repeat(81)])('400 rejects invalid title %s', async (title) => {
    const res = await testApp.inject({
      method: 'PATCH',
      url: '/api/reports/ai-reporting/sessions/rpt-chat-1',
      headers: authHeader(),
      payload: { title },
    });
    expect(res.statusCode).toBe(400);
    expect(renameSessionMock).not.toHaveBeenCalled();
  });

  test('403 missing view permission', async () => {
    getRolePermissionsMock.mockResolvedValue([]);
    const res = await testApp.inject({
      method: 'PATCH',
      url: '/api/reports/ai-reporting/sessions/rpt-chat-1',
      headers: authHeader(),
      payload: { title: 'Renamed chat' },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('POST /api/reports/ai-reporting/sessions/:id/archive', () => {
  test('200 archives a session successfully', async () => {
    archiveSessionMock.mockResolvedValue(true);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/reports/ai-reporting/sessions/rpt-chat-1/archive',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ success: true });
    expect(archiveSessionMock).toHaveBeenCalledWith('rpt-chat-1', 'u1');
  });

  test('404 when session does not exist', async () => {
    archiveSessionMock.mockResolvedValue(false);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/reports/ai-reporting/sessions/missing/archive',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toEqual({ error: 'Session not found' });
  });

  test('401 missing token', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/reports/ai-reporting/sessions/rpt-chat-1/archive',
    });
    expect(res.statusCode).toBe(401);
  });

  test('403 missing view permission', async () => {
    getRolePermissionsMock.mockResolvedValue([]);
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/reports/ai-reporting/sessions/rpt-chat-1/archive',
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('POST /api/reports/ai-reporting/chat (non-streaming)', () => {
  test('200 happy path generates a response and stores it', async () => {
    listRecentMessagesMock.mockResolvedValue([]);
    insertUserMessageMock.mockResolvedValue(undefined);
    insertAssistantMessageMock.mockResolvedValue(undefined);
    createSessionMock.mockResolvedValue(undefined);
    updateSessionTitleAndTouchMock.mockResolvedValue(undefined);
    getFirstUserMessageContentMock.mockResolvedValue('Hello');

    fetchMock.mockResolvedValue(
      okFetchResponse({
        candidates: [
          {
            content: {
              parts: [{ text: 'Hello, how can I help?' }],
            },
          },
        ],
      }),
    );

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/reports/ai-reporting/chat',
      headers: authHeader(),
      payload: { message: 'Hello' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.text).toBe('Hello, how can I help?');
    expect(body.sessionId).toMatch(/^rpt-chat/);
    expect(insertUserMessageMock).toHaveBeenCalled();
    expect(insertAssistantMessageMock).toHaveBeenCalled();
    const providerRequest = JSON.parse(
      String((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.body),
    ) as {
      contents: Array<{ parts: Array<{ text: string }> }>;
    };
    const prompt = providerRequest.contents[0]?.parts[0]?.text ?? '';
    expect(prompt).toContain('Tool `render_visualization`');
    expect(prompt).toContain('```praetor-visualization');
    expect(prompt).toContain('Supported `type`: `bar`, `line`, `area`, `pie`, `donut`');
    expect(prompt).toContain('Required top-level fields are `version` (exactly `1`)');
    expect(prompt).toContain('at most 10 points');
    expect(prompt).toContain('Never include HTML, JavaScript, CSS, color values, URLs');
  });

  test('200 reuses existing session when sessionId is supplied', async () => {
    getActiveSessionForUserMock.mockResolvedValue({
      id: 'rpt-chat-1',
      title: 'Pre-existing',
    });
    listRecentMessagesMock.mockResolvedValue([]);
    insertUserMessageMock.mockResolvedValue(undefined);
    insertAssistantMessageMock.mockResolvedValue(undefined);
    updateSessionTitleAndTouchMock.mockResolvedValue(undefined);

    fetchMock.mockResolvedValue(
      okFetchResponse({
        candidates: [{ content: { parts: [{ text: 'Reply' }] } }],
      }),
    );

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/reports/ai-reporting/chat',
      headers: authHeader(),
      payload: { sessionId: 'rpt-chat-1', message: 'Hi' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.sessionId).toBe('rpt-chat-1');
    expect(getActiveSessionForUserMock).toHaveBeenCalledWith('rpt-chat-1', 'u1');
  });

  test('200 uses OpenAI Responses API and stores its text output', async () => {
    getGeneralSettingsMock.mockResolvedValue({
      ...AI_ENABLED_SETTINGS,
      aiProvider: 'openai',
      openaiApiKey: 'test-openai-key',
      openaiModelId: '  gpt-test  ',
    });
    getActiveSessionForUserMock.mockResolvedValue({ id: 'rpt-chat-1', title: 'Existing' });
    listRecentMessagesMock.mockResolvedValue([]);
    insertUserMessageMock.mockResolvedValue(undefined);
    insertAssistantMessageMock.mockResolvedValue(undefined);
    fetchMock.mockResolvedValue(
      okFetchResponse({
        output: [
          {
            type: 'message',
            content: [{ type: 'output_text', text: 'OpenAI answer' }],
          },
        ],
      }),
    );

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/reports/ai-reporting/chat',
      headers: authHeader(),
      payload: { sessionId: 'rpt-chat-1', message: 'Summarize revenue' },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).text).toBe('OpenAI answer');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect(init.headers).toEqual(
      expect.objectContaining({ Authorization: 'Bearer test-openai-key' }),
    );
    expect(JSON.parse(String(init.body))).toEqual(
      expect.objectContaining({ model: 'gpt-test', store: false }),
    );
    expect(insertAssistantMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'OpenAI answer' }),
    );
  });

  test('uses OpenAI Responses API for automatic session titles', async () => {
    getGeneralSettingsMock.mockResolvedValue({
      ...AI_ENABLED_SETTINGS,
      aiProvider: 'openai',
      openaiApiKey: 'test-openai-key',
      openaiModelId: 'gpt-test',
    });
    createSessionMock.mockResolvedValue(undefined);
    listRecentMessagesMock.mockResolvedValue([]);
    insertUserMessageMock.mockResolvedValue(undefined);
    insertAssistantMessageMock.mockResolvedValue(undefined);
    getFirstUserMessageContentMock.mockResolvedValue('Summarize revenue');
    updateSessionTitleAndTouchMock.mockResolvedValue(undefined);
    fetchMock
      .mockResolvedValueOnce(
        okFetchResponse({
          output: [
            {
              type: 'message',
              content: [{ type: 'output_text', text: 'Revenue is growing.' }],
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        okFetchResponse({
          output: [
            {
              type: 'message',
              content: [{ type: 'output_text', text: 'Revenue overview' }],
            },
          ],
        }),
      );

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/reports/ai-reporting/chat',
      headers: authHeader(),
      payload: { message: 'Summarize revenue' },
    });

    expect(res.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, titleInit] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(JSON.parse(String(titleInit.body))).toEqual(
      expect.objectContaining({
        model: 'gpt-test',
        store: false,
        input: expect.arrayContaining([
          expect.objectContaining({
            role: 'system',
            content: expect.stringContaining('short chat titles'),
          }),
        ]),
      }),
    );
    expect(updateSessionTitleAndTouchMock).toHaveBeenCalledWith(
      expect.stringMatching(/^rpt-chat/),
      'u1',
      'Revenue overview',
    );
  });

  test('surfaces an OpenAI refusal instead of storing an empty assistant message', async () => {
    getGeneralSettingsMock.mockResolvedValue({
      ...AI_ENABLED_SETTINGS,
      aiProvider: 'openai',
      openaiApiKey: 'test-openai-key',
      openaiModelId: 'gpt-test',
    });
    getActiveSessionForUserMock.mockResolvedValue({ id: 'rpt-chat-1', title: 'Existing' });
    listRecentMessagesMock.mockResolvedValue([]);
    insertUserMessageMock.mockResolvedValue(undefined);
    insertAssistantMessageMock.mockResolvedValue(undefined);
    fetchMock.mockResolvedValue(
      okFetchResponse({
        output: [
          {
            type: 'message',
            content: [{ type: 'refusal', refusal: 'I cannot answer that request.' }],
          },
        ],
      }),
    );

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/reports/ai-reporting/chat',
      headers: authHeader(),
      payload: { sessionId: 'rpt-chat-1', message: 'Disallowed request' },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).text).toBe('I cannot answer that request.');
    expect(insertAssistantMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'I cannot answer that request.' }),
    );
  });

  test('404 when supplied sessionId is not owned by the user', async () => {
    getActiveSessionForUserMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/reports/ai-reporting/chat',
      headers: authHeader(),
      payload: { sessionId: 'rpt-chat-other', message: 'Hi' },
    });

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toEqual({ error: 'Session not found' });
  });

  test('200 reuses session whose title is blank', async () => {
    getActiveSessionForUserMock.mockResolvedValue({ id: 'rpt-chat-1', title: '' });
    listRecentMessagesMock.mockResolvedValue([]);
    insertUserMessageMock.mockResolvedValue(undefined);
    insertAssistantMessageMock.mockResolvedValue(undefined);
    updateSessionTitleAndTouchMock.mockResolvedValue(undefined);
    getFirstUserMessageContentMock.mockResolvedValue('Tell me about revenue');

    fetchMock.mockResolvedValue(
      okFetchResponse({
        candidates: [{ content: { parts: [{ text: 'Reply' }] } }],
      }),
    );

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/reports/ai-reporting/chat',
      headers: authHeader(),
      payload: { sessionId: 'rpt-chat-1', message: 'Hi' },
    });

    expect(res.statusCode).toBe(200);
    expect(getFirstUserMessageContentMock).toHaveBeenCalledWith('rpt-chat-1');
    expect(updateSessionTitleAndTouchMock).toHaveBeenCalled();
  });

  test('400 when message is missing', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/reports/ai-reporting/chat',
      headers: authHeader(),
      payload: { message: '' },
    });
    expect(res.statusCode).toBe(400);
  });

  test('accepts messages above the legacy 4000 character limit', async () => {
    listRecentMessagesMock.mockResolvedValue([]);
    insertUserMessageMock.mockResolvedValue(undefined);
    insertAssistantMessageMock.mockResolvedValue(undefined);
    createSessionMock.mockResolvedValue(undefined);
    updateSessionTitleAndTouchMock.mockResolvedValue(undefined);
    getFirstUserMessageContentMock.mockResolvedValue('Long attachment prompt');
    fetchMock.mockResolvedValue(
      okFetchResponse({
        candidates: [{ content: { parts: [{ text: 'Attachment analyzed' }] } }],
      }),
    );

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/reports/ai-reporting/chat',
      headers: authHeader(),
      payload: { message: 'x'.repeat(5000) },
    });
    expect(res.statusCode).toBe(200);
  });

  test('400 when message exceeds 16000 chars', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/reports/ai-reporting/chat',
      headers: authHeader(),
      payload: { message: 'x'.repeat(16_001) },
    });
    expect(res.statusCode).toBe(400);
  });

  test('400 when AI reporting is disabled', async () => {
    getGeneralSettingsMock.mockResolvedValue({
      ...AI_ENABLED_SETTINGS,
      enableAiReporting: false,
    });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/reports/ai-reporting/chat',
      headers: authHeader(),
      payload: { message: 'Hi' },
    });
    expect(res.statusCode).toBe(400);
  });

  test('400 when provider api key is missing', async () => {
    getGeneralSettingsMock.mockResolvedValue({
      ...AI_ENABLED_SETTINGS,
      geminiApiKey: '',
    });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/reports/ai-reporting/chat',
      headers: authHeader(),
      payload: { message: 'Hi' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/Missing gemini API key/);
  });

  test('400 when provider model id is missing', async () => {
    getGeneralSettingsMock.mockResolvedValue({
      ...AI_ENABLED_SETTINGS,
      geminiModelId: '',
    });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/reports/ai-reporting/chat',
      headers: authHeader(),
      payload: { message: 'Hi' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/Missing gemini model id/);
  });

  test('502 when LLM call fails', async () => {
    listRecentMessagesMock.mockResolvedValue([]);
    insertUserMessageMock.mockResolvedValue(undefined);
    createSessionMock.mockResolvedValue(undefined);

    fetchMock.mockRejectedValue(new Error('upstream down'));

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/reports/ai-reporting/chat',
      headers: authHeader(),
      payload: { message: 'Hi' },
    });

    expect(res.statusCode).toBe(502);
    expect(JSON.parse(res.body).error).toMatch(/upstream down/);
  });

  test('200 generates a response through Anthropic Messages API', async () => {
    getGeneralSettingsMock.mockResolvedValue({
      ...AI_ENABLED_SETTINGS,
      aiProvider: 'anthropic',
      anthropicApiKey: 'sk-ant-test',
      anthropicModelId: 'claude-sonnet-4-5',
    });
    getActiveSessionForUserMock.mockResolvedValue({ id: 'rpt-chat-1', title: 'Existing' });
    listRecentMessagesMock.mockResolvedValue([]);
    insertUserMessageMock.mockResolvedValue(undefined);
    insertAssistantMessageMock.mockResolvedValue(undefined);
    touchSessionMock.mockResolvedValue(undefined);
    fetchMock.mockResolvedValue(
      okFetchResponse({ content: [{ type: 'text', text: 'Anthropic answer' }] }),
    );

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/reports/ai-reporting/chat',
      headers: authHeader(),
      payload: { sessionId: 'rpt-chat-1', message: 'Hi' },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).text).toBe('Anthropic answer');
    const [url, options] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(options.headers).toEqual(
      expect.objectContaining({
        'x-api-key': 'sk-ant-test',
        'anthropic-version': '2023-06-01',
      }),
    );
    expect(JSON.parse(String(options.body))).toEqual(
      expect.objectContaining({
        model: 'claude-sonnet-4-5',
        max_tokens: 4096,
        messages: expect.any(Array),
      }),
    );
    expect(insertAssistantMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'Anthropic answer' }),
    );
  });

  test('401 missing token', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/reports/ai-reporting/chat',
      payload: { message: 'Hi' },
    });
    expect(res.statusCode).toBe(401);
  });

  test('403 missing create permission', async () => {
    getRolePermissionsMock.mockResolvedValue(['reports.ai_reporting.view']);
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/reports/ai-reporting/chat',
      headers: authHeader(),
      payload: { message: 'Hi' },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('POST /api/reports/ai-reporting/chat/stream (streaming)', () => {
  test('streams OpenAI response.output_text.delta events', async () => {
    getGeneralSettingsMock.mockResolvedValue({
      ...AI_ENABLED_SETTINGS,
      aiProvider: 'openai',
      openaiApiKey: 'test-openai-key',
      openaiModelId: 'gpt-test',
    });
    getActiveSessionForUserMock.mockResolvedValue({ id: 'rpt-chat-1', title: 'Existing' });
    listRecentMessagesMock.mockResolvedValue([]);
    insertUserMessageMock.mockResolvedValue(undefined);
    insertAssistantMessageMock.mockResolvedValue(undefined);
    touchSessionMock.mockResolvedValue(undefined);

    fetchMock.mockResolvedValue(
      openAiStreamResponse([
        { type: 'response.output_text.delta', delta: 'OpenAI ' },
        { type: 'response.output_text.delta', delta: 'stream' },
      ]),
    );

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/reports/ai-reporting/chat/stream',
      headers: authHeader(),
      payload: { sessionId: 'rpt-chat-1', message: 'Summarize revenue' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('OpenAI ');
    expect(res.body).toContain('stream');
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual(
      expect.objectContaining({ model: 'gpt-test', stream: true, store: false }),
    );
    expect(insertAssistantMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'OpenAI stream' }),
    );
  });

  test('streams and persists OpenAI refusal events', async () => {
    getGeneralSettingsMock.mockResolvedValue({
      ...AI_ENABLED_SETTINGS,
      aiProvider: 'openai',
      openaiApiKey: 'test-openai-key',
      openaiModelId: 'gpt-test',
    });
    getActiveSessionForUserMock.mockResolvedValue({ id: 'rpt-chat-1', title: 'Existing' });
    listRecentMessagesMock.mockResolvedValue([]);
    insertUserMessageMock.mockResolvedValue(undefined);
    insertAssistantMessageMock.mockResolvedValue(undefined);
    touchSessionMock.mockResolvedValue(undefined);
    fetchMock.mockResolvedValue(
      openAiStreamResponse([
        { type: 'response.refusal.delta', delta: 'Cannot ' },
        { type: 'response.refusal.done', refusal: 'Cannot answer' },
      ]),
    );

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/reports/ai-reporting/chat/stream',
      headers: authHeader(),
      payload: { sessionId: 'rpt-chat-1', message: 'Disallowed request' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Cannot ');
    expect(res.body).toContain('answer');
    expect(insertAssistantMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'Cannot answer' }),
    );
  });

  test('401 missing token', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/reports/ai-reporting/chat/stream',
      payload: { message: 'Hi' },
    });
    expect(res.statusCode).toBe(401);
  });

  test('403 missing create permission', async () => {
    getRolePermissionsMock.mockResolvedValue(['reports.ai_reporting.view']);
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/reports/ai-reporting/chat/stream',
      headers: authHeader(),
      payload: { message: 'Hi' },
    });
    expect(res.statusCode).toBe(403);
  });

  test('400 when AI reporting is disabled', async () => {
    getGeneralSettingsMock.mockResolvedValue({
      ...AI_ENABLED_SETTINGS,
      enableAiReporting: false,
    });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/reports/ai-reporting/chat/stream',
      headers: authHeader(),
      payload: { message: 'Hi' },
    });

    expect(res.statusCode).toBe(400);
  });

  test('400 when message is missing', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/reports/ai-reporting/chat/stream',
      headers: authHeader(),
      payload: { message: '' },
    });
    expect(res.statusCode).toBe(400);
  });

  test('404 when supplied sessionId is not owned by the user', async () => {
    getActiveSessionForUserMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/reports/ai-reporting/chat/stream',
      headers: authHeader(),
      payload: { sessionId: 'rpt-chat-other', message: 'Hi' },
    });

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toEqual({ error: 'Session not found' });
  });

  test('streams Anthropic text deltas and persists the final answer', async () => {
    getGeneralSettingsMock.mockResolvedValue({
      ...AI_ENABLED_SETTINGS,
      aiProvider: 'anthropic',
      anthropicApiKey: 'sk-ant-test',
      anthropicModelId: 'claude-sonnet-4-5',
    });
    getActiveSessionForUserMock.mockResolvedValue({ id: 'rpt-chat-1', title: 'Existing' });
    listRecentMessagesMock.mockResolvedValue([]);
    insertUserMessageMock.mockResolvedValue(undefined);
    insertAssistantMessageMock.mockResolvedValue(undefined);
    touchSessionMock.mockResolvedValue(undefined);
    const anthropicChunk = [
      'event: content_block_delta',
      `data: ${JSON.stringify({
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: 'Streamed ' },
      })}`,
      '',
      'event: content_block_delta',
      `data: ${JSON.stringify({
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: 'answer' },
      })}`,
      '',
      '',
    ].join('\r\n');
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(anthropicChunk));
          controller.close();
        },
      }),
    } as unknown as Response);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/reports/ai-reporting/chat/stream',
      headers: authHeader(),
      payload: { sessionId: 'rpt-chat-1', message: 'Hi' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('event: answer_delta');
    expect(res.body).toContain('Streamed answer');
    expect(insertAssistantMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'Streamed answer' }),
    );
    const options = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(JSON.parse(String(options.body)).stream).toBe(true);
  });
});

describe('POST /api/reports/ai-reporting/chat/edit-stream', () => {
  test('401 missing token', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/reports/ai-reporting/chat/edit-stream',
      payload: { sessionId: 's', messageId: 'm', content: 'edited' },
    });
    expect(res.statusCode).toBe(401);
  });

  test('403 missing create permission', async () => {
    getRolePermissionsMock.mockResolvedValue(['reports.ai_reporting.view']);
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/reports/ai-reporting/chat/edit-stream',
      headers: authHeader(),
      payload: { sessionId: 's', messageId: 'm', content: 'edited' },
    });
    expect(res.statusCode).toBe(403);
  });

  test('400 missing required content', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/reports/ai-reporting/chat/edit-stream',
      headers: authHeader(),
      payload: { sessionId: 's', messageId: 'm', content: '' },
    });
    expect(res.statusCode).toBe(400);
  });

  test('400 when edited content exceeds 16000 chars', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/reports/ai-reporting/chat/edit-stream',
      headers: authHeader(),
      payload: { sessionId: 's', messageId: 'm', content: 'x'.repeat(16_001) },
    });
    expect(res.statusCode).toBe(400);
  });

  test('400 AI disabled', async () => {
    getGeneralSettingsMock.mockResolvedValue({
      ...AI_ENABLED_SETTINGS,
      enableAiReporting: false,
    });
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/reports/ai-reporting/chat/edit-stream',
      headers: authHeader(),
      payload: { sessionId: 's', messageId: 'm', content: 'hi' },
    });
    expect(res.statusCode).toBe(400);
  });

  test('404 session does not exist', async () => {
    getActiveSessionForUserMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/reports/ai-reporting/chat/edit-stream',
      headers: authHeader(),
      payload: { sessionId: 'missing', messageId: 'm', content: 'hi' },
    });

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toEqual({ error: 'Session not found' });
  });

  test('404 user message does not exist', async () => {
    getActiveSessionForUserMock.mockResolvedValue({
      id: 'rpt-chat-1',
      title: 'Existing',
    });
    findUserMessageMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/reports/ai-reporting/chat/edit-stream',
      headers: authHeader(),
      payload: { sessionId: 'rpt-chat-1', messageId: 'm-missing', content: 'hi' },
    });

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toEqual({ error: 'User message not found' });
  });

  // Regression for issue #413: previously the route deleted the old paired assistant
  // BEFORE starting the AI stream, so a streaming failure permanently lost that response.
  // Now deletion is deferred until the atomic swap that also inserts the new assistant.
  test('preserves old paired assistant when AI provider fetch fails (deferred deletion)', async () => {
    getActiveSessionForUserMock.mockResolvedValue({ id: 'rpt-chat-1', title: 'Existing' });
    findUserMessageMock.mockResolvedValue({ id: 'm-user', createdAt: new Date(1000) });
    findFirstAssistantAfterMock.mockResolvedValue({
      id: 'm-old-assistant',
      createdAt: new Date(2000),
    });
    listRecentMessagesMock.mockResolvedValue([]);
    updateMessageContentMock.mockResolvedValue(undefined);
    fetchMock.mockRejectedValue(new Error('provider unreachable'));

    await testApp.inject({
      method: 'POST',
      url: '/api/reports/ai-reporting/chat/edit-stream',
      headers: authHeader(),
      payload: { sessionId: 'rpt-chat-1', messageId: 'm-user', content: 'edited' },
    });

    // The user's edit is persisted immediately (visible regardless of stream outcome).
    expect(updateMessageContentMock).toHaveBeenCalledWith('m-user', 'edited');
    // Old assistant message must NOT be deleted when streaming fails — this is the
    // core regression assertion for #413. Old code deleted it before the stream even
    // began, so the previous assistant response was permanently lost on any failure.
    expect(deleteMessageMock).not.toHaveBeenCalled();
    // No new assistant inserted either — the atomic swap never ran.
    expect(insertAssistantMessageMock).not.toHaveBeenCalled();
    // And the swap transaction wrapper was never invoked.
    expect(withDbTransactionMock).not.toHaveBeenCalled();
  });

  test('wraps delete-old + insert-new in a single transaction on stream success', async () => {
    getActiveSessionForUserMock.mockResolvedValue({ id: 'rpt-chat-1', title: 'Existing' });
    findUserMessageMock.mockResolvedValue({ id: 'm-user', createdAt: new Date(1000) });
    findFirstAssistantAfterMock.mockResolvedValue({
      id: 'm-old-assistant',
      createdAt: new Date(2000),
    });
    listRecentMessagesMock.mockResolvedValue([]);
    updateMessageContentMock.mockResolvedValue(undefined);
    deleteMessageMock.mockResolvedValue(undefined);
    insertAssistantMessageMock.mockResolvedValue(undefined);
    touchSessionMock.mockResolvedValue(undefined);

    // Streaming SSE body with a single Gemini text chunk so the stream succeeds.
    const geminiChunk = `data: ${JSON.stringify({
      candidates: [{ content: { parts: [{ text: 'new answer' }] } }],
    })}\n\n`;
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(geminiChunk));
          controller.close();
        },
      }),
    } as unknown as Response);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/reports/ai-reporting/chat/edit-stream',
      headers: authHeader(),
      payload: { sessionId: 'rpt-chat-1', messageId: 'm-user', content: 'edited' },
    });

    expect(res.statusCode).toBe(200);
    expect(withDbTransactionMock).toHaveBeenCalledTimes(1);
    // Both repo writes happened inside the tx callback (TX_SENTINEL is passed as exec).
    expect(deleteMessageMock).toHaveBeenCalledWith('m-old-assistant', TX_SENTINEL);
    expect(insertAssistantMessageMock).toHaveBeenCalledTimes(1);
    expect(insertAssistantMessageMock.mock.calls[0]?.[1]).toBe(TX_SENTINEL);
  });

  test('skips deleteMessage in transaction when no paired assistant exists', async () => {
    getActiveSessionForUserMock.mockResolvedValue({ id: 'rpt-chat-1', title: 'Existing' });
    findUserMessageMock.mockResolvedValue({ id: 'm-user', createdAt: new Date(1000) });
    findFirstAssistantAfterMock.mockResolvedValue(null);
    listRecentMessagesMock.mockResolvedValue([]);
    updateMessageContentMock.mockResolvedValue(undefined);
    insertAssistantMessageMock.mockResolvedValue(undefined);
    touchSessionMock.mockResolvedValue(undefined);

    const geminiChunk = `data: ${JSON.stringify({
      candidates: [{ content: { parts: [{ text: 'first answer' }] } }],
    })}\n\n`;
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(geminiChunk));
          controller.close();
        },
      }),
    } as unknown as Response);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/reports/ai-reporting/chat/edit-stream',
      headers: authHeader(),
      payload: { sessionId: 'rpt-chat-1', messageId: 'm-user', content: 'edited' },
    });

    expect(res.statusCode).toBe(200);
    expect(withDbTransactionMock).toHaveBeenCalledTimes(1);
    expect(deleteMessageMock).not.toHaveBeenCalled();
    expect(insertAssistantMessageMock).toHaveBeenCalledTimes(1);
    expect(insertAssistantMessageMock.mock.calls[0]?.[1]).toBe(TX_SENTINEL);
  });
});
