# STAGE 1: Install dependencies
FROM oven/bun:1.3.14 AS install
WORKDIR /temp
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# STAGE 2: Production
FROM oven/bun:1.3.14-slim AS release
WORKDIR /app

COPY --from=install --chown=bun:bun /temp/node_modules node_modules
COPY --chown=bun:bun . .

USER bun

EXPOSE 3001

CMD ["bun", "run", "index.ts"]
