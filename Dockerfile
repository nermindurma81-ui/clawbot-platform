# ===== ClawBot Platform - Dockerfile =====
FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./
RUN npm ci --only=production

# Copy app
COPY . .

# Create data directories
RUN mkdir -p data data/uploads data/projects data/workflows

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:3000/status || exit 1

# Run
CMD ["node", "server.js"]
