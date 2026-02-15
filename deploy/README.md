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
- `ADMIN_DEFAULT_PASSWORD`
- `FRONTEND_URL`

## 2) Authenticate to Registry (if private)

```bash
docker login ghcr.io
```

## 3) Deploy

```bash
docker compose --env-file .env -f deploy/docker-compose.customer.yml pull
docker compose --env-file .env -f deploy/docker-compose.customer.yml up -d
```

## Upgrades

1. Change `PRAETOR_VERSION` in `.env`.
2. Pull and restart:

```bash
docker compose --env-file .env -f deploy/docker-compose.customer.yml pull
docker compose --env-file .env -f deploy/docker-compose.customer.yml up -d
```

## Rollback

Set `PRAETOR_VERSION` back to the previous tag and run the same pull/up commands.
