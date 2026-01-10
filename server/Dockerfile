FROM node:lts-slim

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Simple npm install with verbose output to see what's happening
RUN npm install --omit=dev --loglevel=verbose

# Copy source
COPY . .

EXPOSE 3001

CMD ["node", "index.js"]