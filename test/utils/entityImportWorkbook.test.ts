import { describe, expect, test } from 'bun:test';
import { Workbook, type Worksheet } from 'exceljs';
import type { ClientProfileOptionsByCategory } from '../../types';
import {
  buildClientImportDefinition,
  CLIENT_IMPORT_FIELDS,
  parseClientImportWorkbook,
} from '../../utils/clientImportWorkbook';
import {
  buildImportWorkbook,
  IMPORT_EXAMPLE_ROW,
  IMPORT_FIRST_DATA_ROW,
  IMPORT_HEADER_ROW,
  IMPORT_METADATA_SHEET_NAME,
  IMPORT_WORKBOOK_SIGNATURE,
  IMPORT_WORKBOOK_VERSION,
  IMPORT_WORKSHEET_NAME,
  MAX_ENTITY_IMPORT_ROWS,
} from '../../utils/entityImportWorkbook';
import {
  buildSupplierImportDefinition,
  parseSupplierImportWorkbook,
  SUPPLIER_IMPORT_FIELDS,
} from '../../utils/supplierImportWorkbook';

const profileOptions = (sector: string): ClientProfileOptionsByCategory => ({
  sector: [
    {
      id: `sector-${sector}`,
      category: 'sector',
      value: sector,
      sortOrder: 0,
      usageCount: 0,
    },
  ],
  numberOfEmployees: [
    {
      id: 'employees-1',
      category: 'numberOfEmployees',
      value: '1-10',
      sortOrder: 0,
      usageCount: 0,
    },
  ],
  revenue: [
    {
      id: 'revenue-1',
      category: 'revenue',
      value: '< 1M',
      sortOrder: 0,
      usageCount: 0,
    },
  ],
  officeCountRange: [
    {
      id: 'offices-1',
      category: 'officeCountRange',
      value: '1',
      sortOrder: 0,
      usageCount: 0,
    },
  ],
});

const translator = (language: 'it' | 'en') => (key: string, options?: Record<string, unknown>) => {
  if (key === 'crm:clients.typeCompany') return language === 'it' ? 'Azienda' : 'Company';
  if (key === 'crm:clients.typeIndividual') return language === 'it' ? 'Privato' : 'Individual';
  if (key === 'common:boolean.yes') return language === 'it' ? 'Sì' : 'Yes';
  if (key === 'common:boolean.no') return 'No';
  return `${language}:${key}${options?.field ? `:${String(options.field)}` : ''}`;
};

const clientColumn = (field: (typeof CLIENT_IMPORT_FIELDS)[number]) =>
  CLIENT_IMPORT_FIELDS.indexOf(field) + 1;
const supplierColumn = (field: (typeof SUPPLIER_IMPORT_FIELDS)[number]) =>
  SUPPLIER_IMPORT_FIELDS.indexOf(field) + 1;

const requireWorksheet = (workbook: Workbook, name: string): Worksheet => {
  const worksheet = workbook.getWorksheet(name);
  if (!worksheet) throw new Error(`Missing worksheet ${name}`);
  return worksheet;
};

const metadataFieldRow = (worksheet: Worksheet, field: string) => {
  let fieldRow: number | null = null;
  worksheet.getColumn(1).eachCell((cell, rowNumber) => {
    if (cell.value === field) fieldRow = rowNumber;
  });
  if (fieldRow === null) throw new Error(`Missing metadata for ${field}`);
  return fieldRow;
};

describe('Praetor entity import workbooks', () => {
  test('generates and round-trips the protected client workbook with localized mappings', async () => {
    const definition = buildClientImportDefinition(profileOptions('Energia'), translator('it'));
    const generated = await buildImportWorkbook(new Workbook(), definition);
    const buffer = await generated.xlsx.writeBuffer();
    const workbook = new Workbook();
    await workbook.xlsx.load(buffer);

    const sheet = requireWorksheet(workbook, IMPORT_WORKSHEET_NAME);
    const metadata = requireWorksheet(workbook, IMPORT_METADATA_SHEET_NAME);
    expect(metadata.state).toBe('veryHidden');
    expect(metadata.getCell('B1').value).toBe(IMPORT_WORKBOOK_SIGNATURE);
    expect(metadata.getCell('B2').value).toBe(IMPORT_WORKBOOK_VERSION);
    expect(metadata.getCell('B3').value).toBe('clients');
    expect(
      (sheet as unknown as { sheetProtection?: { sheet?: boolean } }).sheetProtection?.sheet,
    ).toBe(true);
    expect(
      (metadata as unknown as { sheetProtection?: { sheet?: boolean } }).sheetProtection?.sheet,
    ).toBe(true);
    expect(sheet.getCell(IMPORT_HEADER_ROW, 1).protection?.locked).not.toBe(false);
    expect(sheet.getCell(IMPORT_EXAMPLE_ROW, 1).protection?.locked).not.toBe(false);
    expect(sheet.getCell(IMPORT_FIRST_DATA_ROW, 1).protection.locked).toBe(false);
    expect(
      sheet.getCell(IMPORT_FIRST_DATA_ROW + MAX_ENTITY_IMPORT_ROWS - 1, 1).protection.locked,
    ).toBe(false);

    sheet.getCell(IMPORT_FIRST_DATA_ROW, clientColumn('clientCode')).value = 'CLI-001';
    sheet.getCell(IMPORT_FIRST_DATA_ROW, clientColumn('name')).value = 'Acme';
    sheet.getCell(IMPORT_FIRST_DATA_ROW, clientColumn('type')).value = 'Azienda';
    sheet.getCell(IMPORT_FIRST_DATA_ROW, clientColumn('fiscalCode')).value = '00123456789';
    sheet.getCell(IMPORT_FIRST_DATA_ROW, clientColumn('sector')).value = 'Energia';

    const parsed = parseClientImportWorkbook(workbook);
    expect(parsed.fatalIssues).toEqual([]);
    expect(parsed.rowIssues).toEqual([]);
    expect(parsed.rows).toEqual([
      {
        line: IMPORT_FIRST_DATA_ROW,
        item: {
          clientCode: 'CLI-001',
          name: 'Acme',
          type: 'company',
          fiscalCode: '00123456789',
          sector: 'Energia',
        },
      },
    ]);
  });

  test('uses the latest client profile values in metadata and blocking dropdowns', async () => {
    const workbook = await buildImportWorkbook(
      new Workbook(),
      buildClientImportDefinition(profileOptions('Nuovo settore'), translator('it')),
    );
    const sheet = requireWorksheet(workbook, IMPORT_WORKSHEET_NAME);
    const metadata = requireWorksheet(workbook, IMPORT_METADATA_SHEET_NAME);
    const sectorIndex = CLIENT_IMPORT_FIELDS.indexOf('sector');
    const metadataRow = 11 + sectorIndex;
    const listColumn = Number(metadata.getCell(metadataRow, 5).value);

    expect(metadata.getCell(2, listColumn).value).toBe('Nuovo settore');
    expect(metadata.getCell(2, listColumn + 1).value).toBe('Nuovo settore');
    expect(sheet.getCell(IMPORT_FIRST_DATA_ROW, sectorIndex + 1).dataValidation).toEqual(
      expect.objectContaining({
        type: 'list',
        errorStyle: 'stop',
        formulae: ['praetor_clients_sector'],
      }),
    );
  });

  test('generates the supplier workbook and does not import its locked example row', async () => {
    const workbook = await buildImportWorkbook(
      new Workbook(),
      buildSupplierImportDefinition(translator('en')),
    );
    const sheet = requireWorksheet(workbook, IMPORT_WORKSHEET_NAME);

    expect(parseSupplierImportWorkbook(workbook)).toEqual({
      rows: [],
      rowIssues: [],
      fatalIssues: [],
      totalDataRows: 0,
    });

    sheet.getCell(IMPORT_FIRST_DATA_ROW, supplierColumn('supplierCode')).value = ' SUP-001 ';
    sheet.getCell(IMPORT_FIRST_DATA_ROW, supplierColumn('name')).value = ' Supplier One ';
    sheet.getCell(IMPORT_FIRST_DATA_ROW, supplierColumn('vatNumber')).value = 123456789;
    sheet.getCell(IMPORT_FIRST_DATA_ROW, supplierColumn('contactName')).value = 'Jane';
    sheet.getCell(IMPORT_FIRST_DATA_ROW, supplierColumn('contactRole')).value = 'Buyer';

    expect(parseSupplierImportWorkbook(workbook).rows).toEqual([
      {
        line: IMPORT_FIRST_DATA_ROW,
        item: {
          supplierCode: 'SUP-001',
          name: 'Supplier One',
          vatNumber: '123456789',
          contactName: 'Jane',
          contactRole: 'Buyer',
        },
      },
    ]);
  });

  test('rejects formula cells by row and ignores fully empty rows', async () => {
    const workbook = await buildImportWorkbook(
      new Workbook(),
      buildSupplierImportDefinition(translator('it')),
    );
    const sheet = requireWorksheet(workbook, IMPORT_WORKSHEET_NAME);
    const formulaRow = IMPORT_FIRST_DATA_ROW + 2;
    sheet.getCell(formulaRow, supplierColumn('supplierCode')).value = {
      formula: 'CONCAT("SUP","-001")',
      result: 'SUP-001',
    };
    sheet.getCell(formulaRow, supplierColumn('name')).value = 'Formula supplier';

    const parsed = parseSupplierImportWorkbook(workbook);
    expect(parsed.totalDataRows).toBe(1);
    expect(parsed.rows).toEqual([]);
    expect(parsed.rowIssues).toContainEqual({
      line: formulaRow,
      field: 'supplierCode',
      code: 'invalid_cell',
    });
  });

  test('blocks altered signatures, versions, entities, headers, sheets, and rows over the limit', async () => {
    const create = () =>
      buildImportWorkbook(new Workbook(), buildSupplierImportDefinition(translator('it')));

    const signature = await create();
    requireWorksheet(signature, IMPORT_METADATA_SHEET_NAME).getCell('B1').value = 'other';
    expect(parseSupplierImportWorkbook(signature).fatalIssues[0]?.code).toBe('wrong_template');

    const version = await create();
    requireWorksheet(version, IMPORT_METADATA_SHEET_NAME).getCell('B2').value = 99;
    expect(parseSupplierImportWorkbook(version).fatalIssues[0]?.code).toBe('unsupported_version');

    const entity = await create();
    requireWorksheet(entity, IMPORT_METADATA_SHEET_NAME).getCell('B3').value = 'clients';
    expect(parseSupplierImportWorkbook(entity).fatalIssues[0]?.code).toBe('wrong_entity');

    const header = await create();
    requireWorksheet(header, IMPORT_WORKSHEET_NAME).getCell(IMPORT_HEADER_ROW, 1).value = 'Changed';
    expect(parseSupplierImportWorkbook(header).fatalIssues[0]?.code).toBe('modified_structure');

    const missingSheet = await create();
    missingSheet.removeWorksheet(requireWorksheet(missingSheet, IMPORT_METADATA_SHEET_NAME).id);
    expect(parseSupplierImportWorkbook(missingSheet).fatalIssues[0]?.code).toBe('wrong_template');

    const tooMany = await create();
    requireWorksheet(tooMany, IMPORT_WORKSHEET_NAME).getCell(1_048_576, 1).value = 'SUP-501';
    expect(parseSupplierImportWorkbook(tooMany).fatalIssues[0]?.code).toBe('too_many_rows');
  });

  test('rejects altered or unbounded list metadata as a structural change', async () => {
    const create = () =>
      buildImportWorkbook(
        new Workbook(),
        buildClientImportDefinition(profileOptions('Technology'), translator('it')),
      );

    const movedList = await create();
    const movedMetadata = requireWorksheet(movedList, IMPORT_METADATA_SHEET_NAME);
    const typeRow = metadataFieldRow(movedMetadata, 'type');
    movedMetadata.getCell(typeRow, 5).value = Number(movedMetadata.getCell(typeRow, 5).value) + 2;
    expect(parseClientImportWorkbook(movedList).fatalIssues[0]?.code).toBe('modified_structure');

    const unboundedList = await create();
    const unboundedMetadata = requireWorksheet(unboundedList, IMPORT_METADATA_SHEET_NAME);
    unboundedMetadata.getCell(metadataFieldRow(unboundedMetadata, 'type'), 6).value = 1_000_000;
    expect(parseClientImportWorkbook(unboundedList).fatalIssues[0]?.code).toBe(
      'modified_structure',
    );
  });
});
