import type { Workbook } from 'exceljs';
import type { BulkSupplierCreateInput } from '../types';
import {
  type ImportFieldDefinition,
  type ImportWorkbookDefinition,
  type ImportWorkbookParseResult,
  parseImportWorkbook,
} from './entityImportWorkbook';

export const SUPPLIER_IMPORT_FIELDS = [
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
] as const satisfies readonly (keyof BulkSupplierCreateInput)[];

export const REQUIRED_SUPPLIER_IMPORT_FIELDS = ['supplierCode', 'name', 'vatNumber'] as const;
export const SUPPLIER_IMPORT_FILENAME = 'praetor-suppliers-import.xlsx';

type SupplierImportField = (typeof SUPPLIER_IMPORT_FIELDS)[number];
type Translate = (key: string, options?: Record<string, unknown>) => string;

export const buildSupplierImportDefinition = (
  t: Translate,
): ImportWorkbookDefinition<SupplierImportField> => {
  const freeText = t('crm:suppliers.bulk.excel.freeText');
  const fields: ImportFieldDefinition<SupplierImportField>[] = [
    {
      key: 'supplierCode',
      label: t('crm:suppliers.code'),
      required: true,
      accepted: t('crm:suppliers.bulk.excel.alphaNumeric'),
      example: 'FOR-001',
      width: 18,
      maxLength: 50,
    },
    {
      key: 'name',
      label: t('crm:suppliers.name'),
      required: true,
      accepted: freeText,
      example: 'Acme Forniture S.p.A.',
      width: 30,
      maxLength: 255,
    },
    {
      key: 'contactName',
      label: t('crm:suppliers.fullName'),
      required: false,
      accepted: freeText,
      example: 'Mario Rossi',
      width: 24,
      maxLength: 255,
    },
    {
      key: 'contactRole',
      label: t('crm:suppliers.role'),
      required: false,
      accepted: freeText,
      example: 'Commerciale',
      width: 20,
      maxLength: 255,
    },
    {
      key: 'email',
      label: t('crm:suppliers.email'),
      required: false,
      accepted: t('crm:suppliers.bulk.excel.validEmail'),
      example: 'mario@example.com',
      width: 28,
      maxLength: 255,
    },
    {
      key: 'phone',
      label: t('crm:suppliers.phone'),
      required: false,
      accepted: freeText,
      example: '+39 000 0000000',
      width: 20,
      maxLength: 50,
    },
    {
      key: 'address',
      label: t('crm:suppliers.address'),
      required: false,
      accepted: freeText,
      example: 'Via Esempio 15, Milano',
      width: 34,
    },
    {
      key: 'vatNumber',
      label: t('crm:suppliers.vatNumber'),
      required: true,
      accepted: freeText,
      example: 'IT12345678901',
      width: 22,
      maxLength: 50,
    },
    {
      key: 'taxCode',
      label: t('crm:suppliers.taxCode'),
      required: false,
      accepted: freeText,
      example: 'RSSMRA80A01H501U',
      width: 22,
      maxLength: 50,
    },
    {
      key: 'paymentTerms',
      label: t('crm:suppliers.paymentTerms'),
      required: false,
      accepted: freeText,
      example: '30 giorni data fattura',
      width: 28,
    },
    {
      key: 'notes',
      label: t('crm:suppliers.notes'),
      required: false,
      accepted: freeText,
      example: 'Fornitore preferenziale',
      width: 36,
    },
  ];

  return {
    entity: 'suppliers',
    title: t('crm:suppliers.bulk.excel.workbookTitle'),
    instructions: t('crm:suppliers.bulk.excel.workbookInstructions'),
    exampleNotice: t('crm:suppliers.bulk.excel.workbookExampleNotice'),
    fieldComment: (field) =>
      t('crm:suppliers.bulk.excel.workbookFieldComment', {
        field: field.label,
        required: field.required ? t('common:boolean.yes') : t('common:boolean.no'),
        accepted: field.accepted,
        example: field.example || '—',
      }),
    invalidValueTitle: t('crm:suppliers.bulk.excel.invalidValueTitle'),
    invalidValueMessage: t('crm:suppliers.bulk.excel.invalidValueMessage'),
    fields,
  };
};

export const parseSupplierImportWorkbook = (
  workbook: Workbook,
): ImportWorkbookParseResult<BulkSupplierCreateInput> =>
  parseImportWorkbook(
    workbook,
    'suppliers',
    SUPPLIER_IMPORT_FIELDS,
  ) as ImportWorkbookParseResult<BulkSupplierCreateInput>;
