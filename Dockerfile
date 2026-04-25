FROM node:20

WORKDIR /app

# Copy root and backend manifests so Railway custom start commands can run from /app
COPY package*.json ./
COPY server/package*.json ./server/
COPY server/prisma ./server/prisma

# Install production dependencies
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV NODE_OPTIONS="--dns-result-order=ipv4first"
ENV PRISMA_SKIP_POSTINSTALL_GENERATE=true
ENV npm_config_optional=false
ENV npm_config_legacy_peer_deps=true
ENV npm_config_registry=https://registry.npmjs.org/
ENV npm_config_maxsockets=5
ENV npm_config_network_concurrency=5
ENV npm_config_progress=false
ENV npm_config_fetch_retries=5
ENV npm_config_fetch_retry_factor=2
ENV npm_config_fetch_retry_mintimeout=20000
ENV npm_config_fetch_retry_maxtimeout=120000
ENV npm_config_timeout=600000
ENV npm_config_loglevel=verbose
ENV npm_config_cache=/data/.npm

# Define a volume for persistent model storage
# Railway will need a volume mounted at /app/models or /data
ENV TRANSFORMERS_CACHE_DIR=/app/models

# Install backend production dependencies during image build so runtime start does not
# depend on Docker CMD execution.
RUN cd server && npm install --omit=dev --omit=optional --no-audit --no-fund --legacy-peer-deps --verbose && npm rebuild sharp --verbose && npx prisma generate

# Copy backend source files
COPY server/ ./server/

# Hugging Face Spaces environment
ENV PORT=7860
ENV NODE_ENV=production
EXPOSE 7860

# Start the server
CMD ["npm", "run", "start"]
