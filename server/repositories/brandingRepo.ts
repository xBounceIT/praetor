import { eq, sql } from 'drizzle-orm';
import { type DbExecutor, db } from '../db/drizzle.ts';
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
