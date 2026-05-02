import { eq, sql } from 'drizzle-orm';
import { type DbExecutor, db } from '../db/drizzle.ts';
import { emailConfig } from '../db/schema/emailConfig.ts';

export const SMTP_ENCRYPTIONS = ['insecure', 'ssl', 'tls'] as const;
export type SmtpEncryption = (typeof SMTP_ENCRYPTIONS)[number];

export type EmailConfig = {
  enabled: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpEncryption: SmtpEncryption;
  smtpRejectUnauthorized: boolean;
  smtpUser: string;
  // Encrypted ciphertext when stored; callers must `decrypt()` before passing to a transporter.
  smtpPassword: string;
  fromEmail: string;
  fromName: string;
};

// Patch shape for `update`. The password field is renamed to make the ciphertext-only
// invariant explicit at the type level — `update` writes its value verbatim to
// `email_config.smtp_password`, so callers must encrypt first (see `EmailService.saveConfig`).
export type EmailConfigPatch = Partial<Omit<EmailConfig, 'smtpPassword'>> & {
  smtpPasswordCiphertext?: string;
};

export const DEFAULT_CONFIG: EmailConfig = {
  enabled: false,
  smtpHost: '',
  smtpPort: 587,
  smtpEncryption: 'tls',
  smtpRejectUnauthorized: true,
  smtpUser: '',
  smtpPassword: '',
  fromEmail: '',
  fromName: 'Praetor',
};

const EMAIL_PROJECTION = {
  enabled: emailConfig.enabled,
  smtpHost: emailConfig.smtpHost,
  smtpPort: emailConfig.smtpPort,
  smtpEncryption: emailConfig.smtpEncryption,
  smtpRejectUnauthorized: emailConfig.smtpRejectUnauthorized,
  smtpUser: emailConfig.smtpUser,
  smtpPassword: emailConfig.smtpPassword,
  fromEmail: emailConfig.fromEmail,
  fromName: emailConfig.fromName,
} as const;

type EmailRow = {
  enabled: boolean | null;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpEncryption: string | null;
  smtpRejectUnauthorized: boolean | null;
  smtpUser: string | null;
  smtpPassword: string | null;
  fromEmail: string | null;
  fromName: string | null;
};

// Older versions of email_config accepted any string for smtp_encryption (see commit a1f1fcac);
// normalize at the boundary so consumers can rely on the union type. Other `?? <default>`
// coercions are TS-strict appeasements for columns always populated at runtime via DB defaults.
const mapRow = (row: EmailRow): EmailConfig => {
  const encryption = row.smtpEncryption ?? '';
  return {
    enabled: row.enabled ?? false,
    smtpHost: row.smtpHost ?? '',
    smtpPort: row.smtpPort ?? 587,
    smtpEncryption: (SMTP_ENCRYPTIONS as readonly string[]).includes(encryption)
      ? (encryption as SmtpEncryption)
      : 'tls',
    smtpRejectUnauthorized: row.smtpRejectUnauthorized ?? true,
    smtpUser: row.smtpUser ?? '',
    smtpPassword: row.smtpPassword ?? '',
    fromEmail: row.fromEmail ?? '',
    fromName: row.fromName ?? 'Praetor',
  };
};

export const get = async (exec: DbExecutor = db): Promise<EmailConfig | null> => {
  const rows = await exec.select(EMAIL_PROJECTION).from(emailConfig).where(eq(emailConfig.id, 1));
  return rows[0] ? mapRow(rows[0]) : null;
};

export const update = async (
  patch: EmailConfigPatch,
  exec: DbExecutor = db,
): Promise<EmailConfig> => {
  // COALESCE preserves the existing column when the patch value is undefined (legacy
  // "undefined leaves column unchanged" semantic). Same pattern as ldapRepo.update.
  const result = await exec
    .update(emailConfig)
    .set({
      enabled: sql`COALESCE(${patch.enabled ?? null}, ${emailConfig.enabled})`,
      smtpHost: sql`COALESCE(${patch.smtpHost ?? null}, ${emailConfig.smtpHost})`,
      smtpPort: sql`COALESCE(${patch.smtpPort ?? null}, ${emailConfig.smtpPort})`,
      smtpEncryption: sql`COALESCE(${patch.smtpEncryption ?? null}, ${emailConfig.smtpEncryption})`,
      smtpRejectUnauthorized: sql`COALESCE(${patch.smtpRejectUnauthorized ?? null}, ${emailConfig.smtpRejectUnauthorized})`,
      smtpUser: sql`COALESCE(${patch.smtpUser ?? null}, ${emailConfig.smtpUser})`,
      smtpPassword: sql`COALESCE(${patch.smtpPasswordCiphertext ?? null}, ${emailConfig.smtpPassword})`,
      fromEmail: sql`COALESCE(${patch.fromEmail ?? null}, ${emailConfig.fromEmail})`,
      fromName: sql`COALESCE(${patch.fromName ?? null}, ${emailConfig.fromName})`,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(emailConfig.id, 1))
    .returning(EMAIL_PROJECTION);
  if (result.length === 0) {
    throw new Error('email_config row (id=1) not found; seed missing');
  }
  return mapRow(result[0]);
};
