import nodemailer from 'nodemailer';
import * as emailRepo from '../repositories/emailRepo.ts';
import { decrypt, encrypt, MASKED_SECRET } from '../utils/crypto.ts';

// Plaintext input for `saveConfig`. Distinct from `EmailConfigPatch` (which carries
// `smtpPasswordCiphertext`) so the encrypt step can't be skipped: anything reaching the repo
// has already passed through this service's encryption boundary.
export type EmailConfigInput = Partial<Omit<emailRepo.EmailConfig, 'smtpPassword'>> & {
  smtpPassword?: string;
};

class EmailService {
  // Per-instance cache, only invalidated by `saveConfig`. `ensureReady` populates it on first
  // miss; subsequent reads are sticky until `saveConfig` overwrites it. External DB mutation or
  // multi-instance deployments would see stale config until restart — fine for single-instance
  // Praetor today, since writes flow through `saveConfig`.
  private config: emailRepo.EmailConfig | null;

  constructor() {
    this.config = null;
  }

  private async loadConfig() {
    this.config = (await emailRepo.get()) ?? emailRepo.DEFAULT_CONFIG;
  }

  async saveConfig(input: EmailConfigInput): Promise<emailRepo.EmailConfig> {
    const { smtpPassword, ...rest } = input;
    const updated = await emailRepo.update({
      ...rest,
      smtpPasswordCiphertext:
        smtpPassword && smtpPassword !== MASKED_SECRET ? encrypt(smtpPassword) : undefined,
    });
    this.config = updated;
    return updated;
  }

  private async ensureReady(): Promise<
    { ok: true; config: emailRepo.EmailConfig } | { ok: false; code: string }
  > {
    if (!this.config) await this.loadConfig();
    if (!this.config?.enabled) return { ok: false, code: 'EMAIL_NOT_ENABLED' };
    if (!this.config.smtpHost) return { ok: false, code: 'SMTP_NOT_CONFIGURED' };
    return { ok: true, config: this.config };
  }

  private createTransporter() {
    if (!this.config) {
      throw new Error('Email configuration not loaded');
    }

    let transportOptions: {
      host: string;
      port: number;
      secure: boolean;
      ignoreTLS?: boolean;
      auth?: { user: string; pass: string };
      tls?: { rejectUnauthorized: boolean };
    };

    switch (this.config.smtpEncryption) {
      case 'ssl':
        transportOptions = {
          host: this.config.smtpHost,
          port: this.config.smtpPort,
          secure: true,
        };
        break;
      case 'insecure':
        transportOptions = {
          host: this.config.smtpHost,
          port: this.config.smtpPort,
          secure: false,
          ignoreTLS: true,
        };
        break;
      default:
        // TLS/STARTTLS: nodemailer upgrades the connection via STARTTLS when secure=false
        transportOptions = {
          host: this.config.smtpHost,
          port: this.config.smtpPort,
          secure: false,
        };
        break;
    }

    if (this.config.smtpUser && this.config.smtpPassword) {
      transportOptions.auth = {
        user: this.config.smtpUser,
        pass: decrypt(this.config.smtpPassword),
      };
    }

    if (!this.config.smtpRejectUnauthorized) {
      transportOptions.tls = {
        rejectUnauthorized: false,
      };
    }

    return nodemailer.createTransport(transportOptions);
  }

  async testConnection(): Promise<{
    success: boolean;
    code: string;
    params?: Record<string, string>;
  }> {
    try {
      const ready = await this.ensureReady();
      if (!ready.ok) return { success: false, code: ready.code };

      const transporter = this.createTransporter();
      await transporter.verify();
      return { success: true, code: 'CONNECTION_SUCCESS' };
    } catch (err) {
      console.error('Email connection test failed:', err);
      return {
        success: false,
        code: 'SMTP_ERROR',
        params: { error: err instanceof Error ? err.message : 'Connection test failed' },
      };
    }
  }

  async sendEmail(
    to: string,
    subject: string,
    html: string,
    text?: string,
  ): Promise<{
    success: boolean;
    code: string;
    params?: Record<string, string>;
    messageId?: string;
  }> {
    try {
      const ready = await this.ensureReady();
      if (!ready.ok) return { success: false, code: ready.code };

      const { config } = ready;
      const transporter = this.createTransporter();

      const fromAddress = config.fromName
        ? `"${config.fromName}" <${config.fromEmail}>`
        : config.fromEmail;

      const info = await transporter.sendMail({
        from: fromAddress,
        to,
        subject,
        html,
        text: text || 'This email contains HTML content. Open it in an HTML-capable email client.',
      });

      return {
        success: true,
        code: 'EMAIL_SENT_SUCCESS',
        messageId: info.messageId,
      };
    } catch (err) {
      console.error('Failed to send email:', err);
      return {
        success: false,
        code: 'SMTP_ERROR',
        params: { error: err instanceof Error ? err.message : 'Failed to send email' },
      };
    }
  }

  async sendTestEmail(recipientEmail: string): Promise<{
    success: boolean;
    code: string;
    params?: Record<string, string>;
    messageId?: string;
  }> {
    const subject = 'Praetor Email Configuration Test';
    const text = [
      'Praetor Email Configuration Test',
      '',
      'This is a test email from your Praetor installation.',
      "If you're receiving this email, your SMTP configuration is working correctly.",
      '',
      `Sent from Praetor at ${new Date().toISOString()}`,
    ].join('\n');
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #334155;">Email Configuration Test</h2>
        <p>This is a test email from your Praetor installation.</p>
        <p>If you're receiving this email, your SMTP configuration is working correctly.</p>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
        <p style="color: #64748b; font-size: 12px;">
          Sent from Praetor at ${new Date().toISOString()}
        </p>
      </div>
    `;

    return this.sendEmail(recipientEmail, subject, html, text);
  }
}

export default new EmailService();
