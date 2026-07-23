# STAGE 1: Install dependencies
FROM oven/bun:1.3.14 AS install
WORKDIR /temp
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# STAGE 2: Production
FROM oven/bun:1.3.14-slim AS release
WORKDIR /app

ENV NODE_ENV=production

COPY --from=install --chown=bun:bun /temp/node_modules node_modules
COPY --chown=bun:bun . .

# Uploaded files (company logo, supplier-quote attachments) are written here at
# runtime. WORKDIR created /app owned by root, so the non-root `bun` user cannot
# mkdir under it on first upload — pre-create the upload root and hand it to bun.
# A named volume is mounted here in compose so uploads survive container recreation
# (an empty named volume inherits this directory's ownership on first mount).
ENV UPLOAD_PATH=/app/uploads
RUN mkdir -p /app/uploads && chown bun:bun /app/uploads

USER bun

EXPOSE 3001

CMD ["bun", "run", "index.ts"]
