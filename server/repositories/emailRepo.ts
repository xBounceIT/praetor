import pool, { type QueryExecutor } from '../db/index.ts';

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

// Older versions of email_config accepted any string for smtp_encryption (see commit a1f1fcac).
// Normalize at the boundary so consumers can rely on the union type.
type EmailConfigRow = Omit<EmailConfig, 'smtpEncryption'> & { smtpEncryption: string };

const mapRow = (row: EmailConfigRow): EmailConfig => ({
  ...row,
  smtpEncryption: (SMTP_ENCRYPTIONS as readonly string[]).includes(row.smtpEncryption)
    ? (row.smtpEncryption as SmtpEncryption)
    : 'tls',
});

const SELECT_COLUMNS = `enabled,
        smtp_host as "smtpHost",
        smtp_port as "smtpPort",
        smtp_encryption as "smtpEncryption",
        smtp_reject_unauthorized as "smtpRejectUnauthorized",
        smtp_user as "smtpUser",
        smtp_password as "smtpPassword",
        from_email as "fromEmail",
        from_name as "fromName"`;

export const get = async (exec: QueryExecutor = pool): Promise<EmailConfig | null> => {
  const { rows } = await exec.query<EmailConfigRow>(
    `SELECT ${SELECT_COLUMNS} FROM email_config WHERE id = 1`,
  );
  return rows[0] ? mapRow(rows[0]) : null;
};

export const update = async (
  patch: EmailConfigPatch,
  exec: QueryExecutor = pool,
): Promise<EmailConfig> => {
  const { rows } = await exec.query<EmailConfigRow>(
    `UPDATE email_config
        SET enabled = COALESCE($1, enabled),
            smtp_host = COALESCE($2, smtp_host),
            smtp_port = COALESCE($3, smtp_port),
            smtp_encryption = COALESCE($4, smtp_encryption),
            smtp_reject_unauthorized = COALESCE($5, smtp_reject_unauthorized),
            smtp_user = COALESCE($6, smtp_user),
            smtp_password = COALESCE($7, smtp_password),
            from_email = COALESCE($8, from_email),
            from_name = COALESCE($9, from_name),
            updated_at = CURRENT_TIMESTAMP
      WHERE id = 1
      RETURNING ${SELECT_COLUMNS}`,
    [
      patch.enabled,
      patch.smtpHost,
      patch.smtpPort,
      patch.smtpEncryption,
      patch.smtpRejectUnauthorized,
      patch.smtpUser,
      patch.smtpPasswordCiphertext,
      patch.fromEmail,
      patch.fromName,
    ],
  );
  if (rows.length === 0) {
    throw new Error('email_config row (id=1) not found; seed missing');
  }
  return mapRow(rows[0]);
};
