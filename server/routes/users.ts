import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { withDbTransaction } from '../db/drizzle.ts';
import { authenticateToken, requireAnyPermission, requirePermission } from '../middleware/auth.ts';
import * as clientsRepo from '../repositories/clientsRepo.ts';
import * as externalIdentitiesRepo from '../repositories/externalIdentitiesRepo.ts';
import * as projectsRepo from '../repositories/projectsRepo.ts';
import * as rolesRepo from '../repositories/rolesRepo.ts';
import * as settingsRepo from '../repositories/settingsRepo.ts';
import * as ssoProvidersRepo from '../repositories/ssoProvidersRepo.ts';
import * as tasksRepo from '../repositories/tasksRepo.ts';
import * as userAssignmentsRepo from '../repositories/userAssignmentsRepo.ts';
import * as usersRepo from '../repositories/usersRepo.ts';
import {
  messageResponseSchema,
  standardErrorResponses,
  standardRateLimitedErrorResponses,
} from '../schemas/common.ts';
import {
  applyExternalRolesForUserIfMatched,
  externalGroupsYieldNoKnownRole,
} from '../services/external-auth.ts';
import { getAuditChangedFields, getAuditCounts, logAudit } from '../utils/audit.ts';
import { assertAuthenticated } from '../utils/auth-assert.ts';
import { getUniqueViolation } from '../utils/db-errors.ts';
import { computeAvatarInitials } from '../utils/initials.ts';
import { generatePrefixedId } from '../utils/order-ids.ts';
import {
  ADMIN_ROLE_ID,
  requestHasPermission as hasPermission,
  TOP_MANAGER_ROLE_ID,
} from '../utils/permissions.ts';
import { STANDARD_ROUTE_RATE_LIMIT } from '../utils/rate-limit.ts';
import { replyError } from '../utils/replyError.ts';
import {
  badRequest,
  ensureArrayOfStrings,
  optionalArrayOfStrings,
  optionalDateString,
  optionalEmail,
  optionalLocalizedNonNegativeNumber,
  optionalNonEmptyString,
  requireNonEmptyString,
  validateEnum,
} from '../utils/validation.ts';

const idParamSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
  },
  required: ['id'],
} as const;

const CONTRACT_TYPES = [
  'permanent',
  'fixed_term',
  'contractor',
  'internship',
  'consultant',
  'other',
] as const;
const EMPLOYMENT_STATUSES = ['active', 'onboarding', 'on_leave', 'terminated'] as const;
const WORK_LOCATIONS = ['office', 'remote', 'hybrid', 'customer_site', 'other'] as const;
const nullableStringSchema = { anyOf: [{ type: 'string' }, { type: 'null' }] } as const;
const nullableDateSchema = {
  anyOf: [{ type: 'string', format: 'date' }, { type: 'null' }],
} as const;
const nullableContractTypeSchema = {
  anyOf: [{ type: 'string', enum: CONTRACT_TYPES }, { type: 'null' }],
} as const;
const nullableEmploymentStatusSchema = {
  anyOf: [{ type: 'string', enum: EMPLOYMENT_STATUSES }, { type: 'null' }],
} as const;
const nullableWorkLocationSchema = {
  anyOf: [{ type: 'string', enum: WORK_LOCATIONS }, { type: 'null' }],
} as const;

const userSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    username: { type: 'string' },
    email: { type: 'string' },
    role: { type: 'string' },
    avatarInitials: { type: 'string' },
    costPerHour: { type: 'number' },
    isDisabled: { type: 'boolean' },
    employeeType: { type: 'string', enum: ['app_user', 'internal', 'external'] },
    firstName: nullableStringSchema,
    lastName: nullableStringSchema,
    phone: nullableStringSchema,
    jobTitle: nullableStringSchema,
    department: nullableStringSchema,
    employeeCode: nullableStringSchema,
    hireDate: nullableDateSchema,
    terminationDate: nullableDateSchema,
    contractType: nullableContractTypeSchema,
    employmentStatus: nullableEmploymentStatusSchema,
    workLocation: nullableWorkLocationSchema,
    emergencyContactName: nullableStringSchema,
    emergencyContactPhone: nullableStringSchema,
    notes: nullableStringSchema,
    authMethod: { type: 'string', enum: ['local', 'ldap', 'oidc', 'saml'] },
    authProviderId: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    authProviderName: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    hasTopManagerRole: { type: 'boolean' },
    isAdminOnly: { type: 'boolean' },
  },
  required: [
    'id',
    'name',
    'username',
    'email',
    'role',
    'avatarInitials',
    'costPerHour',
    'isDisabled',
    'employeeType',
    'authMethod',
    'authProviderId',
    'authProviderName',
    'hasTopManagerRole',
    'isAdminOnly',
  ],
} as const;

const userCreateBodySchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    username: { type: 'string' },
    password: { type: 'string' },
    role: { type: 'string' },
    email: { type: 'string' },
    costPerHour: { type: 'number' },
    employeeType: { type: 'string', enum: ['app_user', 'internal', 'external'] },
    firstName: nullableStringSchema,
    lastName: nullableStringSchema,
    phone: nullableStringSchema,
    jobTitle: nullableStringSchema,
    department: nullableStringSchema,
    employeeCode: nullableStringSchema,
    hireDate: nullableDateSchema,
    terminationDate: nullableDateSchema,
    contractType: nullableContractTypeSchema,
    employmentStatus: nullableEmploymentStatusSchema,
    workLocation: nullableWorkLocationSchema,
    emergencyContactName: nullableStringSchema,
    emergencyContactPhone: nullableStringSchema,
    notes: nullableStringSchema,
  },
  required: ['name'],
} as const;

const userUpdateBodySchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    isDisabled: { type: 'boolean' },
    costPerHour: { type: 'number' },
    role: { type: 'string' },
    email: { type: 'string' },
    firstName: nullableStringSchema,
    lastName: nullableStringSchema,
    phone: nullableStringSchema,
    jobTitle: nullableStringSchema,
    department: nullableStringSchema,
    employeeCode: nullableStringSchema,
    hireDate: nullableDateSchema,
    terminationDate: nullableDateSchema,
    contractType: nullableContractTypeSchema,
    employmentStatus: nullableEmploymentStatusSchema,
    workLocation: nullableWorkLocationSchema,
    emergencyContactName: nullableStringSchema,
    emergencyContactPhone: nullableStringSchema,
    notes: nullableStringSchema,
  },
} as const;

const assignmentsSchema = {
  type: 'object',
  properties: {
    clientIds: { type: 'array', items: { type: 'string' } },
    projectIds: { type: 'array', items: { type: 'string' } },
    taskIds: { type: 'array', items: { type: 'string' } },
  },
  required: ['clientIds', 'projectIds', 'taskIds'],
} as const;

const trackerCatalogsSchema = {
  type: 'object',
  properties: {
    clients: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          isDisabled: { type: 'boolean' },
        },
        required: ['id', 'name', 'isDisabled'],
      },
    },
    projects: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          clientId: { type: 'string' },
          isDisabled: { type: 'boolean' },
          billingType: { type: 'string' },
          billingFrequency: { type: 'string' },
        },
        required: ['id', 'name', 'clientId', 'isDisabled', 'billingType', 'billingFrequency'],
      },
    },
    projectTasks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          projectId: { type: 'string' },
          isDisabled: { type: 'boolean' },
        },
        required: ['id', 'name', 'projectId', 'isDisabled'],
      },
    },
  },
  required: ['clients', 'projects', 'projectTasks'],
} as const;

const assignmentsUpdateBodySchema = {
  type: 'object',
  properties: {
    clientIds: { type: 'array', items: { type: 'string' } },
    projectIds: { type: 'array', items: { type: 'string' } },
    taskIds: { type: 'array', items: { type: 'string' } },
  },
} as const;

const userRolesSchema = {
  type: 'object',
  properties: {
    roleIds: { type: 'array', items: { type: 'string' } },
    primaryRoleId: { type: 'string' },
  },
  required: ['roleIds', 'primaryRoleId'],
} as const;

const userRolesUpdateBodySchema = {
  type: 'object',
  properties: {
    roleIds: { type: 'array', items: { type: 'string' } },
    primaryRoleId: { type: 'string' },
  },
  required: ['roleIds', 'primaryRoleId'],
} as const;

const authMethodUpdateBodySchema = {
  type: 'object',
  properties: {
    authMethod: { type: 'string', enum: ['local', 'ldap', 'oidc', 'saml'] },
    authProviderId: { anyOf: [{ type: 'string' }, { type: 'null' }] },
  },
  required: ['authMethod'],
} as const;

const isSsoAuthMethod = (authMethod: usersRepo.AuthMethod): authMethod is 'oidc' | 'saml' =>
  authMethod === 'oidc' || authMethod === 'saml';

const canViewUserEmails = (request: FastifyRequest) =>
  hasPermission(request, 'administration.user_management_all.view') ||
  hasPermission(request, 'administration.user_management.view');

const canViewAllUsers = (request: FastifyRequest) =>
  hasPermission(request, 'administration.user_management_all.view') ||
  hasPermission(request, 'hr.work_units_all.view');

const canViewTargetUserAssignments = async (request: FastifyRequest, targetUserId: string) => {
  if (request.user?.id === targetUserId) return true;

  const hasAssignmentPermission =
    hasPermission(request, 'administration.user_management.view') ||
    hasPermission(request, 'administration.user_management.update') ||
    hasPermission(request, 'timesheets.tracker.view') ||
    hasPermission(request, 'timesheets.tracker_all.view') ||
    hasPermission(request, 'hr.employee_assignments.update');

  if (!hasAssignmentPermission) return false;
  if (canViewAllUsers(request)) return true;

  return usersRepo.canManageUser(targetUserId, request.user?.id ?? '');
};

const mergeById = <T extends { id: string }>(items: T[], extraItems: Iterable<T>) => {
  const seen = new Set(items.map((item) => item.id));
  const merged = [...items];
  for (const item of extraItems) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      merged.push(item);
    }
  }
  return merged;
};

const uniqueMissingIds = (ids: string[], existingIds: Set<string>) =>
  Array.from(new Set(ids.filter((id) => !existingIds.has(id))));

const CREATE_PERM_BY_EMPLOYEE_TYPE: Record<usersRepo.EmployeeType, string> = {
  app_user: 'administration.user_management.create',
  internal: 'hr.internal.create',
  external: 'hr.external.create',
};

const UPDATE_PERM_BY_EMPLOYEE_TYPE: Record<usersRepo.EmployeeType, string> = {
  app_user: 'administration.user_management.update',
  internal: 'hr.internal.update',
  external: 'hr.external.update',
};

const DELETE_PERM_BY_EMPLOYEE_TYPE: Record<usersRepo.EmployeeType, string> = {
  app_user: 'administration.user_management.delete',
  internal: 'hr.internal.delete',
  external: 'hr.external.delete',
};

const HR_UPDATE_PERM_BY_EMPLOYEE_TYPE: Record<usersRepo.EmployeeType, string> = {
  app_user: 'hr.internal.update',
  internal: 'hr.internal.update',
  external: 'hr.external.update',
};

const HR_VIEW_PERM_BY_EMPLOYEE_TYPE: Record<usersRepo.EmployeeType, string> = {
  app_user: 'hr.internal.view',
  internal: 'hr.internal.view',
  external: 'hr.external.view',
};

const HR_DETAIL_FIELDS = [
  'firstName',
  'lastName',
  'phone',
  'jobTitle',
  'department',
  'employeeCode',
  'hireDate',
  'terminationDate',
  'contractType',
  'employmentStatus',
  'workLocation',
  'emergencyContactName',
  'emergencyContactPhone',
  'notes',
] as const;

const canViewHrDetailsFor = (request: FastifyRequest, employeeType: usersRepo.EmployeeType) =>
  hasPermission(request, HR_VIEW_PERM_BY_EMPLOYEE_TYPE[employeeType]);

const canUpdateHrDetailsFor = (request: FastifyRequest, employeeType: usersRepo.EmployeeType) =>
  hasPermission(request, HR_UPDATE_PERM_BY_EMPLOYEE_TYPE[employeeType]);

const canViewEmailFor = (request: FastifyRequest, user: usersRepo.UserListRow) =>
  canViewUserEmails(request) || canViewHrDetailsFor(request, user.employeeType);

const maskUserResponse = (
  user: usersRepo.UserListRow,
  canViewCosts: boolean,
  canRevealUserEmails: boolean,
  canRevealHrDetails: boolean,
) => {
  const response: Partial<usersRepo.UserListRow> = {
    ...user,
    email: canRevealUserEmails ? user.email : '',
    costPerHour: canViewCosts ? user.costPerHour : 0,
  };

  if (!canRevealHrDetails) {
    for (const field of HR_DETAIL_FIELDS) {
      delete response[field];
    }
  }

  return response;
};

const maskUserForRequest = (request: FastifyRequest, user: usersRepo.UserListRow) =>
  maskUserResponse(
    user,
    canViewCostFor(request, user.id),
    canViewEmailFor(request, user),
    canViewHrDetailsFor(request, user.employeeType),
  );

// Cost visibility per row — the two scopes are strictly independent:
//   - own row    → hr.costs.view       (personal-scope, read-only counterpart of hr.costs.update)
//   - other row  → hr.costs_all.view   (others-scope, intentionally does NOT subsume own)
// A role wanting to see every user's cost must hold BOTH grants; the default
// manager/top_manager roles do (see migration 0055).
const canViewCostFor = (request: FastifyRequest, targetUserId: string | null | undefined) => {
  if (!targetUserId) return false;
  if (targetUserId === request.user?.id) return hasPermission(request, 'hr.costs.view');
  return hasPermission(request, 'hr.costs_all.view');
};

const parseNullableHrEnum = <T extends string>(
  value: unknown,
  allowedValues: readonly T[],
  fieldName: string,
): { ok: true; value: T | null } | { ok: false; message: string } => {
  if (value === null || value === '') return { ok: true, value: null };
  const result = validateEnum(value, allowedValues, fieldName);
  if (!result.ok) return result;
  return { ok: true, value: result.value };
};

const parseHrDetails = (
  body: Record<string, unknown>,
): { ok: true; fields: usersRepo.UserHrFields } | { ok: false; message: string } => {
  const fields: usersRepo.UserHrFields = {};
  const stringFields = [
    'firstName',
    'lastName',
    'phone',
    'jobTitle',
    'department',
    'employeeCode',
    'emergencyContactName',
    'emergencyContactPhone',
    'notes',
  ] as const;

  for (const field of stringFields) {
    if (!Object.hasOwn(body, field)) continue;
    const result = optionalNonEmptyString(body[field], field);
    if (!result.ok) return { ok: false, message: result.message };
    fields[field] = result.value;
  }

  if (Object.hasOwn(body, 'hireDate')) {
    const result = optionalDateString(body.hireDate, 'hireDate');
    if (!result.ok) return { ok: false, message: result.message };
    fields.hireDate = result.value;
  }

  if (Object.hasOwn(body, 'terminationDate')) {
    const result = optionalDateString(body.terminationDate, 'terminationDate');
    if (!result.ok) return { ok: false, message: result.message };
    fields.terminationDate = result.value;
  }

  if (
    fields.hireDate !== undefined &&
    fields.terminationDate !== undefined &&
    fields.hireDate &&
    fields.terminationDate &&
    fields.hireDate > fields.terminationDate
  ) {
    return { ok: false, message: 'hireDate must be on or before terminationDate' };
  }

  if (Object.hasOwn(body, 'contractType')) {
    const result = parseNullableHrEnum(body.contractType, CONTRACT_TYPES, 'contractType');
    if (!result.ok) return { ok: false, message: result.message };
    fields.contractType = result.value;
  }

  if (Object.hasOwn(body, 'employmentStatus')) {
    const result = parseNullableHrEnum(
      body.employmentStatus,
      EMPLOYMENT_STATUSES,
      'employmentStatus',
    );
    if (!result.ok) return { ok: false, message: result.message };
    fields.employmentStatus = result.value;
  }

  if (Object.hasOwn(body, 'workLocation')) {
    const result = parseNullableHrEnum(body.workLocation, WORK_LOCATIONS, 'workLocation');
    if (!result.ok) return { ok: false, message: result.message };
    fields.workLocation = result.value;
  }

  return { ok: true, fields };
};

const hasHrDetailPatch = (fields: usersRepo.UserHrFields) =>
  HR_DETAIL_FIELDS.some((field) => fields[field] !== undefined);

const getHrDateRangeError = (
  fields: usersRepo.UserHrFields,
  current?: Pick<usersRepo.UserCore, 'hireDate' | 'terminationDate'>,
): string | null => {
  const hireDate = fields.hireDate !== undefined ? fields.hireDate : (current?.hireDate ?? null);
  const terminationDate =
    fields.terminationDate !== undefined
      ? fields.terminationDate
      : (current?.terminationDate ?? null);

  if (hireDate && terminationDate && hireDate > terminationDate) {
    return 'hireDate must be on or before terminationDate';
  }
  return null;
};

const getUserUniqueViolationMessage = (err: unknown) => {
  const violation = getUniqueViolation(err);
  if (!violation) return null;
  if (
    violation.constraint === 'idx_users_employee_code_unique' ||
    violation.detail?.includes('employee_code')
  ) {
    return 'Employee code already exists';
  }
  if (
    violation.constraint === 'users_username_unique' ||
    violation.constraint === 'users_username_key' ||
    violation.constraint === 'idx_users_username_lower_unique' ||
    violation.detail?.includes('(username)') ||
    violation.detail?.includes('(lower(username))')
  ) {
    return 'Username already exists';
  }
  return null;
};

const ensureSubmittedAssignmentsInScope = async (
  request: FastifyRequest,
  {
    clientIds,
    projectIds,
    taskIds,
  }: {
    clientIds?: string[];
    projectIds?: string[];
    taskIds?: string[];
  },
) => {
  const userId = request.user?.id;
  if (!userId || hasPermission(request, 'administration.user_management_all.view')) return true;

  if (clientIds && !hasPermission(request, 'crm.clients_all.view')) {
    if (clientIds.length === 0) return false;
    const allowed = await userAssignmentsRepo.filterAssignedClientIds(userId, clientIds);
    if (clientIds.some((id) => !allowed.has(id))) return false;
  }

  if (projectIds && !hasPermission(request, 'projects.manage_all.view')) {
    if (projectIds.length === 0) return false;
    const allowed = await userAssignmentsRepo.filterAssignedProjectIds(userId, projectIds);
    if (projectIds.some((id) => !allowed.has(id))) return false;
  }

  if (taskIds && !hasPermission(request, 'projects.tasks_all.view')) {
    if (taskIds.length === 0) return false;
    const allowed = await userAssignmentsRepo.filterAssignedTaskIds(userId, taskIds);
    if (taskIds.some((id) => !allowed.has(id))) return false;
  }

  return true;
};

export default async function (fastify: FastifyInstance, _opts: unknown) {
  // GET / - List users
  fastify.get(
    '/',
    {
      onRequest: [
        fastify.rateLimit(STANDARD_ROUTE_RATE_LIMIT),
        authenticateToken,
        requireAnyPermission(
          'administration.user_management.view',
          'administration.user_management_all.view',
          'hr.internal.view',
          'hr.external.view',
          'timesheets.tracker.view',
          'timesheets.tracker_all.view',
          'timesheets.ril.view',
          'projects.manage.view',
          'projects.manage_all.view',
          'projects.tasks.view',
          'projects.tasks_all.view',
          'hr.work_units.view',
          'hr.work_units_all.view',
        ),
      ],
      schema: {
        tags: ['users'],
        summary: 'List users',
        response: {
          200: { type: 'array', items: userSchema },
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!assertAuthenticated(request, reply)) return;

      const canViewUserManagement = hasPermission(request, 'administration.user_management.view');
      const canViewManagedUsers =
        hasPermission(request, 'timesheets.tracker.view') ||
        hasPermission(request, 'timesheets.tracker_all.view') ||
        hasPermission(request, 'timesheets.ril.view') ||
        hasPermission(request, 'hr.work_units.view') ||
        hasPermission(request, 'hr.work_units_all.view') ||
        canViewUserManagement;
      const canViewInternal = hasPermission(request, 'hr.internal.view');
      const canViewExternal = hasPermission(request, 'hr.external.view');

      const users = canViewAllUsers(request)
        ? await usersRepo.listAllForAdmin()
        : await usersRepo.listScopedForManager(request.user.id, {
            canViewManagedUsers,
            canViewInternal,
            canViewExternal,
          });

      return users.map((u) => maskUserForRequest(request, u));
    },
  );

  // POST / - Create user (admin only for app_user, manager can create internal/external)
  fastify.post(
    '/',
    {
      onRequest: [
        authenticateToken,
        requireAnyPermission(
          'administration.user_management.create',
          'hr.internal.create',
          'hr.external.create',
        ),
      ],
      schema: {
        tags: ['users'],
        summary: 'Create user',
        body: userCreateBodySchema,
        response: {
          201: userSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as Record<string, unknown>;
      const { name, username, password, role, email, costPerHour, employeeType } = body as {
        name: string;
        username?: string;
        password?: string;
        role?: string;
        email?: string;
        costPerHour?: number;
        employeeType?: string;
      };

      const employeeTypeResult:
        | { ok: true; value: usersRepo.EmployeeType }
        | { ok: false; message: string } = employeeType
        ? validateEnum(employeeType, ['app_user', 'internal', 'external'] as const, 'employeeType')
        : { ok: true, value: 'app_user' };
      if (!employeeTypeResult.ok) return badRequest(reply, employeeTypeResult.message);

      const effectiveEmployeeType = employeeTypeResult.value;

      if (!hasPermission(request, CREATE_PERM_BY_EMPLOYEE_TYPE[effectiveEmployeeType])) {
        return replyError(request, reply, {
          statusCode: 403,
          message: 'Insufficient permissions',
          action: 'user.create.denied',
          entityType: 'user',
          details: { secondaryLabel: `employee_type_${effectiveEmployeeType}` },
        });
      }

      const nameResult = requireNonEmptyString(name, 'name');
      if (!nameResult.ok) return badRequest(reply, nameResult.message);

      const emailResult = optionalEmail(email, 'email');
      if (!emailResult.ok) return badRequest(reply, emailResult.message);

      // Validate `costPerHour` regardless of permission so malformed input still
      // returns 400 — matches the pre-split contract. The permission gate only
      // decides whether the validated value is *applied* to the new row.
      const costPerHourResult = optionalLocalizedNonNegativeNumber(costPerHour, 'costPerHour');
      if (!costPerHourResult.ok) return badRequest(reply, costPerHourResult.message);
      const canApplyCost = hasPermission(request, 'hr.costs_all.update');
      const hrDetailsResult = parseHrDetails(body);
      if (!hrDetailsResult.ok) return badRequest(reply, hrDetailsResult.message);
      const canApplyHrDetails =
        effectiveEmployeeType === 'app_user'
          ? canUpdateHrDetailsFor(request, effectiveEmployeeType)
          : true;
      const hrDetails = canApplyHrDetails ? hrDetailsResult.fields : {};
      const dateRangeError = getHrDateRangeError(hrDetailsResult.fields);
      if (dateRangeError) return badRequest(reply, dateRangeError);

      let usernameValue: string;
      let passwordHash: string;
      let roleValue: string;

      if (effectiveEmployeeType === 'internal' || effectiveEmployeeType === 'external') {
        // Internal/external employees never log in: generated username, random unguessable
        // password, default user role kept only for FK consistency.
        usernameValue = generatePrefixedId('emp');
        passwordHash = await bcrypt.hash(randomUUID(), 12);
        roleValue = 'user';
      } else {
        const usernameResult = requireNonEmptyString(username, 'username');
        if (!usernameResult.ok) return badRequest(reply, usernameResult.message);
        usernameValue = usernameResult.value;

        const passwordResult = requireNonEmptyString(password, 'password');
        if (!passwordResult.ok) return badRequest(reply, passwordResult.message);
        passwordHash = await bcrypt.hash(passwordResult.value, 12);

        const roleResult = requireNonEmptyString(role, 'role');
        if (!roleResult.ok) return badRequest(reply, roleResult.message);
        roleValue = roleResult.value;

        const [roleExists, usernameTaken] = await Promise.all([
          rolesRepo.findById(roleValue),
          usersRepo.existsByUsername(usernameValue),
        ]);
        if (!roleExists) return badRequest(reply, 'Invalid role');
        if (usernameTaken) return badRequest(reply, 'Username already exists');
      }

      const avatarInitials = computeAvatarInitials(nameResult.value);
      const id = generatePrefixedId('u');

      try {
        // Atomic create: user row, primary user_roles entry, settings row, and (for top
        // managers) auto-assignment fan-out commit or roll back together. Mirrors the PUT
        // handler so a failed sync can't leave a user with TOP_MANAGER role but no
        // auto-assignments - recovering from that requires re-saving the role manually.
        await withDbTransaction(async (tx) => {
          await usersRepo.insertUser(
            {
              id,
              name: nameResult.value,
              username: usernameValue,
              passwordHash,
              role: roleValue,
              avatarInitials,
              costPerHour: canApplyCost ? costPerHourResult.value || 0 : 0,
              isDisabled: false,
              employeeType: effectiveEmployeeType,
              ...hrDetails,
            },
            tx,
          );

          // Keep user_roles in sync with users.role (primary/default role).
          await usersRepo.addUserRole(id, roleValue, tx);
          await settingsRepo.upsertForUser(
            id,
            {
              fullName: nameResult.value,
              email: emailResult.value || '',
              language: null,
            },
            tx,
          );

          if (roleValue === TOP_MANAGER_ROLE_ID) {
            await userAssignmentsRepo.syncTopManagerAssignmentsForUser(id, tx);
          }
        });

        await logAudit({
          request,
          action: 'user.created',
          entityType: 'user',
          entityId: id,
          details: {
            targetLabel: nameResult.value,
            secondaryLabel: usernameValue,
          },
        });
        const createdUser: usersRepo.UserListRow = {
          id,
          name: nameResult.value,
          username: usernameValue,
          email: emailResult.value || '',
          role: roleValue,
          avatarInitials,
          // Mirror maskUserResponse's view-based mask used by GET / and PUT:
          // a caller without hr.costs_all.view always sees 0 in the response,
          // matching what a subsequent GET would return for the same row.
          // Personal-scope `hr.costs.view` is deliberately NOT consulted here:
          // the newly-created user is, by construction, never the caller, so
          // the self-only personal-scope view can never apply on this branch.
          costPerHour:
            hasPermission(request, 'hr.costs_all.view') && canApplyCost
              ? costPerHourResult.value || 0
              : 0,
          isDisabled: false,
          employeeType: effectiveEmployeeType,
          ...hrDetails,
          authMethod: 'local',
          authProviderId: null,
          authProviderName: null,
          hasTopManagerRole: roleValue === TOP_MANAGER_ROLE_ID,
          isAdminOnly: roleValue === ADMIN_ROLE_ID,
        };

        return reply.code(201).send(maskUserForRequest(request, createdUser));
      } catch (err) {
        const uniqueMessage = getUserUniqueViolationMessage(err);
        if (uniqueMessage) return badRequest(reply, uniqueMessage);
        throw err;
      }
    },
  );

  // DELETE /:id - Delete user (admin can delete any, manager can delete internal/external only)
  fastify.delete(
    '/:id',
    {
      onRequest: [
        authenticateToken,
        requireAnyPermission(
          'administration.user_management.delete',
          'hr.internal.delete',
          'hr.external.delete',
        ),
      ],
      schema: {
        tags: ['users'],
        summary: 'Delete user',
        params: idParamSchema,
        response: {
          204: { type: 'null' },
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      if (id === request.user?.id) {
        return badRequest(reply, 'Cannot delete your own account');
      }

      const user = await usersRepo.findCoreById(id);
      if (!user) {
        return replyError(request, reply, {
          statusCode: 404,
          message: 'User not found',
          action: 'user.delete.not_found',
          entityType: 'user',
          entityId: id,
        });
      }

      if (!hasPermission(request, DELETE_PERM_BY_EMPLOYEE_TYPE[user.employeeType])) {
        return replyError(request, reply, {
          statusCode: 403,
          message: 'Insufficient permissions',
          action: 'user.delete.denied',
          entityType: 'user',
          entityId: id,
          details: { secondaryLabel: `employee_type_${user.employeeType}` },
        });
      }

      const deleted = await usersRepo.deleteById(id);

      if (!deleted) {
        return replyError(request, reply, {
          statusCode: 404,
          message: 'User not found',
          action: 'user.delete.not_found',
          entityType: 'user',
          entityId: id,
        });
      }

      await logAudit({
        request,
        action: 'user.deleted',
        entityType: 'user',
        entityId: id,
        details: {
          targetLabel: user.name,
          secondaryLabel: user.username,
        },
      });
      return reply.code(204).send();
    },
  );

  // PUT /:id - Update user (admin and manager)
  fastify.put(
    '/:id',
    {
      onRequest: [
        authenticateToken,
        // The hr.costs.* grants are included so a role granted *only* a
        // cost-edit permission (personal `hr.costs.update` for self-edit, or
        // all-scope `hr.costs_all.update` for cross-user edit) can reach
        // this route to update costPerHour. The handler below enforces
        // self-vs-all + cost-only when those are the caller's only relevant
        // grants.
        requireAnyPermission(
          'administration.user_management.update',
          'hr.internal.update',
          'hr.external.update',
          'hr.costs.update',
          'hr.costs_all.update',
        ),
      ],
      schema: {
        tags: ['users'],
        summary: 'Update user',
        params: idParamSchema,
        body: userUpdateBodySchema,
        response: {
          200: userSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const body = request.body as Record<string, unknown>;
      const { name, email, isDisabled, costPerHour, role } = body as {
        name?: string;
        email?: string;
        isDisabled?: boolean;
        costPerHour?: number;
        role?: string;
      };
      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);

      const fields: usersRepo.UserUpdateFields = {};
      const isSelf = idResult.value === request.user?.id;

      if (name !== undefined) {
        const nameResult = requireNonEmptyString(name, 'name');
        if (!nameResult.ok) return badRequest(reply, nameResult.message);
        fields.name = nameResult.value;
      }

      if (costPerHour !== undefined) {
        // Strict self/other split: self-edit needs hr.costs.update; cross-user
        // edit needs hr.costs_all.update. The all-scope grant intentionally
        // does NOT cover self anymore — see canViewCostFor for the symmetric
        // view-side rule.
        const canEditCost = isSelf
          ? hasPermission(request, 'hr.costs.update')
          : hasPermission(request, 'hr.costs_all.update');
        if (canEditCost) {
          const costPerHourResult = optionalLocalizedNonNegativeNumber(costPerHour, 'costPerHour');
          if (!costPerHourResult.ok) return badRequest(reply, costPerHourResult.message);
          fields.costPerHour = costPerHourResult.value;
        }
      }

      let validatedEmail: string | null | undefined;
      if (email !== undefined) {
        const emailResult = optionalEmail(email, 'email');
        if (!emailResult.ok) return badRequest(reply, emailResult.message);
        validatedEmail = emailResult.value;
      }

      const hrDetailsResult = parseHrDetails(body);
      if (!hrDetailsResult.ok) return badRequest(reply, hrDetailsResult.message);
      const hrDetails = hrDetailsResult.fields;
      const hasHrDetails = hasHrDetailPatch(hrDetails);

      const targetUser = await usersRepo.findCoreById(idResult.value);
      if (!targetUser) {
        return replyError(request, reply, {
          statusCode: 404,
          message: 'User not found',
          action: 'user.update.not_found',
          entityType: 'user',
          entityId: idResult.value,
        });
      }

      const targetEmployeeType = targetUser.employeeType;
      const currentRole = targetUser.role;
      const currentName = targetUser.name;
      const currentUsername = targetUser.username;
      const dateRangeError = getHrDateRangeError(hrDetails, targetUser);
      if (dateRangeError) return badRequest(reply, dateRangeError);

      // Identity fields (display name, first/last name, email) are owned by the directory for
      // externally-managed users and are overwritten on each sync — reject attempts to set them
      // here so the API enforces the same read-only contract the UI shows (identityReadOnly).
      const managesExternalIdentity =
        name !== undefined ||
        email !== undefined ||
        hrDetails.firstName !== undefined ||
        hrDetails.lastName !== undefined;
      if (targetUser.authMethod !== 'local' && managesExternalIdentity) {
        return replyError(request, reply, {
          statusCode: 409,
          message: 'Name, surname, and email are managed by the external authentication provider',
          action: 'user.update.conflict',
          entityType: 'user',
          entityId: idResult.value,
          details: { secondaryLabel: `auth_method_${targetUser.authMethod}` },
        });
      }

      // Cost-only edit bypass: a role granted just a cost-edit permission
      // (personal `hr.costs.update` for self-edit, or all-scope
      // `hr.costs_all.update` for cross-user edit) can update costPerHour even
      // without the broader per-employee-type update grant — but only when
      // costPerHour is the sole field being touched. Other fields fall through
      // to the standard permission check below. Mirrors the strict self/other
      // split in the costPerHour-applying branch above.
      const onlyEditingCost =
        costPerHour !== undefined &&
        name === undefined &&
        email === undefined &&
        isDisabled === undefined &&
        role === undefined &&
        !hasHrDetails;
      const hasCostEditGrant = isSelf
        ? hasPermission(request, 'hr.costs.update')
        : hasPermission(request, 'hr.costs_all.update');
      const isCostOnlyEdit = onlyEditingCost && hasCostEditGrant;
      const hasStandardUpdatePermission = hasPermission(
        request,
        UPDATE_PERM_BY_EMPLOYEE_TYPE[targetEmployeeType],
      );
      const hasHrUpdatePermission = canUpdateHrDetailsFor(request, targetEmployeeType);
      const hasIdentityFields = name !== undefined || email !== undefined;
      const hasIdentityUpdatePermission = hasStandardUpdatePermission || hasHrUpdatePermission;
      const hasAccountFields = isDisabled !== undefined || role !== undefined;

      if (!isCostOnlyEdit && hasAccountFields && !hasStandardUpdatePermission) {
        return replyError(request, reply, {
          statusCode: 403,
          message: 'Insufficient permissions',
          action: 'user.update.denied',
          entityType: 'user',
          entityId: idResult.value,
          details: { secondaryLabel: `employee_type_${targetEmployeeType}` },
        });
      }

      if (!isCostOnlyEdit && hasIdentityFields && !hasIdentityUpdatePermission) {
        return replyError(request, reply, {
          statusCode: 403,
          message: 'Insufficient permissions',
          action: 'user.update.denied',
          entityType: 'user',
          entityId: idResult.value,
          details: { secondaryLabel: `employee_type_${targetEmployeeType}` },
        });
      }

      if (!isCostOnlyEdit && hasHrDetails && !hasHrUpdatePermission) {
        return replyError(request, reply, {
          statusCode: 403,
          message: 'Insufficient permissions',
          action: 'user.update.denied',
          entityType: 'user',
          entityId: idResult.value,
          details: { secondaryLabel: `employee_type_${targetEmployeeType}` },
        });
      }

      if (hasHrDetails) {
        Object.assign(fields, hrDetails);
      }

      // Cost-only edits also skip the manager-scoping check: the all-scope
      // `hr.costs_all.update` grant is explicitly cross-user by design, so
      // gating it through canManageUser would make the permission half-useful
      // (works for internal/external employees, fails for app_users).
      const appUserHrProfileEdit =
        targetEmployeeType === 'app_user' &&
        !hasAccountFields &&
        (hasIdentityFields || hasHrDetails) &&
        hasHrUpdatePermission;
      if (
        !isCostOnlyEdit &&
        targetEmployeeType === 'app_user' &&
        !appUserHrProfileEdit &&
        !hasPermission(request, 'administration.user_management_all.view') &&
        idResult.value !== request.user?.id &&
        !(await usersRepo.canManageUser(idResult.value, request.user?.id ?? ''))
      ) {
        return replyError(request, reply, {
          statusCode: 403,
          message: 'Insufficient permissions',
          action: 'user.update.denied',
          entityType: 'user',
          entityId: idResult.value,
          details: { secondaryLabel: 'cannot_manage_user' },
        });
      }

      let roleValue: string | null = null;
      if (role !== undefined) {
        if (idResult.value === request.user?.id) {
          return replyError(request, reply, {
            statusCode: 403,
            message: 'Cannot change your own role',
            action: 'user.update.denied',
            entityType: 'user',
            entityId: idResult.value,
            details: { secondaryLabel: 'self_role_change_forbidden' },
          });
        }
        const roleResult = requireNonEmptyString(role, 'role');
        if (!roleResult.ok) return badRequest(reply, roleResult.message);
        roleValue = roleResult.value;

        const roleExists = await rolesRepo.findById(roleValue);
        if (!roleExists) {
          return badRequest(reply, 'Invalid role');
        }
        fields.role = roleValue;
      }

      if (idResult.value === request.user?.id && isDisabled === true) {
        return badRequest(reply, 'Cannot disable your own account');
      }

      if (isDisabled !== undefined) fields.isDisabled = isDisabled;

      const hasFieldUpdates = Object.keys(fields).length > 0;

      if (!hasFieldUpdates && email === undefined) {
        return badRequest(reply, 'No fields to update');
      }

      const needsSettingsUpsert = fields.name !== undefined || validatedEmail !== undefined;
      const settingsEmailPatch = email !== undefined ? (validatedEmail ?? '') : null;

      if (hasFieldUpdates || needsSettingsUpsert) {
        // Single transaction so users.name/email and the mirrored settings row commit (or
        // roll back) together. Previously the settings upsert ran after the users-update
        // transaction had already committed, so a failed upsert left users updated while
        // settings stayed stale, and findById's LEFT JOIN returned an inconsistent row.
        let txResult: { userExists: boolean };
        try {
          txResult = await withDbTransaction(async (tx) => {
            if (hasFieldUpdates) {
              const row = await usersRepo.updateUserDynamic(idResult.value, fields, tx);
              if (!row) return { userExists: false };
              if (roleValue !== null) {
                await usersRepo.replaceUserRoles(idResult.value, [roleValue], tx);
                await userAssignmentsRepo.syncTopManagerAssignmentsForUser(idResult.value, tx);
              }
            }
            if (needsSettingsUpsert) {
              await settingsRepo.upsertForUser(
                idResult.value,
                {
                  fullName: fields.name ?? null,
                  email: settingsEmailPatch,
                  language: null,
                },
                tx,
              );
            }
            return { userExists: true };
          });
        } catch (err) {
          const uniqueMessage = getUserUniqueViolationMessage(err);
          if (uniqueMessage) return badRequest(reply, uniqueMessage);
          throw err;
        }

        if (!txResult.userExists) {
          return replyError(request, reply, {
            statusCode: 404,
            message: 'User not found',
            action: 'user.update.not_found',
            entityType: 'user',
            entityId: idResult.value,
          });
        }
      }

      const changedFields = getAuditChangedFields({
        name: fields.name,
        email: email !== undefined ? (validatedEmail ?? '') : undefined,
        isDisabled: fields.isDisabled,
        // Mirror the write-side gate: `fields.costPerHour` is set only when the
        // caller had permission to apply it (self + personal/all scope, or other
        // user + all scope). Anything else was silently dropped above, so it must
        // not appear in the audit diff either.
        costPerHour: fields.costPerHour,
        role: fields.role,
        firstName: fields.firstName,
        lastName: fields.lastName,
        phone: fields.phone,
        jobTitle: fields.jobTitle,
        department: fields.department,
        employeeCode: fields.employeeCode,
        hireDate: fields.hireDate,
        terminationDate: fields.terminationDate,
        contractType: fields.contractType,
        employmentStatus: fields.employmentStatus,
        workLocation: fields.workLocation,
        emergencyContactName: fields.emergencyContactName,
        emergencyContactPhone: fields.emergencyContactPhone,
        notes: fields.notes,
      });

      let action = 'user.updated';
      if (changedFields?.length === 1) {
        if (changedFields[0] === 'isDisabled') {
          action = isDisabled ? 'user.disabled' : 'user.enabled';
        } else if (changedFields[0] === 'role') {
          action = 'user.role_changed';
        }
      }

      const fullUser = await usersRepo.findById(idResult.value);
      if (!fullUser) {
        return replyError(request, reply, {
          statusCode: 404,
          message: 'User not found',
          action: 'user.update.not_found',
          entityType: 'user',
          entityId: idResult.value,
        });
      }

      await logAudit({
        request,
        action,
        entityType: 'user',
        entityId: idResult.value,
        details: {
          targetLabel: fullUser.name || currentName,
          secondaryLabel: fullUser.username || currentUsername,
          changedFields,
          fromValue: role !== undefined ? currentRole : undefined,
          toValue: role !== undefined ? fullUser.role : undefined,
        },
      });
      return maskUserForRequest(request, fullUser);
    },
  );

  // PUT /:id/auth-method - Change an app user's enforced authentication method
  fastify.put(
    '/:id/auth-method',
    {
      onRequest: [authenticateToken, requirePermission('administration.user_management.update')],
      schema: {
        tags: ['users'],
        summary: 'Change user authentication method',
        params: idParamSchema,
        body: authMethodUpdateBodySchema,
        response: {
          200: userSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const { authMethod, authProviderId } = request.body as {
        authMethod?: unknown;
        authProviderId?: unknown;
      };

      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);

      const methodResult = validateEnum(
        authMethod,
        ['local', 'ldap', 'oidc', 'saml'] as const,
        'authMethod',
      );
      if (!methodResult.ok) return badRequest(reply, methodResult.message);

      const targetUser = await usersRepo.findCoreById(idResult.value);
      if (!targetUser) {
        return replyError(request, reply, {
          statusCode: 404,
          message: 'User not found',
          action: 'user.auth_method_update.not_found',
          entityType: 'user',
          entityId: idResult.value,
        });
      }
      if (targetUser.employeeType !== 'app_user') {
        return replyError(request, reply, {
          statusCode: 409,
          message: 'Authentication method can be changed only for app users',
          action: 'user.auth_method_update.conflict',
          entityType: 'user',
          entityId: idResult.value,
          details: { secondaryLabel: `employee_type_${targetUser.employeeType}` },
        });
      }
      if (
        !hasPermission(request, 'administration.user_management_all.view') &&
        idResult.value !== request.user?.id &&
        !(await usersRepo.canManageUser(idResult.value, request.user?.id ?? ''))
      ) {
        return replyError(request, reply, {
          statusCode: 403,
          message: 'Insufficient permissions',
          action: 'user.auth_method_update.denied',
          entityType: 'user',
          entityId: idResult.value,
          details: { secondaryLabel: 'cannot_manage_user' },
        });
      }
      if (idResult.value === request.user?.id) {
        return badRequest(reply, 'Cannot change your own authentication method');
      }

      let resolvedProviderId: string | null = null;
      if (isSsoAuthMethod(methodResult.value)) {
        const providerIdResult = requireNonEmptyString(authProviderId, 'authProviderId');
        if (!providerIdResult.ok) return badRequest(reply, providerIdResult.message);
        const provider = await ssoProvidersRepo.findById(providerIdResult.value);
        if (!provider) return badRequest(reply, 'Invalid SSO provider');
        if (!provider.enabled) return badRequest(reply, 'SSO provider must be enabled');
        if (provider.protocol !== methodResult.value) {
          return badRequest(reply, 'SSO provider protocol does not match authMethod');
        }
        resolvedProviderId = provider.id;
      } else if (authProviderId !== undefined && authProviderId !== null && authProviderId !== '') {
        return badRequest(reply, 'authProviderId is allowed only for OIDC or SAML');
      }

      // Changing auth method or provider invalidates any prior external_identities rows:
      // those rows are keyed on the IdP subject that was bound *before* the switch, and
      // would silently re-authenticate the same user if the admin ever flips back to the
      // original provider (A → B → A). Wipe them inside the same transaction as the user
      // update so the auth-method change either fully succeeds (clean slate) or rolls back
      // (no orphaned writes).
      const authStateChanged =
        targetUser.authMethod !== methodResult.value ||
        targetUser.authProviderId !== resolvedProviderId;

      const updated = await withDbTransaction(async (tx) => {
        const result = await usersRepo.updateAuthMethod(
          idResult.value,
          methodResult.value,
          resolvedProviderId,
          tx,
        );
        if (!result) return null;
        if (authStateChanged) {
          await externalIdentitiesRepo.deleteAllForUser(idResult.value, tx);
        }
        return result;
      });
      if (!updated) {
        return replyError(request, reply, {
          statusCode: 404,
          message: 'User not found',
          action: 'user.auth_method_update.not_found',
          entityType: 'user',
          entityId: idResult.value,
        });
      }

      // Role mapping at bind time only writes when LDAP groups actually map to an
      // existing role. If no group matches (or the LDAP lookup is unavailable), the
      // user's admin-assigned roles are preserved — the bind action does not silently
      // demote them to DEFAULT_ROLE_ID.
      let mappedRoleIds: string[] | null = null;
      if (methodResult.value === 'ldap') {
        const ldapService = (await import('../services/ldap.ts')).default;
        const lookup = await ldapService.lookupUserGroups(updated.username);
        if (lookup) {
          const applied = await applyExternalRolesForUserIfMatched(
            updated.id,
            lookup.groups,
            lookup.roleMappings,
          );
          if (applied.applied) {
            mappedRoleIds = applied.roleIds;
            updated.role = applied.roleIds[0];
          } else if (await externalGroupsYieldNoKnownRole(lookup.groups, lookup.roleMappings)) {
            // Symmetric with the LDAP login and sync diagnostics: log when the bind
            // lookup ran successfully but yielded no known role mapping, so an admin
            // debugging "why did my LDAP group not assign the role at bind" has a
            // breadcrumb. The helper short-circuits when no role mappings are configured
            // at all, so an admin who deliberately doesn't use mappings doesn't get
            // spurious warnings on every bind.
            fastify.log.warn(
              {
                userId: updated.id,
                username: updated.username,
                groups: lookup.groups,
                currentRole: updated.role,
              },
              'LDAP bind: LDAP groups did not resolve to any known role mapping — preserving existing role',
            );
          }
        } else {
          fastify.log.warn(
            { userId: updated.id, username: updated.username },
            'LDAP role mapping skipped: directory lookup unavailable or user not found',
          );
        }
      }

      await logAudit({
        request,
        action: 'user.auth_method_changed',
        entityType: 'user',
        entityId: idResult.value,
        details: {
          targetLabel: updated.name,
          secondaryLabel: updated.username,
          fromValue: targetUser.authMethod,
          toValue: methodResult.value,
          ...(mappedRoleIds ? { roleIds: mappedRoleIds } : {}),
        },
      });

      return maskUserForRequest(request, updated);
    },
  );

  // GET /:id/roles - Get assigned roles for a user
  fastify.get(
    '/:id/roles',
    {
      onRequest: [authenticateToken, requirePermission('administration.user_management.update')],
      schema: {
        tags: ['users'],
        summary: 'Get user roles',
        params: idParamSchema,
        response: {
          200: userRolesSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);

      const [user, assignedRoleIds] = await Promise.all([
        usersRepo.findCoreById(idResult.value),
        usersRepo.getUserRoleIds(idResult.value),
      ]);
      if (!user) {
        return replyError(request, reply, {
          statusCode: 404,
          message: 'User not found',
          action: 'user.roles_view.not_found',
          entityType: 'user',
          entityId: idResult.value,
        });
      }

      const primaryRoleId = user.role;
      const roleIds = Array.from(
        new Set(assignedRoleIds.concat(primaryRoleId ? [primaryRoleId] : [])),
      );

      return { roleIds, primaryRoleId };
    },
  );

  // PUT /:id/roles - Replace assigned roles + set primary role
  fastify.put(
    '/:id/roles',
    {
      onRequest: [authenticateToken, requirePermission('administration.user_management.update')],
      schema: {
        tags: ['users'],
        summary: 'Update user roles',
        params: idParamSchema,
        body: userRolesUpdateBodySchema,
        response: {
          200: userRolesSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);

      if (idResult.value === request.user?.id) {
        return replyError(request, reply, {
          statusCode: 403,
          message: 'Cannot change your own role',
          action: 'user.roles_update.denied',
          entityType: 'user',
          entityId: idResult.value,
          details: { secondaryLabel: 'self_role_change_forbidden' },
        });
      }

      const { roleIds, primaryRoleId } = request.body as {
        roleIds?: unknown;
        primaryRoleId?: unknown;
      };

      const roleIdsResult = ensureArrayOfStrings(roleIds, 'roleIds');
      if (!roleIdsResult.ok) return badRequest(reply, roleIdsResult.message);
      if (roleIdsResult.value.length < 1) return badRequest(reply, 'roleIds must not be empty');

      const primaryRoleIdResult = requireNonEmptyString(primaryRoleId, 'primaryRoleId');
      if (!primaryRoleIdResult.ok) return badRequest(reply, primaryRoleIdResult.message);

      if (!roleIdsResult.value.includes(primaryRoleIdResult.value)) {
        return badRequest(reply, 'primaryRoleId must be included in roleIds');
      }

      const user = await usersRepo.findCoreById(idResult.value);
      if (!user) {
        return replyError(request, reply, {
          statusCode: 404,
          message: 'User not found',
          action: 'user.roles_update.not_found',
          entityType: 'user',
          entityId: idResult.value,
        });
      }

      const found = await rolesRepo.findExistingIds(roleIdsResult.value);
      const missing = roleIdsResult.value.filter((rid) => !found.has(rid));
      if (missing.length > 0) return badRequest(reply, `Invalid role(s): ${missing.join(', ')}`);

      await withDbTransaction(async (tx) => {
        await usersRepo.replaceUserRoles(idResult.value, roleIdsResult.value, tx);
        await usersRepo.setPrimaryRole(idResult.value, primaryRoleIdResult.value, tx);
        // Sync runs inside the transaction so the role updates and the resulting
        // top-manager auto-assignments commit (or roll back) together.
        await userAssignmentsRepo.syncTopManagerAssignmentsForUser(idResult.value, tx);
      });
      await logAudit({
        request,
        action: 'user.roles_updated',
        entityType: 'user',
        entityId: idResult.value,
        details: {
          targetLabel: user.name,
          secondaryLabel: user.username,
          counts: getAuditCounts({ roles: roleIdsResult.value.length }),
          toValue: primaryRoleIdResult.value,
        },
      });
      return { roleIds: roleIdsResult.value, primaryRoleId: primaryRoleIdResult.value };
    },
  );

  // GET /:id/assignments - Get user assignments
  fastify.get(
    '/:id/assignments',
    {
      onRequest: [authenticateToken],
      schema: {
        tags: ['users'],
        summary: 'Get user assignments',
        params: idParamSchema,
        response: {
          200: assignmentsSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);

      if (!(await canViewTargetUserAssignments(request, idResult.value))) {
        return replyError(request, reply, {
          statusCode: 403,
          message: 'Insufficient permissions',
          action: 'user.assignments_view.denied',
          entityType: 'user',
          entityId: idResult.value,
          details: { secondaryLabel: 'cannot_view_assignments' },
        });
      }

      return await usersRepo.getAssignments(idResult.value);
    },
  );

  fastify.get(
    '/:id/tracker-catalogs',
    {
      onRequest: [authenticateToken],
      schema: {
        tags: ['users'],
        summary: 'Get tracker catalogs for user',
        params: idParamSchema,
        response: {
          200: trackerCatalogsSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);

      if (!(await canViewTargetUserAssignments(request, idResult.value))) {
        return replyError(request, reply, {
          statusCode: 403,
          message: 'Insufficient permissions',
          action: 'user.tracker_catalogs_view.denied',
          entityType: 'user',
          entityId: idResult.value,
          details: { secondaryLabel: 'cannot_view_assignments' },
        });
      }

      const [assignedClients, assignedProjects, projectTasks] = await Promise.all([
        clientsRepo.list({ canViewAllClients: false, userId: idResult.value }),
        projectsRepo.listForUser(idResult.value),
        tasksRepo.listForUser(idResult.value),
      ]);
      const assignedProjectIds = new Set(assignedProjects.map((project) => project.id));
      const taskParentProjectIds = uniqueMissingIds(
        projectTasks.map((task) => task.projectId),
        assignedProjectIds,
      );
      const taskParentProjects = await projectsRepo.listByIds(taskParentProjectIds);
      const projects = mergeById(assignedProjects, taskParentProjects.values());

      const assignedClientIds = new Set(assignedClients.map((client) => client.id));
      const parentClientIds = uniqueMissingIds(
        projects.map((project) => project.clientId),
        assignedClientIds,
      );
      const parentClients = await clientsRepo.listByIds(parentClientIds);
      const clients = mergeById(assignedClients, parentClients.values());

      return {
        clients: clients.map((client) => ({
          id: client.id,
          name: client.name,
          isDisabled: client.isDisabled,
        })),
        projects: projects.map((project) => ({
          id: project.id,
          name: project.name,
          clientId: project.clientId,
          isDisabled: project.isDisabled,
          billingType: project.billingType,
          billingFrequency: project.billingFrequency,
        })),
        projectTasks: projectTasks.map((task) => ({
          id: task.id,
          name: task.name,
          projectId: task.projectId,
          isDisabled: task.isDisabled,
        })),
      };
    },
  );

  // POST /:id/assignments - Update user assignments
  fastify.post(
    '/:id/assignments',
    {
      onRequest: [authenticateToken, requirePermission('hr.employee_assignments.update')],
      schema: {
        tags: ['users'],
        summary: 'Update user assignments',
        params: idParamSchema,
        body: assignmentsUpdateBodySchema,
        response: {
          200: messageResponseSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const { clientIds, projectIds, taskIds } = request.body as {
        clientIds?: string[];
        projectIds?: string[];
        taskIds?: string[];
      };
      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);

      if (!canViewAllUsers(request) && idResult.value !== request.user?.id) {
        if (!(await usersRepo.canManageUser(idResult.value, request.user?.id ?? ''))) {
          return replyError(request, reply, {
            statusCode: 403,
            message: 'Insufficient permissions',
            action: 'user.assignments_update.denied',
            entityType: 'user',
            entityId: idResult.value,
            details: { secondaryLabel: 'cannot_manage_user' },
          });
        }
      }

      const clientIdsResult = optionalArrayOfStrings(clientIds, 'clientIds');
      if (!clientIdsResult.ok) return badRequest(reply, clientIdsResult.message);
      const resolvedClientIds = clientIdsResult.value;

      const projectIdsResult = optionalArrayOfStrings(projectIds, 'projectIds');
      if (!projectIdsResult.ok) return badRequest(reply, projectIdsResult.message);
      const resolvedProjectIds = projectIdsResult.value;

      const taskIdsResult = optionalArrayOfStrings(taskIds, 'taskIds');
      if (!taskIdsResult.ok) return badRequest(reply, taskIdsResult.message);
      const resolvedTaskIds = taskIdsResult.value;

      const assignmentsInScope = await ensureSubmittedAssignmentsInScope(request, {
        clientIds: resolvedClientIds ?? undefined,
        projectIds: resolvedProjectIds ?? undefined,
        taskIds: resolvedTaskIds ?? undefined,
      });
      if (!assignmentsInScope) {
        return replyError(request, reply, {
          statusCode: 403,
          message: 'Insufficient permissions',
          action: 'user.assignments_update.denied',
          entityType: 'user',
          entityId: idResult.value,
          details: { secondaryLabel: 'assignments_out_of_scope' },
        });
      }

      const [targetUser, isTopManager] = await Promise.all([
        usersRepo.findCoreById(idResult.value),
        userAssignmentsRepo.userHasTopManagerRole(idResult.value),
      ]);
      if (!targetUser) {
        return replyError(request, reply, {
          statusCode: 404,
          message: 'User not found',
          action: 'user.assignments_update.not_found',
          entityType: 'user',
          entityId: idResult.value,
        });
      }

      if (isTopManager) {
        return replyError(request, reply, {
          statusCode: 409,
          message:
            'Top Manager assignments are managed automatically and cannot be edited manually',
          action: 'user.assignments_update.conflict',
          entityType: 'user',
          entityId: idResult.value,
          details: { secondaryLabel: 'top_manager_immutable_assignments' },
        });
      }

      await withDbTransaction(async (tx) => {
        if (clientIds) {
          await userAssignmentsRepo.replaceUserClients(
            idResult.value,
            resolvedClientIds ?? [],
            userAssignmentsRepo.MANUAL_ASSIGNMENT_SOURCE,
            tx,
          );
        }

        if (projectIds) {
          await userAssignmentsRepo.replaceUserProjects(
            idResult.value,
            resolvedProjectIds ?? [],
            userAssignmentsRepo.MANUAL_ASSIGNMENT_SOURCE,
            tx,
          );
        }

        if (taskIds) {
          await userAssignmentsRepo.replaceUserTasks(
            idResult.value,
            resolvedTaskIds ?? [],
            userAssignmentsRepo.MANUAL_ASSIGNMENT_SOURCE,
            tx,
          );
        }

        if (projectIds || clientIds) {
          await userAssignmentsRepo.clearProjectCascadeAssignments(idResult.value, tx);
        }

        await userAssignmentsRepo.applyProjectCascadeToClients(idResult.value, tx);
      });

      await logAudit({
        request,
        action: 'user.assignments_updated',
        entityType: 'user',
        entityId: idResult.value,
        details: {
          targetLabel: targetUser.name,
          secondaryLabel: targetUser.username,
          counts: getAuditCounts({
            clients: clientIds ? (resolvedClientIds?.length ?? 0) : undefined,
            projects: projectIds ? (resolvedProjectIds?.length ?? 0) : undefined,
            tasks: taskIds ? (resolvedTaskIds?.length ?? 0) : undefined,
          }),
        },
      });
      return { message: 'Assignments updated' };
    },
  );
}
