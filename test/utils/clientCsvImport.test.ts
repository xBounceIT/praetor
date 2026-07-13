import { describe, expect, test } from 'bun:test';
import {
  CLIENT_CSV_HEADERS,
  MAX_CLIENT_IMPORT_ROWS,
  parseClientCsv,
} from '../../utils/clientCsvImport';

describe('parseClientCsv', () => {
  test('accepts UTF-8 BOM, comma delimiters, and headers in any order', () => {
    const result = parseClientCsv(
      '\uFEFFname,fiscalCode,clientCode,type\nAcme,IT123,CLI-1,individual',
    );

    expect(result.fatalIssues).toEqual([]);
    expect(result.delimiter).toBe(',');
    expect(result.rows).toEqual([
      {
        line: 2,
        client: {
          name: 'Acme',
          fiscalCode: 'IT123',
          clientCode: 'CLI-1',
          type: 'individual',
        },
      },
    ]);
  });

  test('detects semicolons and parses quoted delimiters, quotes, and multiline fields', () => {
    const result = parseClientCsv(
      'clientCode;name;fiscalCode;description\r\nCLI-1;"Acme; Italia";IT123;"Riga 1\nRiga ""2"""',
    );

    expect(result.fatalIssues).toEqual([]);
    expect(result.rowIssues).toEqual([]);
    expect(result.delimiter).toBe(';');
    expect(result.rows[0]?.client).toEqual({
      clientCode: 'CLI-1',
      name: 'Acme; Italia',
      fiscalCode: 'IT123',
      description: 'Riga 1\nRiga "2"',
    });
  });

  test('rejects an empty file and a header-only file does not produce importable rows', () => {
    expect(parseClientCsv('').fatalIssues.map((issue) => issue.code)).toContain('empty_file');

    const template = parseClientCsv(CLIENT_CSV_HEADERS.join(','));
    expect(template.fatalIssues).toEqual([]);
    expect(template.rows).toEqual([]);
    expect(template.totalDataRows).toBe(0);
  });

  test('rejects missing, unknown, duplicate, and case-mismatched headers', () => {
    const missing = parseClientCsv('clientCode,name\nCLI-1,Acme');
    expect(missing.fatalIssues).toContainEqual(expect.objectContaining({ code: 'missing_header' }));

    const unknown = parseClientCsv('clientCode,name,fiscalCode,unexpected\nCLI-1,Acme,IT123,x');
    expect(unknown.fatalIssues).toContainEqual(expect.objectContaining({ code: 'unknown_header' }));

    const duplicate = parseClientCsv('clientCode,name,fiscalCode,name\nCLI-1,Acme,IT123,Duplicate');
    expect(duplicate.fatalIssues).toContainEqual(
      expect.objectContaining({ code: 'duplicate_header' }),
    );

    const caseMismatch = parseClientCsv('ClientCode,name,fiscalCode\nCLI-1,Acme,IT123');
    expect(caseMismatch.fatalIssues.map((issue) => issue.code)).toContain('unknown_header');
    expect(caseMismatch.fatalIssues.map((issue) => issue.code)).toContain('missing_header');
  });

  test('trims header edges while keeping technical header casing strict', () => {
    const result = parseClientCsv(' clientCode , name , fiscalCode \n CLI-1 , Acme , IT123 ');
    expect(result.fatalIssues).toEqual([]);
    expect(result.rows[0]?.client).toEqual({
      clientCode: 'CLI-1',
      name: 'Acme',
      fiscalCode: 'IT123',
    });
  });

  test('discards structurally misaligned rows but keeps valid rows and their input indexes', () => {
    const result = parseClientCsv(
      'clientCode,name,fiscalCode\nCLI-1,Acme,IT123\nCLI-2,Missing\nCLI-3,Beta,IT456',
    );

    expect(result.fatalIssues).toEqual([]);
    expect(result.rowIssues).toEqual([
      expect.objectContaining({ line: 3, code: 'field_mismatch' }),
    ]);
    expect(result.rows.map((row) => row.line)).toEqual([2, 4]);
    expect(result.rows.map((row) => row.client.clientCode)).toEqual(['CLI-1', 'CLI-3']);
  });

  test(`rejects more than ${MAX_CLIENT_IMPORT_ROWS} data rows`, () => {
    const dataRows = Array.from(
      { length: MAX_CLIENT_IMPORT_ROWS + 1 },
      (_, index) => `CLI-${index},Client ${index},IT${index}`,
    );
    const result = parseClientCsv(['clientCode,name,fiscalCode', ...dataRows].join('\n'));

    expect(result.fatalIssues).toContainEqual(expect.objectContaining({ code: 'too_many_rows' }));
    expect(result.rows).toEqual([]);
  });
});
