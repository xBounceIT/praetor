import { withDbTransaction } from '../db/drizzle.ts';
import * as clientsRepo from '../repositories/clientsRepo.ts';
import * as userAssignmentsRepo from '../repositories/userAssignmentsRepo.ts';
import { formatClientAddress } from '../utils/client-address.ts';
import { generatePrefixedId } from '../utils/order-ids.ts';
import {
  optionalEmail,
  optionalNonEmptyString,
  requireNonEmptyString,
  validateClientIdentifier,
} from '../utils/validation.ts';

export const BULK_CLIENT_FIELDS = [
  'clientCode',
  'name',
  'type',
  'fiscalCode',
  'contactName',
  'contactRole',
  'email',
  'phone',
  'website',
  'addressCountry',
  'addressState',
  'addressCap',
  'addressProvince',
  'addressCivicNumber',
  'addressLine',
  'atecoCode',
  'sector',
  'numberOfEmployees',
  'revenue',
  'officeCountRange',
  'description',
] as const;

export type BulkClientField = (typeof BULK_CLIENT_FIELDS)[number];
export type ClientCreateErrorCode =
  | 'required'
  | 'invalid'
  | 'too_long'
  | 'duplicate'
  | 'unknown_option'
  | 'creation_failed';

export type ClientCreateValidationError = {
  field?: BulkClientField | 'contacts' | 'vatNumber' | 'taxCode' | 'address';
  code: ClientCreateErrorCode;
  message: string;
};

type ClientContactInput = {
  fullName: unknown;
  role?: unknown;
  email?: unknown;
  phone?: unknown;
};

type ProfileField = 'sector' | 'numberOfEmployees' | 'revenue' | 'officeCountRange';

export type ClientProfileOptionMaps = Record<ProfileField, ReadonlyMap<string, string>>;

export type NormalizedClientCreate = clientsRepo.NewClient;

const MAX_LENGTHS: Partial<Record<BulkClientField | 'vatNumber' | 'taxCode', number>> = {
  clientCode: 50,
  name: 255,
  type: 20,
  fiscalCode: 50,
  contactName: 255,
  contactRole: 255,
  email: 255,
  phone: 50,
  website: 255,
  addressCountry: 100,
  addressState: 100,
  addressCap: 20,
  addressProvince: 100,
  addressCivicNumber: 30,
  atecoCode: 50,
  sector: 120,
  numberOfEmployees: 120,
  revenue: 120,
  officeCountRange: 120,
  vatNumber: 50,
  taxCode: 50,
};

const resolveFiscalCode = ({
  vatNumber,
  fiscalCode,
  taxCode,
}: {
  vatNumber: string | null;
  fiscalCode: string | null;
  taxCode: string | null;
}) => vatNumber || fiscalCode || taxCode || null;

const parseContacts = (
  value: unknown,
): { value: clientsRepo.ClientContact[]; error?: ClientCreateValidationError } => {
  if (value === undefined || value === null) return { value: [] };
  if (!Array.isArray(value)) {
    return {
      value: [],
      error: { field: 'contacts', code: 'invalid', message: 'contacts must be an array' },
    };
  }

  const contacts: clientsRepo.ClientContact[] = [];
  for (let index = 0; index < value.length; index++) {
    const raw = value[index];
    if (!raw || typeof raw !== 'object') {
      return {
        value: [],
        error: {
          field: 'contacts',
          code: 'invalid',
          message: `contacts[${index}] must be an object`,
        },
      };
    }

    const contact = raw as ClientContactInput;
    const fullName = requireNonEmptyString(contact.fullName, `contacts[${index}].fullName`);
    if (!fullName.ok) {
      return {
        value: [],
        error: { field: 'contacts', code: 'required', message: fullName.message },
      };
    }
    const role = optionalNonEmptyString(contact.role, `contacts[${index}].role`);
    if (!role.ok) {
      return {
        value: [],
        error: { field: 'contacts', code: 'invalid', message: role.message },
      };
    }
    const email = optionalEmail(contact.email, `contacts[${index}].email`);
    if (!email.ok) {
      return {
        value: [],
        error: { field: 'contacts', code: 'invalid', message: email.message },
      };
    }
    const phone = optionalNonEmptyString(contact.phone, `contacts[${index}].phone`);
    if (!phone.ok) {
      return {
        value: [],
        error: { field: 'contacts', code: 'invalid', message: phone.message },
      };
    }

    contacts.push({
      fullName: fullName.value,
      role: role.value ?? undefined,
      email: email.value ?? undefined,
      phone: phone.value ?? undefined,
    });
  }
  return { value: contacts };
};

const codeForMessage = (message: string): ClientCreateErrorCode =>
  message.includes('required') || message.includes('non-empty string') ? 'required' : 'invalid';

export const validateClientCreateInput = (
  input: Record<string, unknown>,
  options: {
    profileOptions?: ClientProfileOptionMaps;
    requireContactNameForTopLevelContactDetails?: boolean;
  } = {},
):
  | { ok: true; value: NormalizedClientCreate }
  | { ok: false; errors: ClientCreateValidationError[] } => {
  const errors: ClientCreateValidationError[] = [];
  const push = (error: ClientCreateValidationError) => errors.push(error);

  const name = requireNonEmptyString(input.name, 'name');
  if (!name.ok) push({ field: 'name', code: 'required', message: name.message });

  const contactsResult = parseContacts(input.contacts);
  if (contactsResult.error) push(contactsResult.error);
  for (const [index, contact] of contactsResult.value.entries()) {
    const values = [
      ['fullName', contact.fullName, 255],
      ['role', contact.role, 255],
      ['email', contact.email, 255],
      ['phone', contact.phone, 50],
    ] as const;
    for (const [field, value, maxLength] of values) {
      if (value && value.length > maxLength) {
        push({
          field: 'contacts',
          code: 'too_long',
          message: `contacts[${index}].${field} must be at most ${maxLength} characters`,
        });
      }
    }
  }

  const clientCode = validateClientIdentifier(input.clientCode, 'clientCode');
  if (!clientCode.ok) {
    push({
      field: 'clientCode',
      code: codeForMessage(clientCode.message),
      message: clientCode.message,
    });
  }

  const fiscalCode = optionalNonEmptyString(input.fiscalCode, 'fiscalCode');
  if (!fiscalCode.ok) {
    push({ field: 'fiscalCode', code: 'invalid', message: fiscalCode.message });
  }
  const vatNumber = optionalNonEmptyString(input.vatNumber, 'vatNumber');
  if (!vatNumber.ok) push({ field: 'vatNumber', code: 'invalid', message: vatNumber.message });
  const taxCode = optionalNonEmptyString(input.taxCode, 'taxCode');
  if (!taxCode.ok) push({ field: 'taxCode', code: 'invalid', message: taxCode.message });
  const resolvedFiscalCode = resolveFiscalCode({
    fiscalCode: fiscalCode.ok ? fiscalCode.value : null,
    vatNumber: vatNumber.ok ? vatNumber.value : null,
    taxCode: taxCode.ok ? taxCode.value : null,
  });
  if (!resolvedFiscalCode) {
    push({ field: 'fiscalCode', code: 'required', message: 'Fiscal code is required' });
  }

  const rawType = typeof input.type === 'string' ? input.type.trim().toLowerCase() : '';
  const type = rawType || 'company';
  if (type !== 'company' && type !== 'individual') {
    push({
      field: 'type',
      code: 'invalid',
      message: 'type must be either company or individual',
    });
  }

  const optionalString = <F extends BulkClientField | 'address'>(field: F) => {
    const result = optionalNonEmptyString(input[field], field);
    if (!result.ok) {
      push({ field, code: 'invalid', message: result.message });
      return null;
    }
    return result.value;
  };

  const address = optionalString('address');
  const addressCountry = optionalString('addressCountry');
  const addressState = optionalString('addressState');
  const addressCap = optionalString('addressCap');
  const addressProvince = optionalString('addressProvince');
  const addressCivicNumber = optionalString('addressCivicNumber');
  const addressLine = optionalString('addressLine');
  const description = optionalString('description');
  const atecoCode = optionalString('atecoCode');
  const website = optionalString('website');
  let sector = optionalString('sector');
  let numberOfEmployees = optionalString('numberOfEmployees');
  let revenue = optionalString('revenue');
  let officeCountRange = optionalString('officeCountRange');
  const contactName = optionalString('contactName');
  const contactRole = optionalString('contactRole');
  const phone = optionalString('phone');

  const email = optionalEmail(input.email, 'email');
  if (!email.ok) push({ field: 'email', code: 'invalid', message: email.message });

  const profileValues: Record<ProfileField, string | null> = {
    sector,
    numberOfEmployees,
    revenue,
    officeCountRange,
  };
  if (options.profileOptions) {
    for (const field of Object.keys(profileValues) as ProfileField[]) {
      const value = profileValues[field];
      if (!value) continue;
      const canonical = options.profileOptions[field].get(value.toLowerCase());
      if (!canonical) {
        push({
          field,
          code: 'unknown_option',
          message: `${field} must match an existing client profile option`,
        });
      } else {
        profileValues[field] = canonical;
      }
    }
    sector = profileValues.sector;
    numberOfEmployees = profileValues.numberOfEmployees;
    revenue = profileValues.revenue;
    officeCountRange = profileValues.officeCountRange;
  }

  const primaryContact = contactsResult.value[0] ?? null;
  const effectiveContactName = contactName ?? primaryContact?.fullName ?? null;
  const effectiveEmail = email.ok ? (email.value ?? primaryContact?.email ?? null) : null;
  const effectivePhone = phone ?? primaryContact?.phone ?? null;
  const requiresContactName = Boolean(
    contactRole ||
      (options.requireContactNameForTopLevelContactDetails && (effectiveEmail || effectivePhone)),
  );
  if (requiresContactName && !effectiveContactName) {
    push({
      field: 'contactName',
      code: 'required',
      message: 'contactName is required when contact details are provided',
    });
  }

  let contacts = contactsResult.value;
  if (contacts.length === 0 && effectiveContactName) {
    contacts = [
      {
        fullName: effectiveContactName,
        role: contactRole ?? undefined,
        email: effectiveEmail ?? undefined,
        phone: effectivePhone ?? undefined,
      },
    ];
  }

  const lengthValues: Partial<Record<BulkClientField | 'vatNumber' | 'taxCode', string | null>> = {
    clientCode: clientCode.ok ? clientCode.value : null,
    name: name.ok ? name.value : null,
    type,
    fiscalCode: resolvedFiscalCode,
    contactName: effectiveContactName,
    contactRole,
    email: effectiveEmail,
    phone: effectivePhone,
    website,
    addressCountry,
    addressState,
    addressCap,
    addressProvince,
    addressCivicNumber,
    atecoCode,
    sector,
    numberOfEmployees,
    revenue,
    officeCountRange,
    vatNumber: vatNumber.ok ? vatNumber.value : null,
    taxCode: taxCode.ok ? taxCode.value : null,
  };
  for (const [field, maxLength] of Object.entries(MAX_LENGTHS) as Array<
    [keyof typeof MAX_LENGTHS, number]
  >) {
    const value = lengthValues[field];
    if (value && value.length > maxLength) {
      push({
        field,
        code: 'too_long',
        message: `${field} must be at most ${maxLength} characters`,
      });
    }
  }

  if (errors.length > 0 || !name.ok || !clientCode.ok || !resolvedFiscalCode) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      id: '',
      name: name.value,
      type,
      contacts,
      contactName: effectiveContactName,
      clientCode: clientCode.value,
      email: effectiveEmail,
      phone: effectivePhone,
      address:
        address ||
        formatClientAddress({
          line: addressLine,
          civicNumber: addressCivicNumber,
          cap: addressCap,
          state: addressState,
          province: addressProvince,
          country: addressCountry,
        }) ||
        null,
      addressCountry,
      addressState,
      addressCap,
      addressProvince,
      addressCivicNumber,
      addressLine,
      description,
      atecoCode,
      website,
      sector,
      numberOfEmployees,
      revenue,
      fiscalCode: resolvedFiscalCode,
      vatNumber: vatNumber.ok ? vatNumber.value : null,
      taxCode: taxCode.ok ? taxCode.value : null,
      officeCountRange,
    },
  };
};

const trimmedString = (value: unknown) =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;

export const getClientIdentifierCandidates = (input: Record<string, unknown>) => {
  const clientCode = trimmedString(input.clientCode);
  const fiscalCode = resolveFiscalCode({
    vatNumber: trimmedString(input.vatNumber),
    fiscalCode: trimmedString(input.fiscalCode),
    taxCode: trimmedString(input.taxCode),
  });
  return {
    clientCode,
    fiscalCode: fiscalCode?.toLowerCase() ?? null,
  };
};

export const createClientWithAssignments = async (
  input: NormalizedClientCreate,
  actorUserId: string | undefined,
) => {
  const id = generatePrefixedId('c');
  const client = await withDbTransaction(async (tx) => {
    const created = await clientsRepo.create({ ...input, id }, tx);
    if (actorUserId) {
      await userAssignmentsRepo.assignClientToUser(actorUserId, id, undefined, tx);
    }
    await userAssignmentsRepo.assignClientToTopManagers(id, tx);
    return created;
  });
  return { id, client };
};
