import nodemailer from 'nodemailer';
import { query } from '../db/index.ts';
import { decrypt } from '../utils/crypto.ts';

type SmtpEncryption = 'insecure' | 'ssl' | 'tls';

type EmailConfig = {
  enabled: boolean;
  smtp_host: string;
  smtp_port: number;
  smtp_encryption: SmtpEncryption;
  smtp_reject_unauthorized: boolean;
  smtp_user: string;
  smtp_password: string;
  from_email: string;
  from_name: string;
};

class EmailService {
  config: EmailConfig | null;

  constructor() {
    this.config = null;
  }

  async loadConfig() {
    const result = await query('SELECT * FROM email_config WHERE id = 1');
    if (result.rows.length > 0) {
      this.config = result.rows[0];
    }
  }

  private createTransporter() {
    if (!this.config) {
      throw new Error('Email configuration not loaded');
    }

    // Map encryption setting to nodemailer options
    let transportOptions: {
      host: string;
      port: number;
      secure: boolean;
      ignoreTLS?: boolean;
      auth?: { user: string; pass: string };
      tls?: { rejectUnauthorized: boolean };
    };

    switch (this.config.smtp_encryption) {
      case 'ssl':
        // SSL: implicit encryption (typically port 465)
        transportOptions = {
          host: this.config.smtp_host,
          port: this.config.smtp_port,
          secure: true,
        };
        break;
      case 'insecure':
        // No encryption (cleartext, for OAuth2 proxy)
        transportOptions = {
          host: this.config.smtp_host,
          port: this.config.smtp_port,
          secure: false,
          ignoreTLS: true,
        };
        break;
      case 'tls':
      default:
        // TLS/STARTTLS: upgrades connection (typically port 587)
        transportOptions = {
          host: this.config.smtp_host,
          port: this.config.smtp_port,
          secure: false,
        };
        break;
    }

    // Add authentication if credentials provided
    if (this.config.smtp_user && this.config.smtp_password) {
      transportOptions.auth = {
        user: this.config.smtp_user,
        pass: decrypt(this.config.smtp_password),
      };
    }

    // Handle self-signed certificates
    if (!this.config.smtp_reject_unauthorized) {
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
      if (!this.config) {
        await this.loadConfig();
      }

      if (!this.config || !this.config.enabled) {
        return { success: false, code: 'EMAIL_NOT_ENABLED' };
      }

      if (!this.config.smtp_host) {
        return { success: false, code: 'SMTP_NOT_CONFIGURED' };
      }

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
      if (!this.config) {
        await this.loadConfig();
      }

      if (!this.config || !this.config.enabled) {
        return { success: false, code: 'EMAIL_NOT_ENABLED' };
      }

      if (!this.config.smtp_host) {
        return { success: false, code: 'SMTP_NOT_CONFIGURED' };
      }

      const transporter = this.createTransporter();

      const fromAddress = this.config.from_name
        ? `"${this.config.from_name}" <${this.config.from_email}>`
        : this.config.from_email;

      const info = await transporter.sendMail({
        from: fromAddress,
        to,
        subject,
        html,
        text: text || html.replace(/<[^>]*>/g, ''), // Strip HTML for text version
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

    return this.sendEmail(recipientEmail, subject, html);
  }
}

export default new EmailService();
