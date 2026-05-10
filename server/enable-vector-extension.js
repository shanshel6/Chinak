import { PrismaClient } from '@prisma/client';
import { fileURLToPath } from 'url';
import path from 'path';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.join(__dirname, '..', '.env');
dotenv.config({ path: envPath, override: true });

const DATABASE_URL = process.env.GOOFISH_DATABASE_URL || process.env.DATABASE_URL;

console.log('Enabling pgvector extension...');
console.log('Database URL:', DATABASE_URL.replace(/:[^:@]+@/, ':****@'));

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: DATABASE_URL
    }
  }
});

async function enableVectorExtension() {
  try {
    console.log('Connecting to database...');
    await prisma.$connect();
    console.log('✓ Connected to database');
    
    console.log('Attempting to enable pgvector extension...');
    
    // Enable the pgvector extension with timeout
    const enablePromise = prisma.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS vector');
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Operation timed out after 30 seconds')), 30000)
    );
    
    await Promise.race([enablePromise, timeoutPromise]);
    console.log('✓ pgvector extension enabled successfully!');
    
    // Verify the extension is installed
    const result = await prisma.$queryRaw`SELECT * FROM pg_extension WHERE extname = 'vector'`;
    if (result && result.length > 0) {
      console.log('✓ pgvector extension is now active in the database');
    } else {
      console.warn('⚠ pgvector extension was enabled but not found in active extensions');
    }
    
    await prisma.$disconnect();
    console.log('✓ Disconnected successfully');
    process.exit(0);
  } catch (error) {
    console.error('✗ Failed to enable pgvector extension:', error.message);
    console.error('Error details:', error);
    await prisma.$disconnect();
    process.exit(1);
  }
}

enableVectorExtension();
