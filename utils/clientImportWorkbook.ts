import type { Workbook } from 'exceljs';
import type { BulkClientCreateInput, ClientProfileOptionsByCategory } from '../types';
import {
  type ImportFieldDefinition,
  type ImportWorkbookDefinition,
  type ImportWorkbookParseResult,
  parseImportWorkbook,
} from './entityImportWorkbook';

export const CLIENT_IMPORT_FIELDS = [
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
] as const satisfies readonly (keyof BulkClientCreateInput)[];

export const REQUIRED_CLIENT_IMPORT_FIELDS = ['clientCode', 'name', 'fiscalCode'] as const;
export const CLIENT_IMPORT_FILENAME = 'praetor-clients-import.xlsx';

type ClientImportField = (typeof CLIENT_IMPORT_FIELDS)[number];
type Translate = (key: string, options?: Record<string, unknown>) => string;

export const buildClientImportDefinition = (
  profileOptions: ClientProfileOptionsByCategory,
  t: Translate,
): ImportWorkbookDefinition<ClientImportField> => {
  const profileField = (
    key: keyof ClientProfileOptionsByCategory,
    label: string,
  ): ImportFieldDefinition<ClientImportField> => ({
    key,
    label,
    required: false,
    accepted: profileOptions[key].map((option) => option.value).join(' | ') || '—',
    example: profileOptions[key][0]?.value ?? '',
    width: 24,
    maxLength: 120,
    options: profileOptions[key].map((option) => ({
      display: option.value,
      value: option.value,
    })),
  });

  const freeText = t('crm:clients.bulk.excel.freeText');
  const fields: ImportFieldDefinition<ClientImportField>[] = [
    {
      key: 'clientCode',
      label: t('crm:clients.clientCode'),
      required: true,
      accepted: t('crm:clients.bulk.excel.alphaNumeric'),
      example: 'CLI-001',
      width: 18,
      maxLength: 50,
    },
    {
      key: 'name',
      label: t('crm:clients.name'),
      required: true,
      accepted: freeText,
      example: 'Acme S.p.A.',
      width: 28,
      maxLength: 255,
    },
    {
      key: 'type',
      label: t('crm:clients.clientType'),
      required: false,
      accepted: `${t('crm:clients.typeCompany')} | ${t('crm:clients.typeIndividual')}`,
      example: t('crm:clients.typeCompany'),
      width: 18,
      maxLength: 20,
      options: [
        { display: t('crm:clients.typeCompany'), value: 'company' },
        { display: t('crm:clients.typeIndividual'), value: 'individual' },
      ],
    },
    {
      key: 'fiscalCode',
      label: t('crm:clients.fiscalCode'),
      required: true,
      accepted: freeText,
      example: 'IT12345678901',
      width: 22,
      maxLength: 50,
    },
    {
      key: 'contactName',
      label: t('crm:clients.fullName'),
      required: false,
      accepted: freeText,
      example: 'Mario Rossi',
      width: 24,
      maxLength: 255,
    },
    {
      key: 'contactRole',
      label: t('crm:clients.role'),
      required: false,
      accepted: freeText,
      example: 'Acquisti',
      width: 20,
      maxLength: 255,
    },
    {
      key: 'email',
      label: t('crm:clients.email'),
      required: false,
      accepted: t('crm:clients.bulk.excel.validEmail'),
      example: 'mario@example.com',
      width: 28,
      maxLength: 255,
    },
    {
      key: 'phone',
      label: t('crm:clients.phone'),
      required: false,
      accepted: freeText,
      example: '+39 000 0000000',
      width: 20,
      maxLength: 50,
    },
    {
      key: 'website',
      label: t('crm:clients.website'),
      required: false,
      accepted: freeText,
      example: 'https://example.com',
      width: 28,
      maxLength: 255,
    },
    {
      key: 'addressCountry',
      label: t('crm:clients.country'),
      required: false,
      accepted: freeText,
      example: 'Italia',
      width: 18,
      maxLength: 100,
    },
    {
      key: 'addressState',
      label: t('crm:clients.state'),
      required: false,
      accepted: freeText,
      example: 'Roma',
      width: 18,
      maxLength: 100,
    },
    {
      key: 'addressCap',
      label: t('crm:clients.cap'),
      required: false,
      accepted: freeText,
      example: '00100',
      width: 14,
      maxLength: 20,
    },
    {
      key: 'addressProvince',
      label: t('crm:clients.province'),
      required: false,
      accepted: freeText,
      example: 'RM',
      width: 16,
      maxLength: 100,
    },
    {
      key: 'addressCivicNumber',
      label: t('crm:clients.civicNumber'),
      required: false,
      accepted: freeText,
      example: '15A',
      width: 16,
      maxLength: 30,
    },
    {
      key: 'addressLine',
      label: t('crm:clients.address'),
      required: false,
      accepted: freeText,
      example: 'Via Esempio',
      width: 30,
    },
    {
      key: 'atecoCode',
      label: t('crm:clients.atecoCode'),
      required: false,
      accepted: freeText,
      example: '62.01',
      width: 16,
      maxLength: 50,
    },
    profileField('sector', t('crm:clients.sector')),
    profileField('numberOfEmployees', t('crm:clients.numberOfEmployees')),
    profileField('revenue', t('crm:clients.revenue')),
    profileField('officeCountRange', t('crm:clients.officeCountRange')),
    {
      key: 'description',
      label: t('crm:clients.description'),
      required: false,
      accepted: freeText,
      example: 'Cliente strategico',
      width: 36,
    },
  ];

  return {
    entity: 'clients',
    title: t('crm:clients.bulk.excel.workbookTitle'),
    instructions: t('crm:clients.bulk.excel.workbookInstructions'),
    dataNotice: t('crm:clients.bulk.excel.workbookDataNotice'),
    fieldComment: (field) =>
      t('crm:clients.bulk.excel.workbookFieldComment', {
        field: field.label,
        required: field.required ? t('common:boolean.yes') : t('common:boolean.no'),
        accepted: field.accepted,
        example: field.example || '—',
      }),
    invalidValueTitle: t('crm:clients.bulk.excel.invalidValueTitle'),
    invalidValueMessage: t('crm:clients.bulk.excel.invalidValueMessage'),
    fields,
  };
};

export const parseClientImportWorkbook = (
  workbook: Workbook,
): ImportWorkbookParseResult<BulkClientCreateInput> =>
  parseImportWorkbook(
    workbook,
    'clients',
    CLIENT_IMPORT_FIELDS,
  ) as ImportWorkbookParseResult<BulkClientCreateInput>;
