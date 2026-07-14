import * as suppliersRepo from '../repositories/suppliersRepo.ts';
import { generatePrefixedId } from '../utils/order-ids.ts';
import {
  optionalEmail,
  optionalNonEmptyString,
  requireNonEmptyString,
  validateClientIdentifier,
} from '../utils/validation.ts';

export const BULK_SUPPLIER_FIELDS = [
  'supplierCode',
  'name',
  'contactName',
  'contactRole',
  'email',
  'phone',
  'address',
  'vatNumber',
  'taxCode',
  'paymentTerms',
  'notes',
] as const;

export type BulkSupplierField = (typeof BULK_SUPPLIER_FIELDS)[number];
export type SupplierCreateErrorCode =
  | 'required'
  | 'invalid'
  | 'too_long'
  | 'duplicate'
  | 'creation_failed';

export type SupplierCreateValidationError = {
  field?: BulkSupplierField;
  code: SupplierCreateErrorCode;
  message: string;
};

export type NormalizedSupplierCreate = Omit<suppliersRepo.NewSupplier, 'id' | 'createdAt'>;

const MAX_LENGTHS: Partial<Record<BulkSupplierField, number>> = {
  supplierCode: 50,
  name: 255,
  contactName: 255,
  contactRole: 255,
  email: 255,
  phone: 50,
  vatNumber: 50,
  taxCode: 50,
};

const codeForMessage = (message: string): SupplierCreateErrorCode =>
  message.includes('required') || message.includes('non-empty string') ? 'required' : 'invalid';

export const getSupplierCodeCandidate = (input: Record<string, unknown>): string | null => {
  if (typeof input.supplierCode !== 'string') return null;
  const value = input.supplierCode.trim();
  return value ? value.toLowerCase() : null;
};

export const validateBulkSupplierCreateInput = (
  input: Record<string, unknown>,
):
  | { ok: true; value: NormalizedSupplierCreate }
  | { ok: false; errors: SupplierCreateValidationError[] } => {
  const errors: SupplierCreateValidationError[] = [];
  const push = (error: SupplierCreateValidationError) => errors.push(error);

  const supplierCode = validateClientIdentifier(input.supplierCode, 'supplierCode');
  if (!supplierCode.ok) {
    push({
      field: 'supplierCode',
      code: codeForMessage(supplierCode.message),
      message: supplierCode.message,
    });
  }

  const name = requireNonEmptyString(input.name, 'name');
  if (!name.ok) push({ field: 'name', code: 'required', message: name.message });

  const vatNumber = requireNonEmptyString(input.vatNumber, 'vatNumber');
  if (!vatNumber.ok) {
    push({ field: 'vatNumber', code: 'required', message: vatNumber.message });
  }

  const optionalString = (field: BulkSupplierField) => {
    const result = optionalNonEmptyString(input[field], field);
    if (!result.ok) {
      push({ field, code: 'invalid', message: result.message });
      return null;
    }
    return result.value;
  };

  const contactName = optionalString('contactName');
  const contactRole = optionalString('contactRole');
  const phone = optionalString('phone');
  const address = optionalString('address');
  const taxCode = optionalString('taxCode');
  const paymentTerms = optionalString('paymentTerms');
  const notes = optionalString('notes');
  const email = optionalEmail(input.email, 'email');
  if (!email.ok) push({ field: 'email', code: 'invalid', message: email.message });

  if ((contactRole || phone || (email.ok && email.value)) && !contactName) {
    push({
      field: 'contactName',
      code: 'required',
      message: 'contactName is required when contact details are provided',
    });
  }

  const lengthValues: Partial<Record<BulkSupplierField, string | null>> = {
    supplierCode: supplierCode.ok ? supplierCode.value : null,
    name: name.ok ? name.value : null,
    contactName,
    contactRole,
    email: email.ok ? email.value : null,
    phone,
    vatNumber: vatNumber.ok ? vatNumber.value : null,
    taxCode,
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

  if (errors.length > 0 || !supplierCode.ok || !name.ok || !vatNumber.ok) {
    return { ok: false, errors };
  }

  const contact = contactName
    ? {
        fullName: contactName,
        role: contactRole ?? undefined,
        email: email.ok ? (email.value ?? undefined) : undefined,
        phone: phone ?? undefined,
      }
    : null;

  return {
    ok: true,
    value: {
      name: name.value,
      supplierCode: supplierCode.value,
      contacts: contact ? [contact] : [],
      contactName,
      email: email.ok ? email.value : null,
      phone,
      address,
      vatNumber: vatNumber.value,
      taxCode,
      paymentTerms,
      notes,
    },
  };
};

export const createSupplier = async (input: NormalizedSupplierCreate) => {
  const id = generatePrefixedId('s');
  const supplier = await suppliersRepo.create({
    ...input,
    id,
    createdAt: Date.now(),
  });
  return { id, supplier };
};
