# STAGE 1: Install dependencies
FROM oven/bun:1.4.3@sha256:ec06c3b6cea04192ae6770c434f668ca41d343ad19fa6472216c7b48be39c598 AS install
WORKDIR /temp
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# STAGE 2: Production
FROM oven/bun:1.4.3-slim@sha256:14a223fa35747ec728bce300ef85888bc5f7958164d15bbba6a54b22b52a3288 AS release
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
