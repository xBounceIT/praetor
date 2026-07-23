# STAGE 1: Install dependencies
FROM oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4 AS install
WORKDIR /temp
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# STAGE 2: Build
FROM oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4 AS builder
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
FROM caddy:alpine@sha256:5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648

RUN addgroup -S -g 10001 praetor \
    && adduser -S -D -H -u 10001 -G praetor praetor

COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=builder /app/dist /srv
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod 0555 /docker-entrypoint.sh \
    && chown -R praetor:praetor /data /config \
    && chmod -R u=rwX,go= /data /config \
    && setcap -r /usr/bin/caddy

USER praetor:praetor

EXPOSE 8080

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile"]
