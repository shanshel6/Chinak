# Build stage for frontend - Build Trigger: 2026-01-26 22:25
FROM node:20 AS frontend-builder
WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./
RUN npm install

# Copy configuration files
COPY index.html ./
COPY vite.config.ts ./
COPY tsconfig*.json ./
COPY tailwind.config.js ./
COPY postcss.config.js ./
COPY eslint.config.js ./

# Copy source and public files
COPY public/ ./public/
COPY src/ ./src/

# Verify file structure
RUN ls -la index.html

# Build the frontend
ENV CI=true
ENV NODE_OPTIONS="--max-old-space-size=4096"
ENV VITE_LOG_LEVEL=info

# Diagnostics: List files and environment
RUN ls -la && npm list --depth=0

# Run type check
RUN npx tsc -p tsconfig.app.json --noEmit

# Run build with extra memory and verbosity
RUN node --max-old-space-size=4096 node_modules/vite/bin/vite.js build --emptyOutDir

# Production stage
FROM node:20-slim
RUN apt-get update && apt-get install -y \
    openssl \
    ca-certificates \
    libvips-dev \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy backend package files and prisma schema
COPY server/package*.json ./
COPY server/prisma ./prisma

# Install production dependencies
ENV PUPPETEER_SKIP_DOWNLOAD=true
RUN npm install --omit=dev

# Copy backend source files
COPY server/ .

# Generate prisma client with full context
RUN npx prisma generate

# Copy built frontend assets
COPY --from=frontend-builder /app/dist ./dist

# Hugging Face Spaces environment
ENV PORT=7860
ENV NODE_ENV=production
EXPOSE 7860

# Start the server
CMD ["node", "index.js"]
