import { beforeEach, describe, expect, test } from 'bun:test';
import type { DbExecutor } from '../../db/drizzle.ts';
import * as clientsRepo from '../../repositories/clientsRepo.ts';
import { type FakeExecutor, makeRow, setupTestDb } from '../helpers/fakeExecutor.ts';

let exec: FakeExecutor;
let testDb: DbExecutor;

beforeEach(() => {
  ({ exec, testDb } = setupTestDb());
});

const baseRow = {
  id: 'c-1',
  name: 'Acme',
  description: 'desc',
  is_disabled: false,
  type: 'company',
  contacts: [{ fullName: 'Alice', email: 'a@x.com', phone: '555', role: 'CEO' }],
  contact_name: null,
  client_code: 'AC-1',
  email: null,
  phone: null,
  address: null,
  address_country: 'IT',
  address_state: null,
  address_cap: '00100',
  address_province: 'RM',
  address_civic_number: '10',
  address_line: 'Via Roma',
  ateco_code: '12.34',
  website: 'https://acme.test',
  sector: 'tech',
  number_of_employees: '10-50',
  revenue: '1M-5M',
  fiscal_code: 'IT12345',
  office_count_range: '1',
  total_sent_quotes: '500',
  total_accepted_orders: '1500.5',
  created_at: '2026-01-15T00:00:00Z',
};

// Schema column declaration order for builder INSERT/RETURNING (.returning() with no
// projection returns all schema columns in declaration order):
//
// id, name, is_disabled, created_at, type, contact_name, client_code, email, phone,
// address, description, ateco_code, website, sector, number_of_employees, revenue,
// fiscal_code, office_count_range, contacts, address_country, address_state, address_cap,
// address_province, address_civic_number, address_line
const POSITIONAL_CLIENT_ROW: readonly unknown[] = [
  'c-1',
  'Acme',
  false,
  new Date('2026-01-15T00:00:00Z'),
  'company',
  null, // contact_name
  'AC-1',
  null, // email
  null, // phone
  null, // address
  'desc',
  '12.34',
  'https://acme.test',
  'tech',
  '10-50',
  '1M-5M',
  'IT12345',
  '1',
  [{ fullName: 'Alice', email: 'a@x.com', phone: '555', role: 'CEO' }],
  'IT',
  null, // address_state
  '00100',
  'RM',
  '10',
  'Via Roma',
];

describe('mapClientRow', () => {
  test('parses contacts JSONB and falls back to primary contact for primary fields', () => {
    const result = clientsRepo.mapClientRow(baseRow);
    expect(result.contacts).toEqual([
      { fullName: 'Alice', role: 'CEO', email: 'a@x.com', phone: '555' },
    ]);
    expect(result.contactName).toBe('Alice');
    expect(result.email).toBe('a@x.com');
    expect(result.phone).toBe('555');
  });

  test('uses explicit contact_name/email/phone when set, ignoring primary contact', () => {
    const result = clientsRepo.mapClientRow({
      ...baseRow,
      contact_name: 'Bob',
      email: 'b@x.com',
      phone: '999',
    });
    expect(result.contactName).toBe('Bob');
    expect(result.email).toBe('b@x.com');
    expect(result.phone).toBe('999');
  });

  test('computes formatted address when no explicit address provided', () => {
    const result = clientsRepo.mapClientRow(baseRow);
    expect(result.address).toContain('Via Roma');
    expect(result.address).toContain('00100');
    expect(result.address).toContain('IT');
  });

  test('parses numeric totals from string DB output', () => {
    const result = clientsRepo.mapClientRow(baseRow);
    expect(result.totalSentQuotes).toBe(500);
    expect(result.totalAcceptedOrders).toBe(1500.5);
  });

  test('returns undefined totals when fields are NULL', () => {
    const result = clientsRepo.mapClientRow({
      ...baseRow,
      total_sent_quotes: null,
      total_accepted_orders: null,
    });
    expect(result.totalSentQuotes).toBeUndefined();
    expect(result.totalAcceptedOrders).toBeUndefined();
  });

  test('mirrors fiscalCode into vatNumber and taxCode', () => {
    const result = clientsRepo.mapClientRow(baseRow);
    expect(result.vatNumber).toBe('IT12345');
    expect(result.taxCode).toBe('IT12345');
  });
});

describe('list', () => {
  test('runs the privileged query with no params when canViewAllClients=true', async () => {
    exec.enqueue({ rows: [baseRow] });
    const result = await clientsRepo.list({ canViewAllClients: true }, testDb);
    expect(exec.calls[0].sql).toContain('LEFT JOIN');
    expect(exec.calls[0].sql).toContain('total_sent_quotes');
    expect(exec.calls[0].params).toEqual([]);
    expect(result[0].id).toBe('c-1');
  });

  test('runs the restricted query with userId param when canViewAllClients=false', async () => {
    exec.enqueue({ rows: [{ ...baseRow, total_sent_quotes: null, total_accepted_orders: null }] });
    const result = await clientsRepo.list({ canViewAllClients: false, userId: 'u-1' }, testDb);
    expect(exec.calls[0].sql).toContain('INNER JOIN user_clients');
    expect(exec.calls[0].sql).toContain('uc.user_id =');
    expect(exec.calls[0].params).toContain('u-1');
    expect(result[0].totalSentQuotes).toBeUndefined();
  });
});

describe('findContactsForUpdate', () => {
  test('returns parsed contacts when client exists', async () => {
    exec.enqueue({ rows: [[[{ fullName: 'A' }]]] });
    const result = await clientsRepo.findContactsForUpdate('c-1', testDb);
    expect(result).toEqual({ contacts: [{ fullName: 'A' }] });
  });

  test('returns null when client not found', async () => {
    exec.enqueue({ rows: [] });
    const result = await clientsRepo.findContactsForUpdate('c-x', testDb);
    expect(result).toBeNull();
  });
});

describe('existsById', () => {
  test('returns true when a client row exists', async () => {
    exec.enqueue({ rows: [['c-1']] });
    expect(await clientsRepo.existsById('c-1', testDb)).toBe(true);
    expect(exec.calls[0].params).toContain('c-1');
  });

  test('returns false when a client row is missing', async () => {
    exec.enqueue({ rows: [] });
    expect(await clientsRepo.existsById('c-x', testDb)).toBe(false);
  });
});

describe('findByFiscalCode', () => {
  test('queries with LOWER for case-insensitive match without exclude', async () => {
    exec.enqueue({ rows: [['c-1']] });
    const result = await clientsRepo.findByFiscalCode('IT123', null, testDb);
    expect(exec.calls[0].sql.toLowerCase()).toContain('lower(');
    expect(exec.calls[0].sql).not.toMatch(/"id"\s*<>/);
    expect(exec.calls[0].params).toContain('IT123');
    expect(result).toBe(true);
  });

  test('adds id <> clause when excludeId provided', async () => {
    exec.enqueue({ rows: [] });
    await clientsRepo.findByFiscalCode('IT123', 'c-1', testDb);
    expect(exec.calls[0].sql).toMatch(/"id"\s*<>/);
    expect(exec.calls[0].params).toContain('IT123');
    expect(exec.calls[0].params).toContain('c-1');
  });
});

describe('findByClientCode', () => {
  test('respects excludeId parameter', async () => {
    exec.enqueue({ rows: [] });
    await clientsRepo.findByClientCode('AC-1', 'c-1', testDb);
    const sql = exec.calls[0].sql.toLowerCase();
    expect(sql).toContain('"client_code"');
    expect(sql).toMatch(/"id"\s*<>/);
    expect(exec.calls[0].params).toContain('AC-1');
    expect(exec.calls[0].params).toContain('c-1');
  });
});

describe('create', () => {
  test('inserts client and returns the mapped row', async () => {
    exec.enqueue({ rows: [makeRow(POSITIONAL_CLIENT_ROW)] });
    const result = await clientsRepo.create(
      {
        id: 'c-1',
        name: 'Acme',
        type: 'company',
        contacts: [{ fullName: 'Alice' }],
        contactName: 'Alice',
        clientCode: 'AC-1',
        email: 'a@x.com',
        phone: null,
        address: null,
        addressCountry: 'IT',
        addressState: null,
        addressCap: null,
        addressProvince: null,
        addressCivicNumber: null,
        addressLine: null,
        description: null,
        atecoCode: null,
        website: null,
        sector: null,
        numberOfEmployees: null,
        revenue: null,
        fiscalCode: 'IT12345',
        officeCountRange: null,
      },
      testDb,
    );
    expect(exec.calls[0].sql.toLowerCase()).toContain('insert into "clients"');
    expect(exec.calls[0].params).toContain('c-1');
    expect(exec.calls[0].params).toContain(false);
    expect(exec.calls[0].params).toContain('IT12345');
    // Drizzle's jsonb encoder serializes JS arrays to JSON strings before passing to pg.
    expect(exec.calls[0].params).toContain('[{"fullName":"Alice"}]');
    expect(result.id).toBe('c-1');
  });
});

describe('update', () => {
  test('passes provided fields with CASE WHEN flags', async () => {
    exec.enqueue({ rows: [baseRow] });
    await clientsRepo.update(
      'c-1',
      {
        name: 'New',
        isDisabled: null,
        type: null,
        contacts: null,
        clientCode: null,
        address: null,
        addressCountry: null,
        addressState: null,
        addressCap: null,
        addressProvince: null,
        addressCivicNumber: null,
        addressLine: null,
        description: null,
        atecoCode: null,
        website: null,
        fiscalCode: null,
        contactName: 'X',
        contactNameProvided: true,
        email: null,
        emailProvided: false,
        phone: null,
        phoneProvided: false,
        sector: 'tech',
        sectorProvided: true,
        numberOfEmployees: null,
        numberOfEmployeesProvided: false,
        revenue: null,
        revenueProvided: false,
        officeCountRange: null,
        officeCountRangeProvided: false,
      },
      testDb,
    );
    expect(exec.calls[0].sql).toContain('CASE WHEN');
    expect(exec.calls[0].sql).toContain('COALESCE');
    expect(exec.calls[0].params).toHaveLength(31);
    expect(exec.calls[0].params).toContain('New'); // name
    expect(exec.calls[0].params).toContain('c-1'); // where id
    expect(exec.calls[0].params).toContain('X'); // contactName
    expect(exec.calls[0].params).toContain(true); // contactNameProvided / sectorProvided
    expect(exec.calls[0].params).toContain('tech');
  });

  test('JSON-stringifies contacts when present, passes null otherwise', async () => {
    exec.enqueue({ rows: [baseRow] });
    const baseUpdate: clientsRepo.ClientUpdate = {
      name: null,
      isDisabled: null,
      type: null,
      contacts: [{ fullName: 'A' }],
      clientCode: null,
      address: null,
      addressCountry: null,
      addressState: null,
      addressCap: null,
      addressProvince: null,
      addressCivicNumber: null,
      addressLine: null,
      description: null,
      atecoCode: null,
      website: null,
      fiscalCode: null,
      contactName: null,
      contactNameProvided: false,
      email: null,
      emailProvided: false,
      phone: null,
      phoneProvided: false,
      sector: null,
      sectorProvided: false,
      numberOfEmployees: null,
      numberOfEmployeesProvided: false,
      revenue: null,
      revenueProvided: false,
      officeCountRange: null,
      officeCountRangeProvided: false,
    };
    await clientsRepo.update('c-1', baseUpdate, testDb);
    expect(exec.calls[0].params).toContain('[{"fullName":"A"}]');
  });

  test('returns null when no row was updated', async () => {
    exec.enqueue({ rows: [] });
    const result = await clientsRepo.update(
      'c-x',
      {
        name: null,
        isDisabled: null,
        type: null,
        contacts: null,
        clientCode: null,
        address: null,
        addressCountry: null,
        addressState: null,
        addressCap: null,
        addressProvince: null,
        addressCivicNumber: null,
        addressLine: null,
        description: null,
        atecoCode: null,
        website: null,
        fiscalCode: null,
        contactName: null,
        contactNameProvided: false,
        email: null,
        emailProvided: false,
        phone: null,
        phoneProvided: false,
        sector: null,
        sectorProvided: false,
        numberOfEmployees: null,
        numberOfEmployeesProvided: false,
        revenue: null,
        revenueProvided: false,
        officeCountRange: null,
        officeCountRangeProvided: false,
      },
      testDb,
    );
    expect(result).toBeNull();
  });
});

describe('deleteById', () => {
  test('returns id, name, clientCode when row deleted', async () => {
    exec.enqueue({ rows: [['c-1', 'Acme', 'AC-1']] });
    expect(await clientsRepo.deleteById('c-1', testDb)).toEqual({
      id: 'c-1',
      name: 'Acme',
      clientCode: 'AC-1',
    });
  });

  test('returns null when no row deleted', async () => {
    exec.enqueue({ rows: [] });
    expect(await clientsRepo.deleteById('c-x', testDb)).toBeNull();
  });
});
