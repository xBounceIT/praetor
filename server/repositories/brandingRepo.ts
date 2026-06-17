import { eq, sql } from 'drizzle-orm';
import { type DbExecutor, db, executeRows } from '../db/drizzle.ts';
import { appBranding } from '../db/schema/appBranding.ts';

export type AppBrandingRecord = {
  companyName: string | null;
  logoStoredName: string | null;
  logoMimeType: string | null;
  logoFileSize: number | null;
  logoUpdatedAt: Date | null;
};

export type BrandingLogoInput = {
  storedName: string;
  mimeType: string;
  fileSize: number;
};

const BRANDING_PROJECTION = {
  companyName: appBranding.companyName,
  logoStoredName: appBranding.logoStoredName,
  logoMimeType: appBranding.logoMimeType,
  logoFileSize: appBranding.logoFileSize,
  logoUpdatedAt: appBranding.logoUpdatedAt,
} as const;

type BrandingRow = {
  companyName: string | null;
  logoStoredName: string | null;
  logoMimeType: string | null;
  logoFileSize: number | null;
  logoUpdatedAt: Date | null;
};

const mapRow = (row: BrandingRow): AppBrandingRecord => ({
  companyName: row.companyName,
  logoStoredName: row.logoStoredName,
  logoMimeType: row.logoMimeType,
  logoFileSize: row.logoFileSize,
  logoUpdatedAt: row.logoUpdatedAt,
});

export const get = async (exec: DbExecutor = db): Promise<AppBrandingRecord | null> => {
  const rows = await exec
    .select(BRANDING_PROJECTION)
    .from(appBranding)
    .where(eq(appBranding.id, 1));
  return rows[0] ? mapRow(rows[0]) : null;
};

// Each writer upserts the single id=1 row so the feature works without a seed insert:
// the first write creates the row, later writes update it.
export const setCompanyName = async (
  companyName: string | null,
  exec: DbExecutor = db,
): Promise<AppBrandingRecord> => {
  const result = await exec
    .insert(appBranding)
    .values({ id: 1, companyName })
    .onConflictDoUpdate({
      target: appBranding.id,
      set: { companyName, updatedAt: sql`CURRENT_TIMESTAMP` },
    })
    .returning(BRANDING_PROJECTION);
  return mapRow(result[0]);
};

export const setLogo = async (
  logo: BrandingLogoInput,
  exec: DbExecutor = db,
): Promise<AppBrandingRecord> => {
  const result = await exec
    .insert(appBranding)
    .values({
      id: 1,
      logoStoredName: logo.storedName,
      logoMimeType: logo.mimeType,
      logoFileSize: logo.fileSize,
      logoUpdatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .onConflictDoUpdate({
      target: appBranding.id,
      set: {
        logoStoredName: logo.storedName,
        logoMimeType: logo.mimeType,
        logoFileSize: logo.fileSize,
        logoUpdatedAt: sql`CURRENT_TIMESTAMP`,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      },
    })
    .returning(BRANDING_PROJECTION);
  return mapRow(result[0]);
};

export const clearLogo = async (exec: DbExecutor = db): Promise<AppBrandingRecord> => {
  const result = await exec
    .insert(appBranding)
    .values({ id: 1 })
    .onConflictDoUpdate({
      target: appBranding.id,
      set: {
        logoStoredName: null,
        logoMimeType: null,
        logoFileSize: null,
        logoUpdatedAt: null,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      },
    })
    .returning(BRANDING_PROJECTION);
  return mapRow(result[0]);
};

export const clearLogoWithPrevious = async (
  exec: DbExecutor = db,
): Promise<{ branding: AppBrandingRecord; previousLogoStoredName: string | null }> => {
  const rows = await executeRows<BrandingRow & { previousLogoStoredName: string | null }>(
    exec,
    sql`
      WITH previous AS (
        SELECT logo_stored_name
        FROM app_branding
        WHERE id = 1
      ),
      updated AS (
        INSERT INTO app_branding (id)
        VALUES (1)
        ON CONFLICT (id) DO UPDATE SET
          logo_stored_name = NULL,
          logo_mime_type = NULL,
          logo_file_size = NULL,
          logo_updated_at = NULL,
          updated_at = CURRENT_TIMESTAMP
        RETURNING
          company_name,
          logo_stored_name,
          logo_mime_type,
          logo_file_size,
          logo_updated_at
      )
      SELECT
        updated.company_name AS "companyName",
        updated.logo_stored_name AS "logoStoredName",
        updated.logo_mime_type AS "logoMimeType",
        updated.logo_file_size AS "logoFileSize",
        updated.logo_updated_at AS "logoUpdatedAt",
        previous.logo_stored_name AS "previousLogoStoredName"
      FROM updated
      LEFT JOIN previous ON TRUE
    `,
  );
  const row = rows[0];
  return { branding: mapRow(row), previousLogoStoredName: row.previousLogoStoredName };
};
