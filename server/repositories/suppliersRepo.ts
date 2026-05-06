import { eq } from 'drizzle-orm';
import { type DbExecutor, db } from '../db/drizzle.ts';
import { suppliers } from '../db/schema/suppliers.ts';

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

const mapRow = (row: typeof suppliers.$inferSelect): Supplier => ({
  id: row.id,
  name: row.name,
  isDisabled: row.isDisabled ?? false,
  supplierCode: row.supplierCode,
  contactName: row.contactName,
  email: row.email,
  phone: row.phone,
  address: row.address,
  vatNumber: row.vatNumber,
  taxCode: row.taxCode,
  paymentTerms: row.paymentTerms,
  notes: row.notes,
  createdAt: row.createdAt ? row.createdAt.getTime() : undefined,
});

export const listAll = async (exec: DbExecutor = db): Promise<Supplier[]> => {
  const rows = await exec.select().from(suppliers).orderBy(suppliers.name);
  return rows.map(mapRow);
};

export const findById = async (id: string, exec: DbExecutor = db): Promise<Supplier | null> => {
  const rows = await exec.select().from(suppliers).where(eq(suppliers.id, id));
  return rows[0] ? mapRow(rows[0]) : null;
};

export const existsById = async (id: string, exec: DbExecutor = db): Promise<boolean> => {
  const rows = await exec
    .select({ id: suppliers.id })
    .from(suppliers)
    .where(eq(suppliers.id, id))
    .limit(1);
  return rows.length > 0;
};

export const findNameById = async (id: string, exec: DbExecutor = db): Promise<string | null> => {
  const rows = await exec
    .select({ name: suppliers.name })
    .from(suppliers)
    .where(eq(suppliers.id, id));
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

export const create = async (input: NewSupplier, exec: DbExecutor = db): Promise<Supplier> => {
  const rows = await exec
    .insert(suppliers)
    .values({
      id: input.id,
      name: input.name,
      isDisabled: false,
      supplierCode: input.supplierCode,
      contactName: input.contactName,
      email: input.email,
      phone: input.phone,
      address: input.address,
      vatNumber: input.vatNumber,
      taxCode: input.taxCode,
      paymentTerms: input.paymentTerms,
      notes: input.notes,
      createdAt: new Date(input.createdAt),
    })
    .returning();
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
  exec: DbExecutor = db,
): Promise<Supplier | null> => {
  const set: Record<string, unknown> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.isDisabled !== undefined) set.isDisabled = patch.isDisabled;
  if (patch.supplierCode !== undefined) set.supplierCode = patch.supplierCode;
  if (patch.contactName !== undefined) set.contactName = patch.contactName;
  if (patch.email !== undefined) set.email = patch.email;
  if (patch.phone !== undefined) set.phone = patch.phone;
  if (patch.address !== undefined) set.address = patch.address;
  if (patch.vatNumber !== undefined) set.vatNumber = patch.vatNumber;
  if (patch.taxCode !== undefined) set.taxCode = patch.taxCode;
  if (patch.paymentTerms !== undefined) set.paymentTerms = patch.paymentTerms;
  if (patch.notes !== undefined) set.notes = patch.notes;

  if (Object.keys(set).length === 0) {
    const rows = await exec.select().from(suppliers).where(eq(suppliers.id, id));
    return rows[0] ? mapRow(rows[0]) : null;
  }

  const rows = await exec.update(suppliers).set(set).where(eq(suppliers.id, id)).returning();
  return rows[0] ? mapRow(rows[0]) : null;
};

export const deleteById = async (
  id: string,
  exec: DbExecutor = db,
): Promise<{ name: string; supplierCode: string | null } | null> => {
  const rows = await exec
    .delete(suppliers)
    .where(eq(suppliers.id, id))
    .returning({ name: suppliers.name, supplierCode: suppliers.supplierCode });
  if (!rows[0]) return null;
  return { name: rows[0].name, supplierCode: rows[0].supplierCode };
};
