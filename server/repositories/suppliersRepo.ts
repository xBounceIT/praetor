import pool, { type QueryExecutor } from '../db/index.ts';

export type Supplier = {
  id: string;
  name: string;
  isDisabled: boolean;
  supplierCode: string | null;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  vatNumber: string | null;
  taxCode: string | null;
  paymentTerms: string | null;
  notes: string | null;
  createdAt: number | undefined;
};

type SupplierRaw = {
  id: string;
  name: string;
  is_disabled: boolean;
  supplier_code: string | null;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  vat_number: string | null;
  tax_code: string | null;
  payment_terms: string | null;
  notes: string | null;
  created_at: string | Date | null;
};

const SUPPLIER_COLUMNS = `id, name, is_disabled, supplier_code, contact_name, email, phone, address, vat_number, tax_code, payment_terms, notes, created_at`;

const mapRow = (row: SupplierRaw): Supplier => ({
  id: row.id,
  name: row.name,
  isDisabled: row.is_disabled,
  supplierCode: row.supplier_code,
  contactName: row.contact_name,
  email: row.email,
  phone: row.phone,
  address: row.address,
  vatNumber: row.vat_number,
  taxCode: row.tax_code,
  paymentTerms: row.payment_terms,
  notes: row.notes,
  createdAt: row.created_at ? new Date(row.created_at).getTime() : undefined,
});

export const listAll = async (exec: QueryExecutor = pool): Promise<Supplier[]> => {
  const { rows } = await exec.query<SupplierRaw>(
    `SELECT ${SUPPLIER_COLUMNS} FROM suppliers ORDER BY name`,
  );
  return rows.map(mapRow);
};

export const findById = async (
  id: string,
  exec: QueryExecutor = pool,
): Promise<Supplier | null> => {
  const { rows } = await exec.query<SupplierRaw>(
    `SELECT ${SUPPLIER_COLUMNS} FROM suppliers WHERE id = $1`,
    [id],
  );
  return rows[0] ? mapRow(rows[0]) : null;
};

export const findNameById = async (
  id: string,
  exec: QueryExecutor = pool,
): Promise<string | null> => {
  const { rows } = await exec.query<{ name: string }>(`SELECT name FROM suppliers WHERE id = $1`, [
    id,
  ]);
  return rows[0]?.name ?? null;
};

export type NewSupplier = {
  id: string;
  name: string;
  supplierCode: string | null;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  vatNumber: string | null;
  taxCode: string | null;
  paymentTerms: string | null;
  notes: string | null;
  createdAt: number;
};

export const create = async (input: NewSupplier, exec: QueryExecutor = pool): Promise<Supplier> => {
  const { rows } = await exec.query<SupplierRaw>(
    `INSERT INTO suppliers (
       id, name, is_disabled, supplier_code, contact_name, email, phone,
       address, vat_number, tax_code, payment_terms, notes, created_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, to_timestamp($13 / 1000.0))
     RETURNING ${SUPPLIER_COLUMNS}`,
    [
      input.id,
      input.name,
      false,
      input.supplierCode,
      input.contactName,
      input.email,
      input.phone,
      input.address,
      input.vatNumber,
      input.taxCode,
      input.paymentTerms,
      input.notes,
      input.createdAt,
    ],
  );
  return mapRow(rows[0]);
};

export type SupplierUpdate = {
  name?: string;
  isDisabled?: boolean;
  supplierCode?: string | null;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  vatNumber?: string | null;
  taxCode?: string | null;
  paymentTerms?: string | null;
  notes?: string | null;
};

export const update = async (
  id: string,
  patch: SupplierUpdate,
  exec: QueryExecutor = pool,
): Promise<Supplier | null> => {
  const sets: string[] = [];
  const params: unknown[] = [];
  let idx = 1;
  const fields: Array<[string, unknown]> = [
    ['name', patch.name],
    ['is_disabled', patch.isDisabled],
    ['supplier_code', patch.supplierCode],
    ['contact_name', patch.contactName],
    ['email', patch.email],
    ['phone', patch.phone],
    ['address', patch.address],
    ['vat_number', patch.vatNumber],
    ['tax_code', patch.taxCode],
    ['payment_terms', patch.paymentTerms],
    ['notes', patch.notes],
  ];
  for (const [col, value] of fields) {
    if (value !== undefined) {
      sets.push(`${col} = $${idx++}`);
      params.push(value);
    }
  }

  if (sets.length === 0) {
    const { rows } = await exec.query<SupplierRaw>(
      `SELECT ${SUPPLIER_COLUMNS} FROM suppliers WHERE id = $1`,
      [id],
    );
    return rows[0] ? mapRow(rows[0]) : null;
  }

  params.push(id);
  const { rows } = await exec.query<SupplierRaw>(
    `UPDATE suppliers SET ${sets.join(', ')} WHERE id = $${idx} RETURNING ${SUPPLIER_COLUMNS}`,
    params,
  );
  return rows[0] ? mapRow(rows[0]) : null;
};

export const deleteById = async (
  id: string,
  exec: QueryExecutor = pool,
): Promise<{ name: string; supplierCode: string | null } | null> => {
  const { rows } = await exec.query<{ name: string; supplier_code: string | null }>(
    `DELETE FROM suppliers WHERE id = $1 RETURNING name, supplier_code`,
    [id],
  );
  if (!rows[0]) return null;
  return { name: rows[0].name, supplierCode: rows[0].supplier_code };
};
