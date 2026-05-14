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

Fresh installs create the bootstrap admin as `admin` / `password`. Change that password after
the first login.

### PostgreSQL TLS (optional)

The backend uses `node-postgres`, which does **not** honor `PGSSLMODE` — TLS must be opted
in via the app-level `DB_SSL` env var:

- Bundled compose stack (no TLS on the Postgres container): leave `DB_SSL` unset.
- Managed Postgres (RDS, Cloud SQL, Supabase, etc.) where the server presents a certificate:
  set `DB_SSL=require`. The connection is encrypted but the server certificate is not
  validated.
- Strict deployments: set `DB_SSL=verify-full` and provide the CA either inline via
  `DB_SSL_CA` (PEM string) or as a path via `DB_SSL_CA_FILE`. Without a CA, the system
  trust store is used.

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

## Rollback

Set `PRAETOR_VERSION` back to the previous tag and run the same pull/up commands.
This rollback guidance applies to the application images only, assuming the same PostgreSQL 18
cluster is still in use.
