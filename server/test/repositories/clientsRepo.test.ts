import { beforeEach, describe, expect, test } from 'bun:test';
import * as clientsRepo from '../../repositories/clientsRepo.ts';
import { type FakeExecutor, makeFakeExecutor } from '../helpers/fakeExecutor.ts';

let exec: FakeExecutor;

beforeEach(() => {
  exec = makeFakeExecutor();
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
    const result = await clientsRepo.list({ canViewAllClients: true }, exec);
    expect(exec.calls[0].sql).toContain('LEFT JOIN');
    expect(exec.calls[0].sql).toContain('total_sent_quotes');
    expect(exec.calls[0].params).toEqual([]);
    expect(result[0].id).toBe('c-1');
  });

  test('runs the restricted query with userId param when canViewAllClients=false', async () => {
    exec.enqueue({ rows: [{ ...baseRow, total_sent_quotes: null, total_accepted_orders: null }] });
    const result = await clientsRepo.list({ canViewAllClients: false, userId: 'u-1' }, exec);
    expect(exec.calls[0].sql).toContain('INNER JOIN user_clients');
    expect(exec.calls[0].sql).toContain('WHERE uc.user_id = $1');
    expect(exec.calls[0].params).toEqual(['u-1']);
    expect(result[0].totalSentQuotes).toBeUndefined();
  });
});

describe('findContactsForUpdate', () => {
  test('returns parsed contacts when client exists', async () => {
    exec.enqueue({ rows: [{ contacts: [{ fullName: 'A' }] }] });
    const result = await clientsRepo.findContactsForUpdate('c-1', exec);
    expect(result).toEqual({ contacts: [{ fullName: 'A' }] });
  });

  test('returns null when client not found', async () => {
    exec.enqueue({ rows: [] });
    const result = await clientsRepo.findContactsForUpdate('c-x', exec);
    expect(result).toBeNull();
  });
});

describe('findByFiscalCode', () => {
  test('queries with LOWER for case-insensitive match without exclude', async () => {
    exec.enqueue({ rows: [{ id: 'c-1' }] });
    const result = await clientsRepo.findByFiscalCode('IT123', null, exec);
    expect(exec.calls[0].sql).toContain('LOWER(fiscal_code) = LOWER($1)');
    expect(exec.calls[0].sql).not.toContain('id <>');
    expect(exec.calls[0].params).toEqual(['IT123']);
    expect(result).toBe(true);
  });

  test('adds id <> $2 clause when excludeId provided', async () => {
    exec.enqueue({ rows: [] });
    await clientsRepo.findByFiscalCode('IT123', 'c-1', exec);
    expect(exec.calls[0].sql).toContain('id <> $2');
    expect(exec.calls[0].params).toEqual(['IT123', 'c-1']);
  });
});

describe('findByClientCode', () => {
  test('respects excludeId parameter', async () => {
    exec.enqueue({ rows: [] });
    await clientsRepo.findByClientCode('AC-1', 'c-1', exec);
    expect(exec.calls[0].sql).toContain('client_code = $1');
    expect(exec.calls[0].sql).toContain('id <> $2');
    expect(exec.calls[0].params).toEqual(['AC-1', 'c-1']);
  });
});

describe('create', () => {
  test('inserts 24 fields with stringified contacts JSON', async () => {
    exec.enqueue({ rows: [baseRow] });
    await clientsRepo.create(
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
      exec,
    );
    expect(exec.calls[0].sql).toContain('INSERT INTO clients');
    expect(exec.calls[0].params).toHaveLength(24);
    expect(exec.calls[0].params[0]).toBe('c-1');
    expect(exec.calls[0].params[2]).toBe(false); // is_disabled
    expect(exec.calls[0].params[4]).toBe('[{"fullName":"Alice"}]'); // contacts JSON
  });
});

describe('update', () => {
  test('passes 31 params including 7 boolean CASE WHEN flags', async () => {
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
      exec,
    );
    expect(exec.calls[0].sql).toContain('CASE WHEN $25');
    expect(exec.calls[0].sql).toContain('CASE WHEN $28');
    expect(exec.calls[0].params).toHaveLength(31);
    expect(exec.calls[0].params[0]).toBe('New'); // name
    expect(exec.calls[0].params[23]).toBe('c-1'); // where id
    expect(exec.calls[0].params[24]).toBe(true); // contactNameProvided
    expect(exec.calls[0].params[25]).toBe(false); // emailProvided
    expect(exec.calls[0].params[27]).toBe(true); // sectorProvided
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
    await clientsRepo.update('c-1', baseUpdate, exec);
    expect(exec.calls[0].params[3]).toBe('[{"fullName":"A"}]');
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
      exec,
    );
    expect(result).toBeNull();
  });
});

describe('deleteById', () => {
  test('returns id, name, clientCode when row deleted', async () => {
    exec.enqueue({ rows: [{ id: 'c-1', name: 'Acme', client_code: 'AC-1' }] });
    expect(await clientsRepo.deleteById('c-1', exec)).toEqual({
      id: 'c-1',
      name: 'Acme',
      clientCode: 'AC-1',
    });
  });

  test('returns null when no row deleted', async () => {
    exec.enqueue({ rows: [] });
    expect(await clientsRepo.deleteById('c-x', exec)).toBeNull();
  });
});
