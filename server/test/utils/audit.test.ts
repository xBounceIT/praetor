import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { FastifyRequest } from 'fastify';
import * as realAuditLogsRepo from '../../repositories/auditLogsRepo.ts';

// Snapshot real exports BEFORE registering mocks (mock.module inside beforeAll is not hoisted).
const auditRepoSnapshot = { ...realAuditLogsRepo };

const createMock = mock(async (_input: realAuditLogsRepo.AuditLogInsert) => undefined);

beforeAll(() => {
  mock.module('../../repositories/auditLogsRepo.ts', () => ({
    ...auditRepoSnapshot,
    create: createMock,
  }));
});

afterAll(() => {
  mock.module('../../repositories/auditLogsRepo.ts', () => auditRepoSnapshot);
});

beforeEach(() => {
  createMock.mockClear();
  createMock.mockImplementation(async () => undefined);
});

// Import after the module mock has been registered so the audit module sees the mocked repo.
const { getAuditChangedFields, deriveToggleAction, getAuditCounts, logAudit } = await import(
  '../../utils/audit.ts'
);

const buildRequest = (overrides: Partial<FastifyRequest> = {}): FastifyRequest =>
  ({
    ip: '10.0.0.5',
    user: {
      id: 'user-1',
      name: 'A',
      username: 'a',
      role: 'user',
      avatarInitials: 'A',
      permissions: [],
    },
    ...overrides,
  }) as unknown as FastifyRequest;

describe('getAuditChangedFields', () => {
  test('returns sorted field names, omitting undefined values', () => {
    expect(
      getAuditChangedFields({
        name: 'Bob',
        email: 'bob@example.com',
        ignored: undefined,
      }),
    ).toEqual(['email', 'name']);
  });

  test('keeps null and falsy non-undefined values', () => {
    expect(
      getAuditChangedFields({
        active: false,
        deletedAt: null,
        notes: '',
      }),
    ).toEqual(['active', 'deletedAt', 'notes']);
  });

  test('omits sensitive fields', () => {
    expect(
      getAuditChangedFields({
        password: 'secret',
        passwordHash: 'h',
        token: 't',
        smtp_password: 's',
        bindPassword: 'b',
        apiKey: 'k',
        api_key: 'k',
        geminiApiKey: 'g',
        gemini_api_key: 'g',
        openrouterApiKey: 'o',
        openrouter_api_key: 'o',
        accessToken: 'at',
        refreshToken: 'rt',
        secret: 's',
        clientSecret: 'cs',
        smtpPassword: 'sp',
        password_hash: 'ph',
        bind_password: 'bp',
        name: 'Bob',
      }),
    ).toEqual(['name']);
  });

  test('respects additional excludes', () => {
    expect(
      getAuditChangedFields(
        { name: 'Bob', email: 'b@e.com', internal: 'x' },
        { exclude: ['internal'] },
      ),
    ).toEqual(['email', 'name']);
  });

  test('returns undefined when nothing remains', () => {
    expect(getAuditChangedFields({})).toBeUndefined();
    expect(getAuditChangedFields({ password: 'x' })).toBeUndefined();
    expect(getAuditChangedFields({ name: undefined })).toBeUndefined();
  });
});

describe('deriveToggleAction', () => {
  test('returns onAction when only the toggle key changed and isOn is true', () => {
    expect(deriveToggleAction(['active'], 'active', 'base.update', 'on', 'off', true)).toBe('on');
  });

  test('returns offAction when only the toggle key changed and isOn is false', () => {
    expect(deriveToggleAction(['active'], 'active', 'base.update', 'on', 'off', false)).toBe('off');
  });

  test('returns offAction when only the toggle key changed and isOn is undefined', () => {
    expect(deriveToggleAction(['active'], 'active', 'base.update', 'on', 'off', undefined)).toBe(
      'off',
    );
  });

  test('returns base when there are other changed fields', () => {
    expect(deriveToggleAction(['active', 'name'], 'active', 'base.update', 'on', 'off', true)).toBe(
      'base.update',
    );
  });

  test('returns base when changedFields is empty/undefined', () => {
    expect(deriveToggleAction(undefined, 'active', 'base.update', 'on', 'off', true)).toBe(
      'base.update',
    );
    expect(deriveToggleAction([], 'active', 'base.update', 'on', 'off', true)).toBe('base.update');
  });

  test('returns base when only the changed field is not the toggle key', () => {
    expect(deriveToggleAction(['name'], 'active', 'base.update', 'on', 'off', true)).toBe(
      'base.update',
    );
  });
});

describe('getAuditCounts', () => {
  test('keeps non-negative finite numbers', () => {
    expect(getAuditCounts({ added: 1, removed: 0, kept: 3 })).toEqual({
      added: 1,
      removed: 0,
      kept: 3,
    });
  });

  test('drops null/undefined/negative/non-finite values', () => {
    expect(
      getAuditCounts({
        added: 2,
        skipped: null,
        omitted: undefined,
        invalid: -1,
        infinite: Number.POSITIVE_INFINITY,
        nan: Number.NaN,
      }),
    ).toEqual({ added: 2 });
  });

  test('returns undefined when nothing remains', () => {
    expect(getAuditCounts({})).toBeUndefined();
    expect(getAuditCounts({ skipped: null, gone: undefined, bad: -2 })).toBeUndefined();
  });
});

describe('logAudit', () => {
  test('skips and warns when no userId is available', async () => {
    const request = buildRequest({ user: undefined });
    await logAudit({ request, action: 'noop' });
    expect(createMock).not.toHaveBeenCalled();
  });

  test('uses request.user.id by default', async () => {
    const request = buildRequest();
    await logAudit({ request, action: 'user.update' });
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(createMock.mock.calls[0][0]).toMatchObject({
      userId: 'user-1',
      action: 'user.update',
      entityType: null,
      entityId: null,
      ipAddress: '10.0.0.5',
      details: null,
    });
  });

  test('honors explicit userId override', async () => {
    const request = buildRequest({ user: undefined });
    await logAudit({ request, action: 'user.login', userId: 'override' });
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(createMock.mock.calls[0][0]?.userId).toBe('override');
  });

  test('falls back to ipAddress="unknown" when request.ip is missing', async () => {
    const request = buildRequest({ ip: '' as unknown as string });
    await logAudit({ request, action: 'user.update' });
    expect(createMock.mock.calls[0][0]?.ipAddress).toBe('unknown');
  });

  test('passes through entityType and entityId when provided', async () => {
    const request = buildRequest();
    await logAudit({
      request,
      action: 'project.update',
      entityType: 'project',
      entityId: 'p-1',
    });
    expect(createMock.mock.calls[0][0]).toMatchObject({
      entityType: 'project',
      entityId: 'p-1',
    });
  });

  test('normalizes details: trims labels and drops sensitive/empty changedFields', async () => {
    const request = buildRequest();
    await logAudit({
      request,
      action: 'user.update',
      details: {
        targetLabel: '  Bob  ',
        secondaryLabel: '  team  ',
        changedFields: ['name', 'password', '', '  email  ', 'name'],
        counts: { added: 2, bad: -1 },
        fromValue: '  off  ',
        toValue: '  on  ',
      },
    });
    expect(createMock.mock.calls[0][0]?.details).toEqual({
      targetLabel: 'Bob',
      secondaryLabel: 'team',
      // sorted, deduped, sensitive ('password') removed
      changedFields: ['email', 'name'],
      counts: { added: 2 },
      fromValue: 'off',
      toValue: 'on',
    });
  });

  test('normalizes details: padded sensitive changedFields are stripped after trim', async () => {
    const request = buildRequest();
    await logAudit({
      request,
      action: 'user.update',
      details: {
        // Whitespace-padded "password" must not bypass SENSITIVE_AUDIT_FIELDS by
        // sneaking through the pre-trim check and surfacing as 'password' after trim.
        changedFields: ['name', '  password  ', '\tpassword\n', 'email'],
      },
    });
    expect(createMock.mock.calls[0][0]?.details?.changedFields).toEqual(['email', 'name']);
  });

  test('normalizes details: empty trimmed labels become undefined', async () => {
    const request = buildRequest();
    await logAudit({
      request,
      action: 'user.update',
      details: {
        targetLabel: '   ',
        secondaryLabel: '   ',
        fromValue: '   ',
        toValue: '   ',
        changedFields: ['name'],
      },
    });
    const details = createMock.mock.calls[0][0]?.details;
    expect(details).toBeTruthy();
    expect(details?.targetLabel).toBeUndefined();
    expect(details?.secondaryLabel).toBeUndefined();
    expect(details?.fromValue).toBeUndefined();
    expect(details?.toValue).toBeUndefined();
    expect(details?.changedFields).toEqual(['name']);
  });

  test('normalizes details: missing optional fields produce undefined branches', async () => {
    const request = buildRequest();
    await logAudit({
      request,
      action: 'user.update',
      details: {
        changedFields: ['name'],
      },
    });
    const details = createMock.mock.calls[0][0]?.details;
    expect(details?.changedFields).toEqual(['name']);
    expect(details?.counts).toBeUndefined();
  });

  test('normalizes details: counts that filter to empty become undefined', async () => {
    const request = buildRequest();
    await logAudit({
      request,
      action: 'user.update',
      details: {
        targetLabel: 'Bob',
        counts: { bad: -1, missing: Number.NaN },
      },
    });
    const details = createMock.mock.calls[0][0]?.details;
    expect(details?.counts).toBeUndefined();
    expect(details?.targetLabel).toBe('Bob');
  });

  test('normalizes details: returns null when every field is empty/sensitive', async () => {
    const request = buildRequest();
    await logAudit({
      request,
      action: 'user.update',
      details: {
        targetLabel: '   ',
        secondaryLabel: '   ',
        fromValue: '   ',
        toValue: '   ',
        changedFields: ['password'],
        counts: { bad: -1 },
      },
    });
    expect(createMock.mock.calls[0][0]?.details).toBeNull();
  });

  test('details=null is passed through when no details are supplied', async () => {
    const request = buildRequest();
    await logAudit({ request, action: 'user.login' });
    expect(createMock.mock.calls[0][0]?.details).toBeNull();
  });

  test('swallows repo errors so the calling handler is not affected', async () => {
    createMock.mockImplementationOnce(async () => {
      throw new Error('db down');
    });
    const request = buildRequest();
    await expect(logAudit({ request, action: 'user.update' })).resolves.toBeUndefined();
  });
});
