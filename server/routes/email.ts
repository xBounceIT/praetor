import type { FastifyInstance } from 'fastify';
import { query } from '../db/index.ts';
import { authenticateToken, requireRole } from '../middleware/auth.ts';
import emailService from '../services/email.ts';
import { encrypt } from '../utils/crypto.ts';

export default async function (fastify: FastifyInstance, _opts: unknown) {
  // GET /config - Get email configuration (Admin only)
  fastify.get(
    '/config',
    {
      onRequest: [authenticateToken, requireRole('admin')],
    },
    async (_request, _reply) => {
      const result = await query('SELECT * FROM email_config WHERE id = 1');
      if (result.rows.length === 0) {
        return {
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
      }
      const c = result.rows[0];
      return {
        enabled: c.enabled,
        smtpHost: c.smtp_host || '',
        smtpPort: c.smtp_port,
        smtpEncryption: c.smtp_encryption || 'tls',
        smtpRejectUnauthorized: c.smtp_reject_unauthorized,
        smtpUser: c.smtp_user || '',
        smtpPassword: c.smtp_password ? '********' : '',
        fromEmail: c.from_email || '',
        fromName: c.from_name || 'Praetor',
      };
    },
  );

  // PUT /config - Update email configuration (Admin only)
  fastify.put(
    '/config',
    {
      onRequest: [authenticateToken, requireRole('admin')],
    },
    async (request, _reply) => {
      const {
        enabled,
        smtpHost,
        smtpPort,
        smtpEncryption,
        smtpRejectUnauthorized,
        smtpUser,
        smtpPassword,
        fromEmail,
        fromName,
      } = request.body as {
        enabled?: boolean;
        smtpHost?: string;
        smtpPort?: number;
        smtpEncryption?: string;
        smtpRejectUnauthorized?: boolean;
        smtpUser?: string;
        smtpPassword?: string;
        fromEmail?: string;
        fromName?: string;
      };

      // Don't update password if it's masked
      const shouldUpdatePassword = smtpPassword && smtpPassword !== '********';
      // Encrypt password before storing
      const encryptedPassword = shouldUpdatePassword ? encrypt(smtpPassword) : null;

      const result = await query(
        `UPDATE email_config
         SET enabled = COALESCE($1, enabled),
             smtp_host = COALESCE($2, smtp_host),
             smtp_port = COALESCE($3, smtp_port),
             smtp_encryption = COALESCE($4, smtp_encryption),
             smtp_reject_unauthorized = COALESCE($5, smtp_reject_unauthorized),
             smtp_user = COALESCE($6, smtp_user),
             smtp_password = CASE WHEN $7::boolean THEN $8 ELSE smtp_password END,
             from_email = COALESCE($9, from_email),
             from_name = COALESCE($10, from_name),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = 1
         RETURNING *`,
        [
          enabled,
          smtpHost,
          smtpPort,
          smtpEncryption,
          smtpRejectUnauthorized,
          smtpUser,
          shouldUpdatePassword,
          encryptedPassword,
          fromEmail,
          fromName,
        ],
      );

      // Reload email service config
      await emailService.loadConfig();

      const c = result.rows[0];
      return {
        enabled: c.enabled,
        smtpHost: c.smtp_host || '',
        smtpPort: c.smtp_port,
        smtpEncryption: c.smtp_encryption || 'tls',
        smtpRejectUnauthorized: c.smtp_reject_unauthorized,
        smtpUser: c.smtp_user || '',
        smtpPassword: c.smtp_password ? '********' : '',
        fromEmail: c.from_email || '',
        fromName: c.from_name || 'Praetor',
      };
    },
  );

  // POST /test - Send test email (Admin only)
  fastify.post(
    '/test',
    {
      onRequest: [authenticateToken, requireRole('admin')],
    },
    async (request, reply) => {
      const { recipientEmail } = request.body as { recipientEmail: string };

      if (!recipientEmail || !recipientEmail.includes('@')) {
        return reply.code(400).send({ error: 'INVALID_RECIPIENT', code: 'INVALID_RECIPIENT' });
      }

      // Reload config before testing
      await emailService.loadConfig();

      const result = await emailService.sendTestEmail(recipientEmail);

      if (!result.success) {
        return reply.code(500).send({
          error: result.code,
          code: result.code,
          params: result.params,
        });
      }

      return {
        success: true,
        code: result.code,
        params: result.params,
        messageId: result.messageId,
      };
    },
  );

  // POST /test-connection - Test SMTP connection without sending email (Admin only)
  fastify.post(
    '/test-connection',
    {
      onRequest: [authenticateToken, requireRole('admin')],
    },
    async (_request, reply) => {
      // Reload config before testing
      await emailService.loadConfig();

      const result = await emailService.testConnection();

      if (!result.success) {
        return reply.code(500).send({
          error: result.code,
          code: result.code,
          params: result.params,
        });
      }

      return {
        success: true,
        code: result.code,
        params: result.params,
      };
    },
  );
}
