import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { withDbTransaction } from '../db/drizzle.ts';
import { authenticateToken, requirePermission } from '../middleware/auth.ts';
import type { AppBrandingRecord } from '../repositories/brandingRepo.ts';
import * as brandingRepo from '../repositories/brandingRepo.ts';
import * as clientsRepo from '../repositories/clientsRepo.ts';
import * as entriesRepo from '../repositories/entriesRepo.ts';
import { logAudit } from '../utils/audit.ts';
import {
  BRANDING_LOGO_MAX_BYTES,
  deleteBrandingLogo,
  isAllowedBrandingImage,
  openBrandingLogo,
  saveBrandingLogo,
} from '../utils/fileStorage.ts';
import { STANDARD_ROUTE_RATE_LIMIT } from '../utils/rate-limit.ts';

const COMPANY_NAME_MAX_LENGTH = 120;

// Public-facing branding payload. Deliberately minimal: only what the (unauthenticated)
// login screen and sidebar need, and nothing about how/where the logo is stored.
type BrandingResponse = {
  companyName: string | null;
  hasLogo: boolean;
  logoUpdatedAt: string | null;
};

const toResponse = (record: AppBrandingRecord | null): BrandingResponse => ({
  companyName: record?.companyName ?? null,
  hasLogo: Boolean(record?.logoStoredName),
  // ISO timestamp doubles as a cache-busting version for the /logo image URL.
  logoUpdatedAt: record?.logoUpdatedAt ? record.logoUpdatedAt.toISOString() : null,
});

const companyNameBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    companyName: { type: ['string', 'null'], maxLength: COMPANY_NAME_MAX_LENGTH },
  },
} as const;

export default async function (fastify: FastifyInstance, _opts: unknown) {
  // PUBLIC — the login screen renders branding before any user is authenticated, so this
  // must be reachable without a token. It exposes only the company name + logo presence.
  fastify.get(
    '/',
    {
      onRequest: [fastify.rateLimit(STANDARD_ROUTE_RATE_LIMIT)],
      // `security: []` overrides the global bearerAuth requirement so the OpenAPI docs
      // correctly show this endpoint as public (matches the /sso/providers/public route).
      schema: { tags: ['branding'], summary: 'Get public app branding', security: [] },
    },
    async (_request: FastifyRequest, _reply: FastifyReply) => {
      return toResponse(await brandingRepo.get());
    },
  );

  // PUBLIC — streams the uploaded logo image. The stored name is a UUID we generated and
  // is re-validated as a safe basename by openBrandingLogo, so no user-controlled path
  // ever reaches the filesystem. Security headers neutralize any SVG script payload even
  // if the URL is opened directly in a browser tab.
  fastify.get(
    '/logo',
    {
      onRequest: [fastify.rateLimit(STANDARD_ROUTE_RATE_LIMIT)],
      // Public (see GET / above): override the global bearerAuth requirement in the docs.
      schema: { tags: ['branding'], summary: 'Get the uploaded company logo image', security: [] },
    },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const record = await brandingRepo.get();
      if (!record?.logoStoredName) {
        return reply.code(404).send({ error: 'No logo set' });
      }
      let opened: Awaited<ReturnType<typeof openBrandingLogo>>;
      try {
        opened = await openBrandingLogo(record.logoStoredName);
      } catch {
        // File missing on disk (manual deletion, volume reset) — behave as "no logo".
        return reply.code(404).send({ error: 'No logo set' });
      }
      reply.header('Content-Type', record.logoMimeType || 'application/octet-stream');
      reply.header('Content-Length', opened.size);
      reply.header('X-Content-Type-Options', 'nosniff');
      reply.header(
        'Content-Security-Policy',
        "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      );
      reply.header('Cache-Control', 'public, max-age=300, must-revalidate');
      return reply.send(opened.stream);
    },
  );

  // ADMIN — set (or clear, via empty/null) the company display name.
  fastify.put(
    '/',
    {
      onRequest: [
        fastify.rateLimit(STANDARD_ROUTE_RATE_LIMIT),
        authenticateToken,
        requirePermission('administration.general.update'),
      ],
      schema: {
        tags: ['branding'],
        summary: 'Update the company display name',
        body: companyNameBodySchema,
      },
    },
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const body = (request.body ?? {}) as { companyName?: string | null };
      const trimmed = typeof body.companyName === 'string' ? body.companyName.trim() : '';
      const companyName = trimmed.length > 0 ? trimmed.slice(0, COMPANY_NAME_MAX_LENGTH) : null;
      const updated = await withDbTransaction(async (tx) => {
        const record = await brandingRepo.setCompanyName(companyName, tx);
        const ownCompanyClient = await clientsRepo.ensureOwnCompanyClient(companyName, tx);
        await entriesRepo.reassignInternalProjectClients(ownCompanyClient, tx);
        return record;
      });
      await logAudit({ request, action: 'branding.updated', entityType: 'app_branding' });
      return toResponse(updated);
    },
  );

  // ADMIN — upload a new logo. Replaces any existing one (old file is removed afterwards).
  fastify.post(
    '/logo',
    {
      onRequest: [
        fastify.rateLimit(STANDARD_ROUTE_RATE_LIMIT),
        authenticateToken,
        requirePermission('administration.general.update'),
      ],
      schema: {
        tags: ['branding'],
        summary: 'Upload the company logo',
        consumes: ['multipart/form-data'],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!request.isMultipart()) {
        return reply.code(400).send({ error: 'Request must be multipart/form-data' });
      }
      const part = await request.file();
      if (!part) {
        return reply.code(400).send({ error: 'A file is required' });
      }
      const originalName = part.filename?.trim() ?? '';

      let buffer: Buffer;
      try {
        // Drain the stream before validating so the connection isn't left half-read.
        buffer = await part.toBuffer();
      } catch (err) {
        if ((err as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
          return reply.code(413).send({ error: 'Logo exceeds the upload limit' });
        }
        throw err;
      }

      if (!isAllowedBrandingImage(part.mimetype, originalName)) {
        return reply
          .code(400)
          .send({ error: 'Unsupported image type. Allowed: PNG, JPEG, WEBP, SVG.' });
      }
      if (buffer.byteLength === 0) {
        return reply.code(400).send({ error: 'Uploaded file is empty' });
      }
      if (buffer.byteLength > BRANDING_LOGO_MAX_BYTES) {
        return reply.code(413).send({ error: 'Logo exceeds the 2 MB limit' });
      }

      // The current-record read and the disk write touch different resources, so run them at
      // the same time; `existing` is only consulted afterwards to clean up the superseded file.
      const [existing, saved] = await Promise.all([
        brandingRepo.get(),
        saveBrandingLogo(buffer, originalName),
      ]);
      let updated: AppBrandingRecord;
      try {
        updated = await brandingRepo.setLogo({
          storedName: saved.storedName,
          mimeType: saved.mimeType,
          fileSize: saved.size,
        });
      } catch (err) {
        // The bytes are already on disk but the DB never recorded them; remove the orphan
        // so a failed write doesn't leak files on the upload volume (mirrors the
        // supplier-quote-attachment upload path).
        await deleteBrandingLogo(saved.storedName).catch(() => {});
        throw err;
      }
      // Best-effort cleanup of the superseded file; a stale orphan is harmless.
      if (existing?.logoStoredName && existing.logoStoredName !== saved.storedName) {
        await deleteBrandingLogo(existing.logoStoredName).catch(() => {});
      }
      await logAudit({ request, action: 'branding.logo.updated', entityType: 'app_branding' });
      return toResponse(updated);
    },
  );

  // ADMIN — remove the custom logo, reverting the UI to the bundled Praetor default.
  fastify.delete(
    '/logo',
    {
      onRequest: [
        fastify.rateLimit(STANDARD_ROUTE_RATE_LIMIT),
        authenticateToken,
        requirePermission('administration.general.update'),
      ],
      schema: { tags: ['branding'], summary: 'Remove the company logo' },
    },
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const { branding: updated, previousLogoStoredName } =
        await brandingRepo.clearLogoWithPrevious();
      await Promise.all([
        previousLogoStoredName ? deleteBrandingLogo(previousLogoStoredName).catch(() => {}) : null,
        logAudit({ request, action: 'branding.logo.removed', entityType: 'app_branding' }),
      ]);
      return toResponse(updated);
    },
  );
}
