# STAGE 1: Install dependencies
FROM oven/bun:1.4.5@sha256:3aa040e5445efa09d75bb428a64ba50db13e2b3ac9b6b0c7f145615f62b2ee18 AS install
WORKDIR /temp
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# STAGE 2: Production
FROM oven/bun:1.4.5-slim@sha256:b780593f3e10918cbdaec3d5a08d52224b9198069a65eb47812085c2ec007643 AS release
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
