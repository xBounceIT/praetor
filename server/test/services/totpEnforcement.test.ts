import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import * as realGeneralSettingsRepo from '../../repositories/generalSettingsRepo.ts';
import * as realRolesRepo from '../../repositories/rolesRepo.ts';

const generalSettingsRepoSnap = { ...realGeneralSettingsRepo };
const rolesRepoSnap = { ...realRolesRepo };

const settingsGetMock = mock();
const listAvailableRolesForUserMock = mock();

let svc: typeof import('../../services/totpEnforcement.ts');

// Build a full GeneralSettings-shaped object so generalSettingsRepo.get returns something the service
// reads; only the five 2FA policy fields matter here, the rest are filler defaults.
const makeSettings = (policy: {
  enableTotp?: boolean;
  enforceTotp?: boolean;
  totpEnforcedRoleIds?: string[];
  totpExemptRoleIds?: string[];
  totpExemptUserIds?: string[];
}) => ({
  currency: 'EUR',
  dailyLimit: 8,
  startOfWeek: 'Monday',
  treatSaturdayAsHoliday: true,
  enableAiReporting: true,
  enableTotp: true,
  enforceTotp: false,
  totpEnforcedRoleIds: [],
  totpExemptRoleIds: [],
  totpExemptUserIds: [],
  geminiApiKey: '',
  aiProvider: 'gemini',
  ...policy,
});

// Mirror a rolesRepo.Role row for the assignable-roles lookup.
const role = (id: string) => ({ id, name: id, isSystem: false, isAdmin: false });

beforeAll(async () => {
  mock.module('../../repositories/generalSettingsRepo.ts', () => ({
    ...generalSettingsRepoSnap,
    get: settingsGetMock,
  }));
  mock.module('../../repositories/rolesRepo.ts', () => ({
    ...rolesRepoSnap,
    listAvailableRolesForUser: listAvailableRolesForUserMock,
  }));

  svc = await import('../../services/totpEnforcement.ts');
});

afterAll(() => {
  mock.module('../../repositories/generalSettingsRepo.ts', () => generalSettingsRepoSnap);
  mock.module('../../repositories/rolesRepo.ts', () => rolesRepoSnap);
});

beforeEach(() => {
  settingsGetMock.mockReset();
  listAvailableRolesForUserMock.mockReset();
  // Default: no extra assignable roles; tests that exercise multi-role override this.
  listAvailableRolesForUserMock.mockResolvedValue([]);
});

describe('userIsEnforced (pure)', () => {
  test('exempt wins: a role in exempt is never forced, even if also enforced', () => {
    const policy = {
      enableTotp: true,
      enforceTotp: true,
      enforcedRoleIds: ['admin'],
      exemptRoleIds: ['admin'],
      exemptUserIds: [],
    };
    expect(svc.userIsEnforced(policy, ['admin'])).toBe(false);
  });

  test('empty enforcedRoleIds means everyone (unless exempt)', () => {
    const policy = {
      enableTotp: true,
      enforceTotp: true,
      enforcedRoleIds: [],
      exemptRoleIds: [],
      exemptUserIds: [],
    };
    expect(svc.userIsEnforced(policy, ['user'])).toBe(true);
  });

  test('empty enforcedRoleIds: an exempt role is still spared', () => {
    const policy = {
      enableTotp: true,
      enforceTotp: true,
      enforcedRoleIds: [],
      exemptRoleIds: ['service-account'],
      exemptUserIds: [],
    };
    expect(svc.userIsEnforced(policy, ['service-account'])).toBe(false);
  });

  test('role in non-empty enforcedRoleIds is forced', () => {
    const policy = {
      enableTotp: true,
      enforceTotp: true,
      enforcedRoleIds: ['admin'],
      exemptRoleIds: [],
      exemptUserIds: [],
    };
    expect(svc.userIsEnforced(policy, ['admin'])).toBe(true);
  });

  test('role not in non-empty enforcedRoleIds and not exempt is not forced', () => {
    const policy = {
      enableTotp: true,
      enforceTotp: true,
      enforcedRoleIds: ['admin'],
      exemptRoleIds: [],
      exemptUserIds: [],
    };
    expect(svc.userIsEnforced(policy, ['user'])).toBe(false);
  });

  test('any one of the held roles being enforced is enough', () => {
    const policy = {
      enableTotp: true,
      enforceTotp: true,
      enforcedRoleIds: ['admin'],
      exemptRoleIds: [],
      exemptUserIds: [],
    };
    expect(svc.userIsEnforced(policy, ['user', 'admin'])).toBe(true);
  });
});

describe('isTotpFeatureEnabled', () => {
  test('reflects enableTotp = true', async () => {
    settingsGetMock.mockResolvedValue(makeSettings({ enableTotp: true }));
    expect(await svc.isTotpFeatureEnabled()).toBe(true);
  });

  test('reflects enableTotp = false', async () => {
    settingsGetMock.mockResolvedValue(makeSettings({ enableTotp: false }));
    expect(await svc.isTotpFeatureEnabled()).toBe(false);
  });

  test('defaults to true when settings row is null', async () => {
    settingsGetMock.mockResolvedValue(null);
    expect(await svc.isTotpFeatureEnabled()).toBe(true);
  });
});

describe('isTotpEnforcementActive', () => {
  test('true only when feature on AND enforcement on', async () => {
    settingsGetMock.mockResolvedValue(makeSettings({ enableTotp: true, enforceTotp: true }));
    expect(await svc.isTotpEnforcementActive()).toBe(true);
  });

  test('false when feature off even if enforcement on', async () => {
    settingsGetMock.mockResolvedValue(makeSettings({ enableTotp: false, enforceTotp: true }));
    expect(await svc.isTotpEnforcementActive()).toBe(false);
  });

  test('false when enforcement off', async () => {
    settingsGetMock.mockResolvedValue(makeSettings({ enableTotp: true, enforceTotp: false }));
    expect(await svc.isTotpEnforcementActive()).toBe(false);
  });
});

describe('isTotpMandatory', () => {
  test('false for non-applicable auth methods (oidc) without reading policy', async () => {
    const result = await svc.isTotpMandatory({ id: 'u1', role: 'admin', authMethod: 'oidc' });
    expect(result).toBe(false);
    expect(settingsGetMock).not.toHaveBeenCalled();
  });

  test('false for saml auth method', async () => {
    expect(await svc.isTotpMandatory({ id: 'u1', role: 'admin', authMethod: 'saml' })).toBe(false);
  });

  test('false when the feature is disabled even if enforcement is on', async () => {
    settingsGetMock.mockResolvedValue(
      makeSettings({ enableTotp: false, enforceTotp: true, totpEnforcedRoleIds: ['admin'] }),
    );
    expect(await svc.isTotpMandatory({ id: 'u1', role: 'admin', authMethod: 'local' })).toBe(false);
  });

  test('false when enforcement is off', async () => {
    settingsGetMock.mockResolvedValue(
      makeSettings({ enableTotp: true, enforceTotp: false, totpEnforcedRoleIds: ['admin'] }),
    );
    expect(await svc.isTotpMandatory({ id: 'u1', role: 'admin', authMethod: 'local' })).toBe(false);
  });

  test('true for an enforced local user', async () => {
    settingsGetMock.mockResolvedValue(
      makeSettings({ enableTotp: true, enforceTotp: true, totpEnforcedRoleIds: ['admin'] }),
    );
    expect(await svc.isTotpMandatory({ id: 'u1', role: 'admin', authMethod: 'local' })).toBe(true);
  });

  test('true for an enforced ldap user', async () => {
    settingsGetMock.mockResolvedValue(
      makeSettings({ enableTotp: true, enforceTotp: true, totpEnforcedRoleIds: ['admin'] }),
    );
    expect(await svc.isTotpMandatory({ id: 'u1', role: 'admin', authMethod: 'ldap' })).toBe(true);
  });

  test('respects exempt: an exempt role is not mandatory even when enforced', async () => {
    settingsGetMock.mockResolvedValue(
      makeSettings({
        enableTotp: true,
        enforceTotp: true,
        totpEnforcedRoleIds: ['admin'],
        totpExemptRoleIds: ['admin'],
      }),
    );
    expect(await svc.isTotpMandatory({ id: 'u1', role: 'admin', authMethod: 'local' })).toBe(false);
  });

  test('respects exempt users: an explicitly exempt user is not mandatory even when enforced', async () => {
    settingsGetMock.mockResolvedValue(
      makeSettings({
        enableTotp: true,
        enforceTotp: true,
        totpEnforcedRoleIds: ['admin'],
        totpExemptUserIds: ['u1'],
      }),
    );
    expect(await svc.isTotpMandatory({ id: 'u1', role: 'admin', authMethod: 'local' })).toBe(false);
    expect(listAvailableRolesForUserMock).not.toHaveBeenCalled();
  });

  test('false when the user holds no enforced role', async () => {
    settingsGetMock.mockResolvedValue(
      makeSettings({ enableTotp: true, enforceTotp: true, totpEnforcedRoleIds: ['admin'] }),
    );
    expect(await svc.isTotpMandatory({ id: 'u1', role: 'user', authMethod: 'local' })).toBe(false);
  });

  test('considers assignable roles: primary role not enforced but an assignable role is => true', async () => {
    settingsGetMock.mockResolvedValue(
      makeSettings({ enableTotp: true, enforceTotp: true, totpEnforcedRoleIds: ['admin'] }),
    );
    // Primary role 'user' is not enforced, but the user can also act as 'admin'.
    listAvailableRolesForUserMock.mockResolvedValue([role('admin')]);
    expect(await svc.isTotpMandatory({ id: 'u1', role: 'user', authMethod: 'local' })).toBe(true);
    expect(listAvailableRolesForUserMock).toHaveBeenCalledWith('u1', expect.anything());
  });
});

describe('requiresTotpEnrollment', () => {
  test('false when the user has already enrolled (totpEnabled)', async () => {
    settingsGetMock.mockResolvedValue(
      makeSettings({ enableTotp: true, enforceTotp: true, totpEnforcedRoleIds: ['admin'] }),
    );
    expect(
      await svc.requiresTotpEnrollment({
        id: 'u1',
        role: 'admin',
        authMethod: 'local',
        totpEnabled: true,
      }),
    ).toBe(false);
    // Short-circuits before touching the policy.
    expect(settingsGetMock).not.toHaveBeenCalled();
  });

  test('mirrors isTotpMandatory when not enrolled: true for an enforced user', async () => {
    settingsGetMock.mockResolvedValue(
      makeSettings({ enableTotp: true, enforceTotp: true, totpEnforcedRoleIds: ['admin'] }),
    );
    expect(
      await svc.requiresTotpEnrollment({
        id: 'u1',
        role: 'admin',
        authMethod: 'local',
        totpEnabled: false,
      }),
    ).toBe(true);
  });

  test('mirrors isTotpMandatory when not enrolled: false for a non-enforced user', async () => {
    settingsGetMock.mockResolvedValue(
      makeSettings({ enableTotp: true, enforceTotp: true, totpEnforcedRoleIds: ['admin'] }),
    );
    expect(
      await svc.requiresTotpEnrollment({
        id: 'u1',
        role: 'user',
        authMethod: 'local',
        totpEnabled: false,
      }),
    ).toBe(false);
  });
});

describe('totpRoleSwitchBlocked', () => {
  test('true when an unenrolled applicable user switches into an enforced target role', async () => {
    settingsGetMock.mockResolvedValue(
      makeSettings({ enableTotp: true, enforceTotp: true, totpEnforcedRoleIds: ['admin'] }),
    );
    expect(
      await svc.totpRoleSwitchBlocked(
        { id: 'u1', authMethod: 'local', totpEnabled: false },
        'admin',
      ),
    ).toBe(true);
  });

  test('false when the user has already enrolled', async () => {
    expect(
      await svc.totpRoleSwitchBlocked(
        { id: 'u1', authMethod: 'local', totpEnabled: true },
        'admin',
      ),
    ).toBe(false);
    // Short-circuits before reading policy.
    expect(settingsGetMock).not.toHaveBeenCalled();
  });

  test('false when the feature is disabled', async () => {
    settingsGetMock.mockResolvedValue(
      makeSettings({ enableTotp: false, enforceTotp: true, totpEnforcedRoleIds: ['admin'] }),
    );
    expect(
      await svc.totpRoleSwitchBlocked(
        { id: 'u1', authMethod: 'local', totpEnabled: false },
        'admin',
      ),
    ).toBe(false);
  });

  test('false when enforcement is off', async () => {
    settingsGetMock.mockResolvedValue(
      makeSettings({ enableTotp: true, enforceTotp: false, totpEnforcedRoleIds: ['admin'] }),
    );
    expect(
      await svc.totpRoleSwitchBlocked(
        { id: 'u1', authMethod: 'local', totpEnabled: false },
        'admin',
      ),
    ).toBe(false);
  });

  test('false when the auth method is not applicable (oidc)', async () => {
    expect(
      await svc.totpRoleSwitchBlocked(
        { id: 'u1', authMethod: 'oidc', totpEnabled: false },
        'admin',
      ),
    ).toBe(false);
    expect(settingsGetMock).not.toHaveBeenCalled();
  });

  test('false when the user holds an exempt role (exempt wins over the enforced target)', async () => {
    settingsGetMock.mockResolvedValue(
      makeSettings({
        enableTotp: true,
        enforceTotp: true,
        totpEnforcedRoleIds: ['admin'],
        totpExemptRoleIds: ['contractor'],
      }),
    );
    // The user already holds the exempt 'contractor' role while switching into enforced 'admin'.
    listAvailableRolesForUserMock.mockResolvedValue([role('contractor')]);
    expect(
      await svc.totpRoleSwitchBlocked(
        { id: 'u1', authMethod: 'local', totpEnabled: false },
        'admin',
      ),
    ).toBe(false);
  });

  test('false when the user is explicitly exempt while switching into an enforced target', async () => {
    settingsGetMock.mockResolvedValue(
      makeSettings({
        enableTotp: true,
        enforceTotp: true,
        totpEnforcedRoleIds: ['admin'],
        totpExemptUserIds: ['u1'],
      }),
    );
    expect(
      await svc.totpRoleSwitchBlocked(
        { id: 'u1', authMethod: 'local', totpEnabled: false },
        'admin',
      ),
    ).toBe(false);
    expect(listAvailableRolesForUserMock).not.toHaveBeenCalled();
  });

  test('false when switching into a non-enforced target role', async () => {
    settingsGetMock.mockResolvedValue(
      makeSettings({ enableTotp: true, enforceTotp: true, totpEnforcedRoleIds: ['admin'] }),
    );
    expect(
      await svc.totpRoleSwitchBlocked(
        { id: 'u1', authMethod: 'local', totpEnabled: false },
        'user',
      ),
    ).toBe(false);
  });
});
