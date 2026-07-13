import { and, eq, ne, type SQL, sql } from 'drizzle-orm';
import { type DbExecutor, db, executeRows } from '../db/drizzle.ts';
import { clients } from '../db/schema/clients.ts';
import { formatClientAddress } from '../utils/client-address.ts';
import { getUniqueViolation } from '../utils/db-errors.ts';
import { parseDbNumber } from '../utils/parse.ts';

export type ClientContact = {
  fullName: string;
  role?: string;
  email?: string;
  phone?: string;
};

export type Client = {
  id: string;
  name: string;
  description: string | null;
  isDisabled: boolean;
  type: string;
  contacts: ClientContact[];
  contactName: string | null;
  clientCode: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  addressCountry: string | null;
  addressState: string | null;
  addressCap: string | null;
  addressProvince: string | null;
  addressCivicNumber: string | null;
  addressLine: string | null;
  atecoCode: string | null;
  website: string | null;
  sector: string | null;
  numberOfEmployees: string | null;
  revenue: string | null;
  fiscalCode: string | null;
  officeCountRange: string | null;
  totalSentQuotes: number | undefined;
  totalAcceptedOrders: number | undefined;
  vatNumber: string | null;
  taxCode: string | null;
  createdAt: number | undefined;
};

export type ClientUniqueViolationKind = 'fiscal_code' | 'client_code';

// Decouples callers from raw Postgres index names.
export const classifyUniqueViolation = (err: unknown): ClientUniqueViolationKind | null => {
  const dup = getUniqueViolation(err);
  if (!dup) return null;
  if (dup.constraint === 'idx_clients_client_code_unique') return 'client_code';
  if (dup.constraint === 'idx_clients_fiscal_code_unique') return 'fiscal_code';
  if (dup.detail?.includes('client_code')) return 'client_code';
  return 'fiscal_code';
};

const parseContactsFromDb = (value: unknown): ClientContact[] => {
  if (!Array.isArray(value)) return [];
  const contacts: ClientContact[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const fullName =
      typeof item.fullName === 'string'
        ? item.fullName.trim()
        : typeof item.name === 'string'
          ? item.name.trim()
          : '';
    if (!fullName) continue;
    const role = typeof item.role === 'string' ? item.role.trim() : '';
    const email = typeof item.email === 'string' ? item.email.trim() : '';
    const phone = typeof item.phone === 'string' ? item.phone.trim() : '';
    contacts.push({
      fullName,
      role: role || undefined,
      email: email || undefined,
      phone: phone || undefined,
    });
  }
  return contacts;
};

// Safely coerce a raw column value to `string | null`. Anything that is not a string
// becomes null, which is preferable to the legacy `as string | null` casts that could
// surface `undefined` or non-string DB types as the literal `"undefined"` downstream.
const stringOrNull = (value: unknown): string | null => (typeof value === 'string' ? value : null);

const parseCreatedAt = (value: unknown): number | undefined => {
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isFinite(t) ? t : undefined;
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const t = new Date(value).getTime();
    return Number.isFinite(t) ? t : undefined;
  }
  return undefined;
};

export const mapClientRow = (c: Record<string, unknown>): Client => {
  const fiscalCode = stringOrNull(c.fiscal_code);
  // Read independent columns; do NOT fall back to fiscal_code (the old behavior produced
  // identical vatNumber/taxCode/fiscalCode for every client). Migration 0033 backfilled
  // vat_number from fiscal_code for company rows and tax_code from fiscal_code for
  // individual rows.
  const vatNumber = stringOrNull(c.vat_number);
  const taxCode = stringOrNull(c.tax_code);
  const createdAt = parseCreatedAt(c.created_at);
  const contacts = parseContactsFromDb(c.contacts);
  const primary = contacts[0] ?? null;

  const addressCountry = stringOrNull(c.address_country);
  const addressState = stringOrNull(c.address_state);
  const addressCap = stringOrNull(c.address_cap);
  const addressProvince = stringOrNull(c.address_province);
  const addressCivicNumber = stringOrNull(c.address_civic_number);
  const addressLine = stringOrNull(c.address_line);

  const address =
    stringOrNull(c.address) ||
    formatClientAddress({
      civicNumber: addressCivicNumber,
      line: addressLine,
      cap: addressCap,
      state: addressState,
      province: addressProvince,
      country: addressCountry,
    }) ||
    null;

  return {
    id: typeof c.id === 'string' ? c.id : '',
    name: typeof c.name === 'string' ? c.name : '',
    description: stringOrNull(c.description),
    isDisabled: c.is_disabled === true,
    type: typeof c.type === 'string' ? c.type : '',
    contacts,
    contactName: stringOrNull(c.contact_name) || primary?.fullName || null,
    clientCode: stringOrNull(c.client_code),
    email: stringOrNull(c.email) || primary?.email || null,
    phone: stringOrNull(c.phone) || primary?.phone || null,
    address,
    addressCountry,
    addressState,
    addressCap,
    addressProvince,
    addressCivicNumber,
    addressLine,
    atecoCode: stringOrNull(c.ateco_code),
    website: stringOrNull(c.website),
    sector: stringOrNull(c.sector),
    numberOfEmployees: stringOrNull(c.number_of_employees),
    revenue: stringOrNull(c.revenue),
    fiscalCode,
    officeCountRange: stringOrNull(c.office_count_range),
    totalSentQuotes: parseDbNumber(
      typeof c.total_sent_quotes === 'string' || typeof c.total_sent_quotes === 'number'
        ? c.total_sent_quotes
        : null,
      undefined,
    ),
    totalAcceptedOrders: parseDbNumber(
      typeof c.total_accepted_orders === 'string' || typeof c.total_accepted_orders === 'number'
        ? c.total_accepted_orders
        : null,
      undefined,
    ),
    vatNumber,
    taxCode,
    createdAt,
  };
};

export type ListOptions =
  | { canViewAllClients: true }
  | { canViewAllClients: false; userId: string };

export const list = async (options: ListOptions, exec: DbExecutor = db): Promise<Client[]> => {
  if (options.canViewAllClients) {
    // Admin path: LEFT JOIN nested aggregates for total_sent_quotes / total_accepted_orders.
    // Lifted near-verbatim from the legacy SQL - the nested SUM/COALESCE shape is awkward in
    // the query builder and the existing query is well-tested.
    const rows = await executeRows<Record<string, unknown>>(
      exec,
      sql`SELECT c.*,
          COALESCE(sq.total_sent_quotes, 0) as total_sent_quotes,
          COALESCE(so.total_accepted_orders, 0) as total_accepted_orders
        FROM clients c
        LEFT JOIN (
          SELECT q.client_id,
            SUM(
              (SELECT COALESCE(SUM(qi.quantity * qi.unit_price * (1 - COALESCE(qi.discount, 0) / 100.0)), 0)
               FROM quote_items qi WHERE qi.quote_id = q.id)
              * (1 - COALESCE(q.discount, 0) / 100.0)
            ) as total_sent_quotes
          FROM quotes q
          WHERE q.status = 'sent'
          GROUP BY q.client_id
        ) sq ON sq.client_id = c.id
        LEFT JOIN (
          SELECT s.client_id,
            SUM(
              (SELECT COALESCE(SUM(si.quantity * si.unit_price * (1 - COALESCE(si.discount, 0) / 100.0)), 0)
               FROM sale_items si WHERE si.sale_id = s.id)
              * (1 - COALESCE(s.discount, 0) / 100.0)
            ) as total_accepted_orders
          FROM sales s
          WHERE s.status = 'confirmed'
          GROUP BY s.client_id
        ) so ON so.client_id = c.id
        ORDER BY c.name`,
    );
    return rows.map(mapClientRow);
  }

  const rows = await executeRows<Record<string, unknown>>(
    exec,
    sql`SELECT c.id, c.name, c.description, c.is_disabled, c.type,
        c.contacts, c.contact_name, c.client_code, c.email, c.phone, c.address,
        c.address_country, c.address_state, c.address_cap, c.address_province,
        c.address_civic_number, c.address_line,
        c.ateco_code, c.website, c.sector, c.number_of_employees,
        c.revenue, c.fiscal_code, c.vat_number, c.tax_code,
        c.office_count_range, c.created_at,
        NULL::numeric as total_sent_quotes,
        NULL::numeric as total_accepted_orders
      FROM clients c
      INNER JOIN user_clients uc ON c.id = uc.client_id
      WHERE uc.user_id = ${options.userId}
      ORDER BY c.name`,
  );
  return rows.map(mapClientRow);
};

export const listByIds = async (
  ids: string[],
  exec: DbExecutor = db,
): Promise<Map<string, Client>> => {
  if (ids.length === 0) return new Map();

  const rows = await executeRows<Record<string, unknown>>(
    exec,
    sql`SELECT c.*,
        NULL::numeric as total_sent_quotes,
        NULL::numeric as total_accepted_orders
      FROM clients c
      WHERE c.id = ANY(${ids})
      ORDER BY c.name`,
  );
  return new Map(
    rows.map((row) => {
      const client = mapClientRow(row);
      return [client.id, client];
    }),
  );
};

export const findContactsForUpdate = async (
  id: string,
  exec: DbExecutor = db,
): Promise<{ contacts: ClientContact[] } | null> => {
  const rows = await exec
    .select({ contacts: clients.contacts })
    .from(clients)
    .where(eq(clients.id, id));
  if (rows.length === 0) return null;
  return { contacts: parseContactsFromDb(rows[0].contacts) };
};

export const existsById = async (id: string, exec: DbExecutor = db): Promise<boolean> => {
  const rows = await exec.select({ id: clients.id }).from(clients).where(eq(clients.id, id));
  return rows.length > 0;
};

export const findName = async (id: string, exec: DbExecutor = db): Promise<string | null> => {
  const rows = await exec.select({ name: clients.name }).from(clients).where(eq(clients.id, id));
  return rows[0]?.name ?? null;
};

export const findByFiscalCode = async (
  fiscalCode: string,
  excludeId: string | null,
  exec: DbExecutor = db,
): Promise<boolean> => {
  const conditions = [sql`LOWER(${clients.fiscalCode}) = LOWER(${fiscalCode})`];
  if (excludeId) conditions.push(ne(clients.id, excludeId));
  const rows = await exec
    .select({ id: clients.id })
    .from(clients)
    .where(and(...conditions))
    .limit(1);
  return rows.length > 0;
};

export const findByClientCode = async (
  clientCode: string,
  excludeId: string | null,
  exec: DbExecutor = db,
): Promise<boolean> => {
  const conditions = [sql`LOWER(${clients.clientCode}) = LOWER(${clientCode})`];
  if (excludeId) conditions.push(ne(clients.id, excludeId));
  const rows = await exec
    .select({ id: clients.id })
    .from(clients)
    .where(and(...conditions))
    .limit(1);
  return rows.length > 0;
};

export const findExistingIdentifiers = async (
  clientCodes: string[],
  fiscalCodes: string[],
  exec: DbExecutor = db,
): Promise<{ clientCodes: Set<string>; fiscalCodes: Set<string> }> => {
  const normalizedClientCodes = [...new Set(clientCodes.map((value) => value.toLowerCase()))];
  const normalizedFiscalCodes = [...new Set(fiscalCodes.map((value) => value.toLowerCase()))];
  if (normalizedClientCodes.length === 0 && normalizedFiscalCodes.length === 0) {
    return { clientCodes: new Set(), fiscalCodes: new Set() };
  }

  const conditions: SQL[] = [];
  if (normalizedClientCodes.length > 0) {
    conditions.push(sql`LOWER(client_code) = ANY(${sql.param(normalizedClientCodes)}::text[])`);
  }
  if (normalizedFiscalCodes.length > 0) {
    conditions.push(sql`LOWER(fiscal_code) = ANY(${sql.param(normalizedFiscalCodes)}::text[])`);
  }

  const rows = await executeRows<{ client_code: string | null; fiscal_code: string | null }>(
    exec,
    sql`SELECT client_code, fiscal_code
        FROM clients
        WHERE ${sql.join(conditions, sql` OR `)}`,
  );

  return {
    clientCodes: new Set(
      rows
        .map((row) => row.client_code?.toLowerCase())
        .filter((value): value is string => Boolean(value)),
    ),
    fiscalCodes: new Set(
      rows
        .map((row) => row.fiscal_code?.toLowerCase())
        .filter((value): value is string => Boolean(value)),
    ),
  };
};

export type NewClient = {
  id: string;
  name: string;
  type: string;
  contacts: ClientContact[];
  contactName: string | null;
  clientCode: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  addressCountry: string | null;
  addressState: string | null;
  addressCap: string | null;
  addressProvince: string | null;
  addressCivicNumber: string | null;
  addressLine: string | null;
  description: string | null;
  atecoCode: string | null;
  website: string | null;
  sector: string | null;
  numberOfEmployees: string | null;
  revenue: string | null;
  fiscalCode: string;
  vatNumber: string | null;
  taxCode: string | null;
  officeCountRange: string | null;
};

export const create = async (input: NewClient, exec: DbExecutor = db): Promise<Client> => {
  const rows = await exec
    .insert(clients)
    .values({
      id: input.id,
      name: input.name,
      isDisabled: false,
      type: input.type,
      contacts: input.contacts,
      contactName: input.contactName,
      clientCode: input.clientCode,
      email: input.email,
      phone: input.phone,
      address: input.address,
      addressCountry: input.addressCountry,
      addressState: input.addressState,
      addressCap: input.addressCap,
      addressProvince: input.addressProvince,
      addressCivicNumber: input.addressCivicNumber,
      addressLine: input.addressLine,
      description: input.description,
      atecoCode: input.atecoCode,
      website: input.website,
      sector: input.sector,
      numberOfEmployees: input.numberOfEmployees,
      revenue: input.revenue,
      fiscalCode: input.fiscalCode,
      vatNumber: input.vatNumber,
      taxCode: input.taxCode,
      officeCountRange: input.officeCountRange,
    })
    .returning();
  // Re-shape Drizzle's $inferSelect into the snake_case Record<string, unknown> that
  // mapClientRow expects. mapClientRow is shared with the executeRows-based paths above,
  // which receive raw snake_case rows.
  const row = rows[0];
  return mapClientRow({
    id: row.id,
    name: row.name,
    is_disabled: row.isDisabled,
    created_at: row.createdAt,
    type: row.type,
    contact_name: row.contactName,
    client_code: row.clientCode,
    email: row.email,
    phone: row.phone,
    address: row.address,
    description: row.description,
    ateco_code: row.atecoCode,
    website: row.website,
    sector: row.sector,
    number_of_employees: row.numberOfEmployees,
    revenue: row.revenue,
    fiscal_code: row.fiscalCode,
    vat_number: row.vatNumber,
    tax_code: row.taxCode,
    office_count_range: row.officeCountRange,
    contacts: row.contacts,
    address_country: row.addressCountry,
    address_state: row.addressState,
    address_cap: row.addressCap,
    address_province: row.addressProvince,
    address_civic_number: row.addressCivicNumber,
    address_line: row.addressLine,
  });
};

export type ClientUpdate = {
  // COALESCE fields (null = keep existing)
  name: string | null;
  isDisabled: boolean | null;
  type: string | null;
  contacts: ClientContact[] | null;
  clientCode: string | null;
  address: string | null;
  addressCountry: string | null;
  addressState: string | null;
  addressCap: string | null;
  addressProvince: string | null;
  addressCivicNumber: string | null;
  addressLine: string | null;
  description: string | null;
  atecoCode: string | null;
  website: string | null;
  fiscalCode: string | null;
  // CASE WHEN fields (set when *Provided is true)
  vatNumber: string | null;
  vatNumberProvided: boolean;
  taxCode: string | null;
  taxCodeProvided: boolean;
  contactName: string | null;
  contactNameProvided: boolean;
  email: string | null;
  emailProvided: boolean;
  phone: string | null;
  phoneProvided: boolean;
  sector: string | null;
  sectorProvided: boolean;
  numberOfEmployees: string | null;
  numberOfEmployeesProvided: boolean;
  revenue: string | null;
  revenueProvided: boolean;
  officeCountRange: string | null;
  officeCountRangeProvided: boolean;
};

export const update = async (
  id: string,
  patch: ClientUpdate,
  exec: DbExecutor = db,
): Promise<Client | null> => {
  // The COALESCE/CASE WHEN hybrid encodes two separate semantics (null = keep, *Provided
  // flag = explicit set). The structure is preserved as-is via executeRows - rewriting in
  // the builder would obscure the dual semantics encoded in the ClientUpdate type.
  const contactsJson = patch.contacts === null ? null : JSON.stringify(patch.contacts);
  const rows = await executeRows<Record<string, unknown>>(
    exec,
    sql`UPDATE clients SET
        name = COALESCE(${patch.name}, name),
        is_disabled = COALESCE(${patch.isDisabled}, is_disabled),
        type = COALESCE(${patch.type}, type),
        contacts = COALESCE(${contactsJson}::jsonb, contacts),
        contact_name = CASE WHEN ${patch.contactNameProvided} THEN ${patch.contactName} ELSE contact_name END,
        client_code = COALESCE(${patch.clientCode}, client_code),
        email = CASE WHEN ${patch.emailProvided} THEN ${patch.email} ELSE email END,
        phone = CASE WHEN ${patch.phoneProvided} THEN ${patch.phone} ELSE phone END,
        address = COALESCE(${patch.address}, address),
        address_country = COALESCE(${patch.addressCountry}, address_country),
        address_state = COALESCE(${patch.addressState}, address_state),
        address_cap = COALESCE(${patch.addressCap}, address_cap),
        address_province = COALESCE(${patch.addressProvince}, address_province),
        address_civic_number = COALESCE(${patch.addressCivicNumber}, address_civic_number),
        address_line = COALESCE(${patch.addressLine}, address_line),
        description = COALESCE(${patch.description}, description),
        ateco_code = COALESCE(${patch.atecoCode}, ateco_code),
        website = COALESCE(${patch.website}, website),
        sector = CASE WHEN ${patch.sectorProvided} THEN ${patch.sector} ELSE sector END,
        number_of_employees = CASE WHEN ${patch.numberOfEmployeesProvided} THEN ${patch.numberOfEmployees} ELSE number_of_employees END,
        revenue = CASE WHEN ${patch.revenueProvided} THEN ${patch.revenue} ELSE revenue END,
        fiscal_code = COALESCE(${patch.fiscalCode}, fiscal_code),
        vat_number = CASE WHEN ${patch.vatNumberProvided} THEN ${patch.vatNumber} ELSE vat_number END,
        tax_code = CASE WHEN ${patch.taxCodeProvided} THEN ${patch.taxCode} ELSE tax_code END,
        office_count_range = CASE WHEN ${patch.officeCountRangeProvided} THEN ${patch.officeCountRange} ELSE office_count_range END
      WHERE id = ${id}
      RETURNING *`,
  );
  return rows[0] ? mapClientRow(rows[0]) : null;
};

export const deleteById = async (
  id: string,
  exec: DbExecutor = db,
): Promise<{ id: string; name: string; clientCode: string | null } | null> => {
  const rows = await exec
    .delete(clients)
    .where(eq(clients.id, id))
    .returning({ id: clients.id, name: clients.name, clientCode: clients.clientCode });
  if (!rows[0]) return null;
  return { id: rows[0].id, name: rows[0].name, clientCode: rows[0].clientCode };
};
