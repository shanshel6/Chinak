# Use Node 20 slim as the base for a smaller image
FROM node:20-slim

# Install system dependencies for Prisma and Sharp
RUN apt-get update && apt-get install -y \
    openssl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./
COPY server/package*.json ./server/

# Copy the rest of the application
COPY . .

# Move server files to root if they are in the server folder
RUN if [ -f "server/package.json" ]; then \
    echo "Consolidating server files..."; \
    cp -r server/* . && cp -r server/.[!.]* . || true; \
    fi

# Remove non-server files to save space
RUN rm -rf src public android android-studio .vscode supabase 2>/dev/null || true

# Install dependencies
# We need devDependencies for 'prisma' during the build
RUN npm install

# Generate Prisma client
RUN npx prisma generate

# Hugging Face Spaces uses port 7860 by default
ENV PORT=7860
ENV NODE_ENV=production
EXPOSE 7860

# Start the server
CMD ["node", "index.js"]
