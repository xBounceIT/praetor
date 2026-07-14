import type { Cell, Workbook } from 'exceljs';

export const IMPORT_WORKBOOK_SIGNATURE = 'praetor-import';
export const IMPORT_WORKBOOK_VERSION = 1;
export const IMPORT_WORKSHEET_NAME = 'Import';
export const IMPORT_METADATA_SHEET_NAME = '_praetor';
export const IMPORT_HEADER_ROW = 4;
export const IMPORT_EXAMPLE_ROW = 5;
export const IMPORT_FIRST_DATA_ROW = 6;
export const MAX_ENTITY_IMPORT_ROWS = 500;
export const MAX_ENTITY_IMPORT_FILE_BYTES = 5 * 1024 * 1024;

const IMPORT_LAST_DATA_ROW = IMPORT_FIRST_DATA_ROW + MAX_ENTITY_IMPORT_ROWS - 1;
const METADATA_FIELD_START_ROW = 11;
const METADATA_LIST_START_COLUMN = 8;
const WORKSHEET_PROTECTION_PASSWORD = 'praetor-import-template';

export type ImportWorkbookEntity = 'clients' | 'suppliers';

export type ImportListOption = {
  display: string;
  value: string;
};

export type ImportFieldDefinition<Field extends string> = {
  key: Field;
  label: string;
  required: boolean;
  accepted: string;
  example: string;
  width?: number;
  maxLength?: number;
  options?: ImportListOption[];
};

export type ImportWorkbookDefinition<Field extends string> = {
  entity: ImportWorkbookEntity;
  title: string;
  instructions: string;
  exampleNotice: string;
  fieldComment: (field: ImportFieldDefinition<Field>) => string;
  invalidValueTitle: string;
  invalidValueMessage: string;
  fields: ImportFieldDefinition<Field>[];
};

export type ImportWorkbookIssueCode =
  | 'invalid_workbook'
  | 'wrong_template'
  | 'unsupported_version'
  | 'wrong_entity'
  | 'modified_structure'
  | 'too_many_rows'
  | 'invalid_cell';

export type ImportWorkbookIssue = {
  line?: number;
  field?: string;
  code: ImportWorkbookIssueCode;
};

export type ImportWorkbookParseResult<Item> = {
  rows: Array<{ line: number; item: Item }>;
  rowIssues: ImportWorkbookIssue[];
  fatalIssues: ImportWorkbookIssue[];
  totalDataRows: number;
};

const fill = (argb: string) => ({
  type: 'pattern' as const,
  pattern: 'solid' as const,
  fgColor: { argb },
});

const thinBorder = {
  top: { style: 'thin' as const, color: { argb: 'FFD8DEE4' } },
  left: { style: 'thin' as const, color: { argb: 'FFD8DEE4' } },
  bottom: { style: 'thin' as const, color: { argb: 'FFD8DEE4' } },
  right: { style: 'thin' as const, color: { argb: 'FFD8DEE4' } },
};

const columnName = (column: number) => {
  let result = '';
  let current = column;
  while (current > 0) {
    const remainder = (current - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    current = Math.floor((current - 1) / 26);
  }
  return result;
};

const definedNameFor = (entity: ImportWorkbookEntity, field: string) =>
  `praetor_${entity}_${field}`.replace(/[^A-Za-z0-9_.]/g, '_');

const scalarText = (cell: Cell): { ok: true; value: string } | { ok: false } => {
  const value = cell.value;
  if (value === null || value === undefined) return { ok: true, value: '' };
  if (typeof value === 'string') return { ok: true, value: value.trim() };
  if (typeof value === 'number' && Number.isFinite(value)) {
    return { ok: true, value: String(value).trim() };
  }
  return { ok: false };
};

const metadataText = (workbook: Workbook, address: string) => {
  const sheet = workbook.getWorksheet(IMPORT_METADATA_SHEET_NAME);
  if (!sheet) return '';
  const value = sheet.getCell(address).value;
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
};

export const buildImportWorkbook = async <Field extends string>(
  workbook: Workbook,
  definition: ImportWorkbookDefinition<Field>,
): Promise<Workbook> => {
  workbook.creator = 'Praetor';
  workbook.created = new Date();
  workbook.modified = new Date();

  const worksheet = workbook.addWorksheet(IMPORT_WORKSHEET_NAME, {
    views: [{ state: 'frozen', ySplit: IMPORT_EXAMPLE_ROW, showGridLines: false }],
  });
  const metadata = workbook.addWorksheet(IMPORT_METADATA_SHEET_NAME, {
    views: [{ showGridLines: false }],
  });
  metadata.state = 'veryHidden';

  const lastColumn = definition.fields.length;
  worksheet.mergeCells(1, 1, 1, lastColumn);
  worksheet.mergeCells(2, 1, 2, lastColumn);
  worksheet.mergeCells(3, 1, 3, lastColumn);
  worksheet.getCell(1, 1).value = definition.title;
  worksheet.getCell(2, 1).value = definition.instructions;
  worksheet.getCell(3, 1).value = definition.exampleNotice;
  worksheet.getCell(1, 1).font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
  worksheet.getCell(1, 1).fill = fill('FF0F766E');
  worksheet.getCell(1, 1).alignment = { vertical: 'middle', horizontal: 'left' };
  worksheet.getCell(2, 1).font = { size: 11, color: { argb: 'FF334155' } };
  worksheet.getCell(2, 1).fill = fill('FFE2E8F0');
  worksheet.getCell(2, 1).alignment = { vertical: 'middle', wrapText: true };
  worksheet.getCell(3, 1).font = { italic: true, size: 10, color: { argb: 'FF475569' } };
  worksheet.getCell(3, 1).fill = fill('FFF1F5F9');
  worksheet.getCell(3, 1).alignment = { vertical: 'middle', wrapText: true };
  worksheet.getRow(1).height = 30;
  worksheet.getRow(2).height = 36;
  worksheet.getRow(3).height = 28;
  worksheet.getRow(4).height = 34;
  worksheet.getRow(5).height = 28;

  metadata.getCell('A1').value = 'signature';
  metadata.getCell('B1').value = IMPORT_WORKBOOK_SIGNATURE;
  metadata.getCell('A2').value = 'version';
  metadata.getCell('B2').value = IMPORT_WORKBOOK_VERSION;
  metadata.getCell('A3').value = 'entity';
  metadata.getCell('B3').value = definition.entity;
  metadata.getCell('A4').value = 'data_sheet';
  metadata.getCell('B4').value = IMPORT_WORKSHEET_NAME;
  metadata.getCell('A5').value = 'header_row';
  metadata.getCell('B5').value = IMPORT_HEADER_ROW;
  metadata.getCell('A6').value = 'example_row';
  metadata.getCell('B6').value = IMPORT_EXAMPLE_ROW;
  metadata.getCell('A7').value = 'first_data_row';
  metadata.getCell('B7').value = IMPORT_FIRST_DATA_ROW;
  metadata.getCell('A8').value = 'max_rows';
  metadata.getCell('B8').value = MAX_ENTITY_IMPORT_ROWS;
  metadata.getCell('A9').value = 'field_count';
  metadata.getCell('B9').value = definition.fields.length;

  definition.fields.forEach((field, fieldIndex) => {
    const column = fieldIndex + 1;
    const visibleHeader = `${field.label}${field.required ? ' *' : ''}`;
    const headerCell = worksheet.getCell(IMPORT_HEADER_ROW, column);
    headerCell.value = visibleHeader;
    headerCell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerCell.fill = fill(field.required ? 'FFB45309' : 'FF334155');
    headerCell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
    headerCell.border = thinBorder;
    headerCell.note = definition.fieldComment(field);

    const exampleCell = worksheet.getCell(IMPORT_EXAMPLE_ROW, column);
    exampleCell.value = field.example;
    exampleCell.font = { italic: true, color: { argb: 'FF64748B' } };
    exampleCell.fill = fill('FFF1F5F9');
    exampleCell.alignment = { vertical: 'middle', horizontal: 'left' };
    exampleCell.border = thinBorder;
    exampleCell.numFmt = '@';

    worksheet.getColumn(column).width = Math.min(Math.max(field.width ?? 20, 12), 42);

    const metadataRow = METADATA_FIELD_START_ROW + fieldIndex;
    metadata.getCell(metadataRow, 1).value = field.key;
    metadata.getCell(metadataRow, 2).value = visibleHeader;
    metadata.getCell(metadataRow, 3).value = field.required ? 1 : 0;
    metadata.getCell(metadataRow, 4).value = field.example;

    let listName: string | null = null;
    if (field.options && field.options.length > 0) {
      const displayColumn = METADATA_LIST_START_COLUMN + fieldIndex * 2;
      const valueColumn = displayColumn + 1;
      metadata.getCell(1, displayColumn).value = `${field.key}_display`;
      metadata.getCell(1, valueColumn).value = `${field.key}_value`;
      field.options.forEach((option, optionIndex) => {
        metadata.getCell(optionIndex + 2, displayColumn).value = option.display;
        metadata.getCell(optionIndex + 2, valueColumn).value = option.value;
      });
      metadata.getCell(metadataRow, 5).value = displayColumn;
      metadata.getCell(metadataRow, 6).value = field.options.length;
      listName = definedNameFor(definition.entity, field.key);
      const displayColumnName = columnName(displayColumn);
      workbook.definedNames.add(
        `'${IMPORT_METADATA_SHEET_NAME}'!$${displayColumnName}$2:$${displayColumnName}$${
          field.options.length + 1
        }`,
        listName,
      );
    }

    for (let row = IMPORT_FIRST_DATA_ROW; row <= IMPORT_LAST_DATA_ROW; row += 1) {
      const cell = worksheet.getCell(row, column);
      cell.numFmt = '@';
      cell.protection = { locked: false };
      cell.fill = fill(field.required ? 'FFFFF7ED' : 'FFEFF6FF');
      cell.alignment = { vertical: 'middle', horizontal: 'left' };
      cell.border = thinBorder;
      if (listName) {
        cell.dataValidation = {
          type: 'list',
          allowBlank: true,
          formulae: [listName],
          showErrorMessage: true,
          errorStyle: 'stop',
          errorTitle: definition.invalidValueTitle,
          error: definition.invalidValueMessage,
        };
      } else if (field.maxLength) {
        cell.dataValidation = {
          type: 'textLength',
          operator: 'lessThanOrEqual',
          allowBlank: true,
          formulae: [field.maxLength],
          showErrorMessage: true,
          errorStyle: 'stop',
          errorTitle: definition.invalidValueTitle,
          error: definition.invalidValueMessage,
        };
      }
    }
  });

  worksheet.autoFilter = {
    from: { row: IMPORT_HEADER_ROW, column: 1 },
    to: { row: IMPORT_LAST_DATA_ROW, column: lastColumn },
  };
  worksheet.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1 };

  await worksheet.protect(WORKSHEET_PROTECTION_PASSWORD, {
    selectLockedCells: false,
    selectUnlockedCells: true,
    formatCells: false,
    formatColumns: false,
    formatRows: false,
    insertColumns: false,
    insertRows: false,
    insertHyperlinks: false,
    deleteColumns: false,
    deleteRows: false,
    sort: false,
    autoFilter: true,
    pivotTables: false,
    spinCount: 1000,
  });
  await metadata.protect(WORKSHEET_PROTECTION_PASSWORD, {
    selectLockedCells: false,
    selectUnlockedCells: false,
    spinCount: 1000,
  });

  return workbook;
};

export const parseImportWorkbook = <Field extends string>(
  workbook: Workbook,
  expectedEntity: ImportWorkbookEntity,
  expectedFields: readonly Field[],
): ImportWorkbookParseResult<Partial<Record<Field, string>>> => {
  const emptyResult = (
    issue: ImportWorkbookIssue,
  ): ImportWorkbookParseResult<Partial<Record<Field, string>>> => ({
    rows: [],
    rowIssues: [],
    fatalIssues: [issue],
    totalDataRows: 0,
  });

  if (
    workbook.worksheets.length !== 2 ||
    !workbook.getWorksheet(IMPORT_WORKSHEET_NAME) ||
    !workbook.getWorksheet(IMPORT_METADATA_SHEET_NAME)
  ) {
    return emptyResult({ code: 'wrong_template' });
  }
  if (metadataText(workbook, 'B1') !== IMPORT_WORKBOOK_SIGNATURE) {
    return emptyResult({ code: 'wrong_template' });
  }
  if (Number(metadataText(workbook, 'B2')) !== IMPORT_WORKBOOK_VERSION) {
    return emptyResult({ code: 'unsupported_version' });
  }
  if (metadataText(workbook, 'B3') !== expectedEntity) {
    return emptyResult({ code: 'wrong_entity' });
  }
  const fieldCount = Number(metadataText(workbook, 'B9'));
  if (
    metadataText(workbook, 'B4') !== IMPORT_WORKSHEET_NAME ||
    Number(metadataText(workbook, 'B5')) !== IMPORT_HEADER_ROW ||
    Number(metadataText(workbook, 'B6')) !== IMPORT_EXAMPLE_ROW ||
    Number(metadataText(workbook, 'B7')) !== IMPORT_FIRST_DATA_ROW ||
    Number(metadataText(workbook, 'B8')) !== MAX_ENTITY_IMPORT_ROWS ||
    fieldCount !== expectedFields.length
  ) {
    return emptyResult({ code: 'modified_structure' });
  }

  const worksheet = workbook.getWorksheet(IMPORT_WORKSHEET_NAME);
  const metadata = workbook.getWorksheet(IMPORT_METADATA_SHEET_NAME);
  if (!worksheet || !metadata) return emptyResult({ code: 'wrong_template' });

  const mappings = new Map<Field, Map<string, string>>();
  for (let index = 0; index < expectedFields.length; index += 1) {
    const field = expectedFields[index];
    const metadataRow = METADATA_FIELD_START_ROW + index;
    const storedField = metadata.getCell(metadataRow, 1).value;
    const storedHeader = metadata.getCell(metadataRow, 2).value;
    const storedExample = metadata.getCell(metadataRow, 4).value;
    if (
      storedField !== field ||
      typeof storedHeader !== 'string' ||
      worksheet.getCell(IMPORT_HEADER_ROW, index + 1).value !== storedHeader ||
      worksheet.getCell(IMPORT_EXAMPLE_ROW, index + 1).value !== storedExample
    ) {
      return emptyResult({ code: 'modified_structure' });
    }

    const displayColumn = Number(metadata.getCell(metadataRow, 5).value ?? 0);
    const optionCount = Number(metadata.getCell(metadataRow, 6).value ?? 0);
    const hasListMetadata = displayColumn !== 0 || optionCount !== 0;
    if (
      !Number.isInteger(displayColumn) ||
      !Number.isInteger(optionCount) ||
      displayColumn < 0 ||
      optionCount < 0 ||
      (displayColumn === 0) !== (optionCount === 0)
    ) {
      return emptyResult({ code: 'modified_structure' });
    }
    if (hasListMetadata) {
      const expectedDisplayColumn = METADATA_LIST_START_COLUMN + index * 2;
      if (
        displayColumn !== expectedDisplayColumn ||
        optionCount > metadata.actualRowCount ||
        metadata.getCell(1, displayColumn).value !== `${field}_display` ||
        metadata.getCell(1, displayColumn + 1).value !== `${field}_value`
      ) {
        return emptyResult({ code: 'modified_structure' });
      }
      const mapping = new Map<string, string>();
      for (let optionIndex = 0; optionIndex < optionCount; optionIndex += 1) {
        const display = metadata.getCell(optionIndex + 2, displayColumn).value;
        const value = metadata.getCell(optionIndex + 2, displayColumn + 1).value;
        if (typeof display !== 'string' || typeof value !== 'string') {
          return emptyResult({ code: 'modified_structure' });
        }
        mapping.set(display.trim().toLowerCase(), value);
        mapping.set(value.trim().toLowerCase(), value);
      }
      mappings.set(field, mapping);
    }
  }

  let hasOverflowData = false;
  worksheet.eachRow((row, rowNumber) => {
    if (hasOverflowData || rowNumber <= IMPORT_LAST_DATA_ROW) return;
    for (let column = 1; column <= expectedFields.length; column += 1) {
      const value = scalarText(row.getCell(column));
      if (!value.ok || value.value !== '') {
        hasOverflowData = true;
        return;
      }
    }
  });
  if (hasOverflowData) return emptyResult({ code: 'too_many_rows' });

  const rows: Array<{ line: number; item: Partial<Record<Field, string>> }> = [];
  const rowIssues: ImportWorkbookIssue[] = [];
  let totalDataRows = 0;
  for (let row = IMPORT_FIRST_DATA_ROW; row <= IMPORT_LAST_DATA_ROW; row += 1) {
    const item: Partial<Record<Field, string>> = {};
    let hasValue = false;
    let rowInvalid = false;
    for (let column = 1; column <= expectedFields.length; column += 1) {
      const field = expectedFields[column - 1];
      const parsed = scalarText(worksheet.getCell(row, column));
      if (!parsed.ok) {
        rowIssues.push({ line: row, field, code: 'invalid_cell' });
        rowInvalid = true;
        continue;
      }
      if (!parsed.value) continue;
      hasValue = true;
      const mapping = mappings.get(field);
      item[field] = mapping?.get(parsed.value.toLowerCase()) ?? parsed.value;
    }
    if (!hasValue) continue;
    totalDataRows += 1;
    if (!rowInvalid) rows.push({ line: row, item });
  }

  return { rows, rowIssues, fatalIssues: [], totalDataRows };
};

export const loadImportWorkbook = async (source: ArrayBuffer): Promise<Workbook> => {
  const { createExcelWorkbook } = await import('./excelJsBrowser');
  const workbook = await createExcelWorkbook();
  await workbook.xlsx.load(source as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  return workbook;
};

export const downloadImportWorkbook = async <Field extends string>(
  definition: ImportWorkbookDefinition<Field>,
  filename: string,
): Promise<string> => {
  const { createExcelWorkbook } = await import('./excelJsBrowser');
  const workbook = await buildImportWorkbook(await createExcelWorkbook(), definition);
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  return filename;
};
