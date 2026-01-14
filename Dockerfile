# Build stage for frontend
FROM node:20 AS frontend-builder
WORKDIR /app

# Copy root package files
COPY package*.json ./
RUN npm install

# Copy ONLY necessary frontend files explicitly to avoid any context issues
COPY index.html ./
COPY vite.config.ts ./
COPY tsconfig*.json ./
COPY tailwind.config.js ./
COPY postcss.config.js ./
COPY public/ ./public/
COPY src/ ./src/

# Verify index.html is exactly where Vite expects it
RUN ls -la index.html

# Build the frontend - this generates the 'dist' folder
RUN npm run build

# Production stage
FROM node:20-slim
# Install system dependencies for Prisma and Sharp
RUN apt-get update && apt-get install -y \
    openssl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy backend dependencies and prisma schema first
COPY server/package*.json ./
COPY server/prisma ./prisma

# Install production dependencies
RUN npm install --omit=dev

# Explicitly generate prisma client
RUN npx prisma generate

# Copy backend source files
COPY server/ .

# Copy built frontend assets from builder stage
COPY --from=frontend-builder /app/dist ./dist

# Hugging Face Spaces environment
ENV PORT=7860
ENV NODE_ENV=production
EXPOSE 7860

# Start the server
CMD ["node", "index.js"]
