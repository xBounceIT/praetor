# Use a specific version instead of 'lts' to avoid unexpected updates
FROM node:lts-slim

WORKDIR /app

# 1. Copy both package and lock files
COPY package.json package-lock.json* .npmrc* ./

# 2. Use BuildKit cache mount to persist the npm cache between builds
# 3. Use 'npm ci' for faster, reproducible installs
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --no-audit --progress=false

# 4. Copy source
COPY . .

EXPOSE 3001

CMD ["node", "index.js"]