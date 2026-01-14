# STAGE 1: Build
# Switched to slim to avoid Alpine compilation hangs
FROM node:lts-slim AS builder

# Set memory limit for Node (helps prevent crashes during heavy builds)
ENV NODE_OPTIONS="--max-old-space-size=4096"

WORKDIR /app

COPY package.json package-lock.json* ./

# Use 'ci' instead of 'install' and disable logs for speed
RUN npm ci --no-audit --progress=false

COPY . .

ARG VITE_API_URL=http://localhost:3001/api
ENV VITE_API_URL=$VITE_API_URL
ENV GEMINI_API_KEY=__GEMINI_API_KEY_PLACEHOLDER__

ARG APP_VERSION
ENV VITE_APP_VERSION=$APP_VERSION

RUN npm run build

# STAGE 2: Production with Caddy
FROM caddy:alpine

COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=builder /app/dist /srv
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

EXPOSE 80

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile"]