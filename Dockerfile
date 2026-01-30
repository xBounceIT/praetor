# STAGE 1: Install dependencies
FROM oven/bun:1 AS install
WORKDIR /temp
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# STAGE 2: Build
FROM oven/bun:1 AS builder
WORKDIR /app
COPY --from=install /temp/node_modules node_modules
COPY . .

ARG VITE_API_URL=http://localhost:3001/api
ENV VITE_API_URL=$VITE_API_URL

ARG APP_VERSION
ENV VITE_APP_VERSION=$APP_VERSION

ENV NODE_ENV=production
RUN bun run build

# STAGE 3: Production with Caddy
FROM caddy:alpine

COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=builder /app/dist /srv
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

EXPOSE 80

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile"]
