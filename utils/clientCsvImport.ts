import Papa, { type ParseError } from 'papaparse';
import type { BulkClientCreateInput } from '../types';

export const CLIENT_CSV_HEADERS = [
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

export const REQUIRED_CLIENT_CSV_HEADERS = ['clientCode', 'name', 'fiscalCode'] as const;
export const MAX_CLIENT_IMPORT_ROWS = 500;
export const MAX_CLIENT_CSV_FILE_BYTES = 5 * 1024 * 1024;

export type ClientCsvRow = {
  line: number;
  client: BulkClientCreateInput;
};

export type ClientCsvParseIssue = {
  line?: number;
  code:
    | 'empty_file'
    | 'missing_header'
    | 'unknown_header'
    | 'duplicate_header'
    | 'invalid_csv'
    | 'field_mismatch'
    | 'too_many_rows';
  message: string;
  details?: Record<string, string | number>;
};

export type ClientCsvParseResult = {
  rows: ClientCsvRow[];
  rowIssues: ClientCsvParseIssue[];
  fatalIssues: ClientCsvParseIssue[];
  delimiter: ',' | ';' | null;
  totalDataRows: number;
};

const normalizeHeader = (header: string, index: number) =>
  (index === 0 ? header.replace(/^\uFEFF/, '') : header).trim();

const issueFromPapaError = (error: ParseError): ClientCsvParseIssue => ({
  line: typeof error.row === 'number' ? error.row + 1 : undefined,
  code: 'invalid_csv',
  message: error.message,
});

export const parseClientCsv = (source: string): ClientCsvParseResult => {
  const parsed: Papa.ParseResult<string[]> = Papa.parse<string[]>(source, {
    delimiter: '',
    delimitersToGuess: [',', ';'],
    quoteChar: '"',
    escapeChar: '"',
    skipEmptyLines: 'greedy',
  });

  const delimiter =
    parsed.meta.delimiter === ',' || parsed.meta.delimiter === ';' ? parsed.meta.delimiter : null;
  const firstRow = parsed.data[0];
  if (!firstRow || firstRow.length === 0 || firstRow.every((value) => value.trim() === '')) {
    return {
      rows: [],
      rowIssues: [],
      fatalIssues: [{ code: 'empty_file', message: 'CSV file is empty' }],
      delimiter,
      totalDataRows: 0,
    };
  }

  const headers = firstRow.map(normalizeHeader);
  const knownHeaders = new Set<string>(CLIENT_CSV_HEADERS);
  const headerCounts = new Map<string, number>();
  for (const header of headers) {
    headerCounts.set(header, (headerCounts.get(header) ?? 0) + 1);
  }

  const fatalIssues: ClientCsvParseIssue[] = [];
  for (const [header, count] of headerCounts) {
    if (count > 1) {
      fatalIssues.push({
        code: 'duplicate_header',
        message: `CSV header "${header}" is duplicated`,
        details: { header },
      });
    }
    if (!knownHeaders.has(header)) {
      fatalIssues.push({
        code: 'unknown_header',
        message: `Unknown CSV header "${header}"`,
        details: { header },
      });
    }
  }
  for (const required of REQUIRED_CLIENT_CSV_HEADERS) {
    if (!headerCounts.has(required)) {
      fatalIssues.push({
        code: 'missing_header',
        message: `Missing required CSV header "${required}"`,
        details: { header: required },
      });
    }
  }

  const dataRows = parsed.data.slice(1);
  if (dataRows.length > MAX_CLIENT_IMPORT_ROWS) {
    fatalIssues.push({
      code: 'too_many_rows',
      message: `CSV contains more than ${MAX_CLIENT_IMPORT_ROWS} data rows`,
      details: { limit: MAX_CLIENT_IMPORT_ROWS },
    });
  }

  const parserIssuesByRow = new Map<number, ClientCsvParseIssue[]>();
  for (const error of parsed.errors) {
    const issue = issueFromPapaError(error);
    if (issue.line === 1 || issue.line === undefined) {
      fatalIssues.push(issue);
      continue;
    }
    const rowIndex = issue.line - 2;
    const rowIssues = parserIssuesByRow.get(rowIndex) ?? [];
    rowIssues.push(issue);
    parserIssuesByRow.set(rowIndex, rowIssues);
  }

  if (fatalIssues.length > 0) {
    return {
      rows: [],
      rowIssues: [],
      fatalIssues,
      delimiter,
      totalDataRows: dataRows.length,
    };
  }

  const rows: ClientCsvRow[] = [];
  const rowIssues: ClientCsvParseIssue[] = [];
  dataRows.forEach((values, rowIndex) => {
    const line = rowIndex + 2;
    const parserIssues = parserIssuesByRow.get(rowIndex);
    if (parserIssues) {
      rowIssues.push(...parserIssues.map((issue) => ({ ...issue, line })));
      return;
    }
    if (values.length !== headers.length) {
      rowIssues.push({
        line,
        code: 'field_mismatch',
        message: `Row ${line} has ${values.length} fields; expected ${headers.length}`,
        details: { actual: values.length, expected: headers.length },
      });
      return;
    }

    const client: BulkClientCreateInput = {};
    headers.forEach((header, columnIndex) => {
      const value = values[columnIndex]?.trim() ?? '';
      if (value !== '') {
        client[header as keyof BulkClientCreateInput] = value;
      }
    });
    rows.push({ line, client });
  });

  return {
    rows,
    rowIssues,
    fatalIssues: [],
    delimiter,
    totalDataRows: dataRows.length,
  };
};
