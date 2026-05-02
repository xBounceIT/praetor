import { and, eq, ne, sql } from 'drizzle-orm';
import { type DbExecutor, db, executeRows } from '../db/drizzle.ts';
import { clients } from '../db/schema/clients.ts';
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

const formatAddress = ({
  civicNumber,
  line,
  cap,
  state,
  province,
  country,
}: {
  civicNumber: string | null;
  line: string | null;
  cap: string | null;
  state: string | null;
  province: string | null;
  country: string | null;
}) => {
  const street = [line, civicNumber].filter(Boolean).join(' ').trim();
  const locality = [cap, state].filter(Boolean).join(' ').trim();
  const provinceChunk = province ? `(${province})` : '';
  return [street, [locality, provinceChunk].filter(Boolean).join(' ').trim(), country]
    .filter((chunk) => chunk && chunk.trim().length > 0)
    .join(', ');
};

export const mapClientRow = (c: Record<string, unknown>): Client => {
  const fiscalCode = (c.fiscal_code as string | null) || null;
  const createdAt = c.created_at ? new Date(c.created_at as string).getTime() : undefined;
  const contacts = parseContactsFromDb(c.contacts);
  const primary = contacts[0] ?? null;

  const addressCountry = (c.address_country as string | null) || null;
  const addressState = (c.address_state as string | null) || null;
  const addressCap = (c.address_cap as string | null) || null;
  const addressProvince = (c.address_province as string | null) || null;
  const addressCivicNumber = (c.address_civic_number as string | null) || null;
  const addressLine = (c.address_line as string | null) || null;

  const computedAddress = formatAddress({
    civicNumber: addressCivicNumber,
    line: addressLine,
    cap: addressCap,
    state: addressState,
    province: addressProvince,
    country: addressCountry,
  });

  return {
    id: c.id as string,
    name: c.name as string,
    description: (c.description as string | null) ?? null,
    isDisabled: c.is_disabled as boolean,
    type: c.type as string,
    contacts,
    contactName: (c.contact_name as string | null) || primary?.fullName || null,
    clientCode: (c.client_code as string | null) ?? null,
    email: (c.email as string | null) || primary?.email || null,
    phone: (c.phone as string | null) || primary?.phone || null,
    address: (c.address as string | null) || computedAddress || null,
    addressCountry,
    addressState,
    addressCap,
    addressProvince,
    addressCivicNumber,
    addressLine,
    atecoCode: (c.ateco_code as string | null) ?? null,
    website: (c.website as string | null) ?? null,
    sector: (c.sector as string | null) ?? null,
    numberOfEmployees: (c.number_of_employees as string | null) ?? null,
    revenue: (c.revenue as string | null) ?? null,
    fiscalCode,
    officeCountRange: (c.office_count_range as string | null) ?? null,
    totalSentQuotes: parseDbNumber(c.total_sent_quotes as string | number | null, undefined),
    totalAcceptedOrders: parseDbNumber(
      c.total_accepted_orders as string | number | null,
      undefined,
    ),
    vatNumber: fiscalCode,
    taxCode: fiscalCode,
    createdAt,
  };
};

export type ListOptions =
  | { canViewAllClients: true }
  | { canViewAllClients: false; userId: string };

export const list = async (options: ListOptions, exec: DbExecutor = db): Promise<Client[]> => {
  if (options.canViewAllClients) {
    // Admin path: LEFT JOIN nested aggregates for total_sent_quotes / total_accepted_orders.
    // Lifted near-verbatim from the legacy SQL — the nested SUM/COALESCE shape is awkward in
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

  // User-scoped path: JOIN un-modeled user_clients. NULL placeholders for totals so
  // mapClientRow's parseDbNumber returns undefined.
  const rows = await executeRows<Record<string, unknown>>(
    exec,
    sql`SELECT c.id, c.name, c.description, c.is_disabled, c.type,
        c.contacts, c.contact_name, c.client_code, c.email, c.phone, c.address,
        c.address_country, c.address_state, c.address_cap, c.address_province,
        c.address_civic_number, c.address_line,
        c.ateco_code, c.website, c.sector, c.number_of_employees,
        c.revenue, c.fiscal_code, c.office_count_range, c.created_at,
        NULL::numeric as total_sent_quotes,
        NULL::numeric as total_accepted_orders
      FROM clients c
      INNER JOIN user_clients uc ON c.id = uc.client_id
      WHERE uc.user_id = ${options.userId}
      ORDER BY c.name`,
  );
  return rows.map(mapClientRow);
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
  const conditions = [eq(clients.clientCode, clientCode)];
  if (excludeId) conditions.push(ne(clients.id, excludeId));
  const rows = await exec
    .select({ id: clients.id })
    .from(clients)
    .where(and(...conditions))
    .limit(1);
  return rows.length > 0;
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
  // flag = explicit set). The structure is preserved as-is via executeRows — rewriting in
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
