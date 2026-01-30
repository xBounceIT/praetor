# STAGE 1: Install production dependencies
FROM oven/bun:1 AS install
WORKDIR /temp
COPY package.json bun.lock ./
RUN bun install --production

# STAGE 2: Production
FROM oven/bun:1-slim AS release
WORKDIR /app

COPY --from=install /temp/node_modules node_modules
COPY . .

EXPOSE 3001

CMD ["bun", "run", "index.ts"]
