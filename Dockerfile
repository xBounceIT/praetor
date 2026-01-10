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

# STAGE 2: Production
# We keep Alpine here because we only need Nginx, not Node
FROM nginx:alpine

RUN apk add --no-cache bash

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

EXPOSE 80

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]