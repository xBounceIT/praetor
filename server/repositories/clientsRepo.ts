import pool, { type QueryExecutor } from '../db/index.ts';
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

export const list = async (options: ListOptions, exec: QueryExecutor = pool): Promise<Client[]> => {
  if (options.canViewAllClients) {
    const { rows } = await exec.query(
      `SELECT c.*,
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

  const { rows } = await exec.query(
    `SELECT c.id, c.name, c.description, c.is_disabled, c.type,
        c.contacts, c.contact_name, c.client_code, c.email, c.phone, c.address,
        c.address_country, c.address_state, c.address_cap, c.address_province,
        c.address_civic_number, c.address_line,
        c.ateco_code, c.website, c.sector, c.number_of_employees,
        c.revenue, c.fiscal_code, c.office_count_range, c.created_at,
        NULL::numeric as total_sent_quotes,
        NULL::numeric as total_accepted_orders
      FROM clients c
      INNER JOIN user_clients uc ON c.id = uc.client_id
      WHERE uc.user_id = $1
      ORDER BY c.name`,
    [options.userId],
  );
  return rows.map(mapClientRow);
};

export const findContactsForUpdate = async (
  id: string,
  exec: QueryExecutor = pool,
): Promise<{ contacts: ClientContact[] } | null> => {
  const { rows } = await exec.query<{ contacts: unknown }>(
    `SELECT contacts FROM clients WHERE id = $1`,
    [id],
  );
  if (rows.length === 0) return null;
  return { contacts: parseContactsFromDb(rows[0].contacts) };
};

export const findByFiscalCode = async (
  fiscalCode: string,
  excludeId: string | null,
  exec: QueryExecutor = pool,
): Promise<boolean> => {
  if (excludeId) {
    const { rows } = await exec.query<{ id: string }>(
      `SELECT id FROM clients WHERE LOWER(fiscal_code) = LOWER($1) AND id <> $2`,
      [fiscalCode, excludeId],
    );
    return rows.length > 0;
  }
  const { rows } = await exec.query<{ id: string }>(
    `SELECT id FROM clients WHERE LOWER(fiscal_code) = LOWER($1)`,
    [fiscalCode],
  );
  return rows.length > 0;
};

export const findByClientCode = async (
  clientCode: string,
  excludeId: string | null,
  exec: QueryExecutor = pool,
): Promise<boolean> => {
  if (excludeId) {
    const { rows } = await exec.query<{ id: string }>(
      `SELECT id FROM clients WHERE client_code = $1 AND id <> $2`,
      [clientCode, excludeId],
    );
    return rows.length > 0;
  }
  const { rows } = await exec.query<{ id: string }>(
    `SELECT id FROM clients WHERE client_code = $1`,
    [clientCode],
  );
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

export const create = async (input: NewClient, exec: QueryExecutor = pool): Promise<Client> => {
  const { rows } = await exec.query(
    `INSERT INTO clients (
        id, name, is_disabled, type, contacts, contact_name, client_code,
        email, phone, address, address_country, address_state, address_cap,
        address_province, address_civic_number, address_line,
        description, ateco_code, website, sector,
        number_of_employees, revenue, fiscal_code, office_count_range
    ) VALUES (
        $1, $2, $3, $4, $5::jsonb, $6, $7,
        $8, $9, $10, $11, $12, $13,
        $14, $15, $16,
        $17, $18, $19, $20,
        $21, $22, $23, $24
    )
    RETURNING *`,
    [
      input.id,
      input.name,
      false,
      input.type,
      JSON.stringify(input.contacts),
      input.contactName,
      input.clientCode,
      input.email,
      input.phone,
      input.address,
      input.addressCountry,
      input.addressState,
      input.addressCap,
      input.addressProvince,
      input.addressCivicNumber,
      input.addressLine,
      input.description,
      input.atecoCode,
      input.website,
      input.sector,
      input.numberOfEmployees,
      input.revenue,
      input.fiscalCode,
      input.officeCountRange,
    ],
  );
  return mapClientRow(rows[0]);
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
  exec: QueryExecutor = pool,
): Promise<Client | null> => {
  const { rows } = await exec.query(
    `UPDATE clients SET
        name = COALESCE($1, name),
        is_disabled = COALESCE($2, is_disabled),
        type = COALESCE($3, type),
        contacts = COALESCE($4::jsonb, contacts),
        contact_name = CASE WHEN $25 THEN $5 ELSE contact_name END,
        client_code = COALESCE($6, client_code),
        email = CASE WHEN $26 THEN $7 ELSE email END,
        phone = CASE WHEN $27 THEN $8 ELSE phone END,
        address = COALESCE($9, address),
        address_country = COALESCE($10, address_country),
        address_state = COALESCE($11, address_state),
        address_cap = COALESCE($12, address_cap),
        address_province = COALESCE($13, address_province),
        address_civic_number = COALESCE($14, address_civic_number),
        address_line = COALESCE($15, address_line),
        description = COALESCE($16, description),
        ateco_code = COALESCE($17, ateco_code),
        website = COALESCE($18, website),
        sector = CASE WHEN $28 THEN $19 ELSE sector END,
        number_of_employees = CASE WHEN $29 THEN $20 ELSE number_of_employees END,
        revenue = CASE WHEN $30 THEN $21 ELSE revenue END,
        fiscal_code = COALESCE($22, fiscal_code),
        office_count_range = CASE WHEN $31 THEN $23 ELSE office_count_range END
    WHERE id = $24
    RETURNING *`,
    [
      patch.name,
      patch.isDisabled,
      patch.type,
      patch.contacts === null ? null : JSON.stringify(patch.contacts),
      patch.contactName,
      patch.clientCode,
      patch.email,
      patch.phone,
      patch.address,
      patch.addressCountry,
      patch.addressState,
      patch.addressCap,
      patch.addressProvince,
      patch.addressCivicNumber,
      patch.addressLine,
      patch.description,
      patch.atecoCode,
      patch.website,
      patch.sector,
      patch.numberOfEmployees,
      patch.revenue,
      patch.fiscalCode,
      patch.officeCountRange,
      id,
      patch.contactNameProvided,
      patch.emailProvided,
      patch.phoneProvided,
      patch.sectorProvided,
      patch.numberOfEmployeesProvided,
      patch.revenueProvided,
      patch.officeCountRangeProvided,
    ],
  );
  return rows[0] ? mapClientRow(rows[0]) : null;
};

export const deleteById = async (
  id: string,
  exec: QueryExecutor = pool,
): Promise<{ id: string; name: string; clientCode: string | null } | null> => {
  const { rows } = await exec.query<{
    id: string;
    name: string;
    client_code: string | null;
  }>(`DELETE FROM clients WHERE id = $1 RETURNING id, name, client_code`, [id]);
  if (!rows[0]) return null;
  return { id: rows[0].id, name: rows[0].name, clientCode: rows[0].client_code };
};
