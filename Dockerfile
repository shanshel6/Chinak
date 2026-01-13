# Use Node 20 as the base
FROM node:20

# Create app directory
WORKDIR /app

# Copy server package files
COPY server/package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the server code
COPY server/ .

# Generate Prisma client
RUN npx prisma generate

# Hugging Face Spaces uses port 7860 by default
ENV PORT=7860
EXPOSE 7860

# Start the server
CMD ["node", "index.js"]
