# Use Node 20 as the base
FROM node:20

# Create app directory
WORKDIR /app

# Copy everything
COPY . .

# Detect where the backend is and set up the environment
# 1. If we are in the 'server' folder already (manual upload of server contents)
# 2. If there is a 'server' subfolder (manual upload of entire project)
RUN if [ -f "server/package.json" ]; then \
    echo "Found server folder, moving contents..."; \
    cp -r server/* . && cp -r server/.[!.]* . || true; \
    fi

# Remove frontend stuff to save space and avoid confusion (optional but cleaner)
RUN rm -rf src public android capacitor.config.ts vite.config.ts 2>/dev/null || true

# Install dependencies
# We use --include=dev because we need 'prisma' to generate the client
RUN npm install --include=dev

# Generate Prisma client
RUN npx prisma generate

# Hugging Face Spaces uses port 7860 by default
ENV PORT=7860
EXPOSE 7860

# Start the server
CMD ["node", "index.js"]
