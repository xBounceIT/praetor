# Publish Packages (GHCR Images)

This guide explains how developers publish Praetor Docker images to GitHub Container Registry (GHCR).

Published images:

- `ghcr.io/<owner>/praetor-frontend:<version>`
- `ghcr.io/<owner>/praetor-backend:<version>`
- `latest` tags for both

Workflow file: `.github/workflows/publish-images.yml`

## Prerequisites

1. You can push to this repository.
2. GitHub Actions is enabled for the repo.
3. The workflow has `packages: write` permission (already configured).
4. Package visibility in GHCR is configured as needed:
   - `public` for anonymous pulls
   - `private` for authenticated pulls

## Option A: Publish by Git Tag (recommended)

This is the normal release flow.

1. Make sure `main` is up to date:

```bash
git checkout main
git pull
```

2. Create and push a version tag that starts with `v`:

```bash
git tag v1.0.1
git push origin v1.0.1
```

3. Open GitHub Actions and confirm `Publish Docker Images` succeeded.

## Option B: Publish Manually (workflow_dispatch)

Use this for republishing or emergency builds.

1. Go to GitHub -> Actions -> `Publish Docker Images`.
2. Click `Run workflow`.
3. Enter `version` (example: `v1.0.1`).
4. Run it on the desired branch (normally `main`).

## Verify Images Were Published

After workflow success, verify images exist:

1. GitHub -> Packages for this repo/org.
2. Or pull directly:

```bash
docker pull ghcr.io/xbounceit/praetor-frontend:v1.0.1
docker pull ghcr.io/xbounceit/praetor-backend:v1.0.1
```

If packages are private, authenticate first:

```bash
echo <GH_TOKEN> | docker login ghcr.io -u <GITHUB_USERNAME> --password-stdin
```

Token must have at least `read:packages` for pull, `write:packages` for push.

## Use Published Version in Customer Deploy

1. Copy env template:

```bash
cp deploy/.env.customer.example .env
```

2. Set:

- `PRAETOR_VERSION=v1.0.1`
- required secrets and DB values

3. Deploy:

```bash
docker compose --env-file .env -f deploy/docker-compose.customer.yml pull
docker compose --env-file .env -f deploy/docker-compose.customer.yml up -d
```

## Common Failures

1. Workflow did not run:
   - Tag does not match `v*`
   - Tag was created locally but not pushed
2. `denied: permission` while publishing:
   - Missing `packages: write` permission
   - Actions token restrictions in repo/org settings
3. Customer cannot pull image:
   - Package is private and customer is not logged in
   - Wrong `PRAETOR_VERSION`
4. Images published under unexpected namespace:
   - Workflow uses lowercase `github.repository_owner`

## Versioning Notes

Recommended convention: `vMAJOR.MINOR.PATCH` (example `v1.2.3`).

- New releases: publish a new tag.
- Rollback: set previous `PRAETOR_VERSION` in customer `.env` and redeploy.
