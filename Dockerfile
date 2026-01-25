# Build stage for frontend
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
RUN npm run build -- --verbose

# Production stage
FROM node:20-slim
RUN apt-get update && apt-get install -y \
    openssl \
    ca-certificates \
    libvips-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy backend package files
COPY server/package*.json ./
COPY server/prisma ./prisma

# Install production dependencies
RUN npm install --omit=dev

# Generate prisma client
RUN npx prisma generate

# Copy backend source files
COPY server/ .

# Copy built frontend assets
COPY --from=frontend-builder /app/dist ./dist

# Hugging Face Spaces environment
ENV PORT=7860
ENV NODE_ENV=production
EXPOSE 7860

# Start the server
CMD ["node", "index.js"]
