# Customer Deployment (Pull-Only)

This deployment flow requires only Docker and access to your image registry.
Customers do not need the source code and do not build images locally.

## 1) Prepare Environment

Copy and edit the example file:

```bash
cp deploy/.env.customer.example .env
```

Set at least:

- `PRAETOR_VERSION` (recommended pinned release tag, for example `v1.2.3`)
- `POSTGRES_PASSWORD`
- `JWT_SECRET`
- `ENCRYPTION_KEY`
- `FRONTEND_URL`

Fresh installs create the bootstrap admin as `admin` with the password from the
`ADMIN_DEFAULT_PASSWORD` env var (falls back to `password` when unset). The app surfaces an
in-app warning until the admin password is changed away from any insecure default; change it
after the first login.

### PostgreSQL TLS (optional)

The backend uses `node-postgres`, which does **not** honor `PGSSLMODE` — TLS must be opted
in via the app-level `DB_SSL` env var. Accepted values mirror libpq:

- `disable` / unset: no TLS. Use for the bundled compose stack (Postgres image has no TLS).
- `require`: encrypted connection, server certificate is **not** validated.
- `verify-ca`: encrypted connection, server certificate is validated against the CA, but
  the hostname is **not** checked. Useful when connecting through a tunnel or by IP.
- `verify-full`: encrypted connection, server certificate is validated against the CA, and
  the hostname must match. Recommended for production.

For `verify-ca` and `verify-full`, provide the CA either inline via `DB_SSL_CA` (PEM
string) or as a path via `DB_SSL_CA_FILE`. Without a CA, the system trust store is used.

`DB_SSL` is read by both the runtime pool and `drizzle-kit` migrations, so the same value
applies to both paths.

## 2) Authenticate to Registry (if private)

```bash
docker login ghcr.io
```

## 3) Deploy

```bash
docker compose --env-file .env -f deploy/docker-compose.customer.yml pull
docker compose --env-file .env -f deploy/docker-compose.customer.yml up -d
```

This compose file provisions PostgreSQL 18 for fresh installs and uses the official PG18
container data layout. Do not attach it to an existing PostgreSQL 17 data volume.

## Upgrades

The steps below are for Praetor application image updates only. They are not an in-place
PostgreSQL major-version upgrade path.

1. Change `PRAETOR_VERSION` in `.env`.
2. Pull and restart:

```bash
docker compose --env-file .env -f deploy/docker-compose.customer.yml pull
docker compose --env-file .env -f deploy/docker-compose.customer.yml up -d
```

The backend applies pending database migrations before serving requests. The migration runner
uses the hashes recorded in `drizzle.__drizzle_migrations` to find missing journal entries, so
re-running the same `up -d` command is safe when a deployment is interrupted after only part of
the migration journal was applied. If startup still fails, inspect the backend logs before
rolling back; the service exits rather than serving against a partially upgraded schema.

### Upgrade introducing internal jobs (migrations 0112 and 0113)

Take a PostgreSQL backup before deploying the release that adds the `interno` project type.
Deploy the new application image so startup applies migrations 0112 and 0113, wait for readiness,
and complete a project create/edit smoke test before users create internal jobs. Existing Active
and Passive projects are not reclassified. Migration 0113 intentionally moves existing Internal
projects to the Branding-managed company client.

The compatibility window closes after the first project is stored with `tipo = 'interno'`: older
application images only understand Active and Passive projects and are no longer a safe
application-only rollback. From that point, recover by rolling forward to a compatible image or
restore the pre-deploy database backup before starting the previous image.

## Rollback

Set `PRAETOR_VERSION` back to the previous tag and run the same pull/up commands.
This rollback guidance applies to the application images only, assuming the same PostgreSQL 18
cluster is still in use. Schema-specific exceptions, including the internal-jobs compatibility
window above, take precedence.
