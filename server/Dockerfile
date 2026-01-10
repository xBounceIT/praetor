FROM node:20-alpine

WORKDIR /app

# Use faster npm registry and skip optional dependencies
RUN npm config set registry https://registry.npmmirror.com

# Copy package files and .npmrc
COPY package.json .npmrc* ./

# Install production dependencies only (faster)
RUN npm install --production --prefer-offline

# Copy source code
COPY . .

# Expose port
EXPOSE 3001

# Start the server
CMD ["node", "index.js"]
