# Build stage for frontend - Build Trigger: 2026-01-26 22:56
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

# Run type check and capture output
RUN npx tsc -p tsconfig.app.json --noEmit || (echo "TSC Check Failed" && npx tsc -p tsconfig.app.json --noEmit > tsc_error.log 2>&1 && cat tsc_error.log && exit 1)

# Run build with extra memory and verbosity
RUN node --max-old-space-size=4096 node_modules/vite/bin/vite.js build --emptyOutDir || (echo "Vite Build Failed" && exit 1)

# Production stage - Use full node image for better compatibility
FROM node:20

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
ENV PRISMA_SKIP_POSTINSTALL_GENERATE=1
RUN npm install --omit=dev

# Copy backend source files
COPY server/ .

# Explicitly generate prisma client with a dummy URL to bypass validation if necessary
RUN DATABASE_URL="postgresql://localhost:5432/dummy" npx prisma generate || (echo "Prisma Generate Failed" && npx prisma generate --verbose && exit 1)

# Copy built frontend assets
COPY --from=frontend-builder /app/dist ./dist

# Hugging Face Spaces environment
ENV PORT=7860
ENV NODE_ENV=production
EXPOSE 7860

# Start the server
CMD ["node", "index.js"]
