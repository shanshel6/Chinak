import { PrismaClient } from '@prisma/client';
import { fileURLToPath } from 'url';
import path from 'path';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.join(__dirname, '..', '.env');
dotenv.config({ path: envPath, override: true });

const DATABASE_URL = process.env.GOOFISH_DATABASE_URL || process.env.DATABASE_URL;

console.log('Adding description column to Product table...');
console.log('Database URL:', DATABASE_URL.replace(/:[^:@]+@/, ':****@'));

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: DATABASE_URL
    }
  }
});

async function addColumn() {
  try {
    console.log('Connecting to database...');
    await prisma.$connect();
    console.log('✓ Connected to database');

    // Check if column already exists
    const result = await prisma.$queryRawUnsafe(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'Product'
      AND column_name = 'description'
    `);

    if (result && result.length > 0) {
      console.log('✓ Column description already exists');
      await prisma.$disconnect();
      process.exit(0);
    }

    // Add the column
    console.log('Adding column...');
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "Product"
      ADD COLUMN "description" TEXT
    `);
    console.log('✓ Column added successfully');

    await prisma.$disconnect();
    console.log('✓ Disconnected successfully');
    console.log('\nColumn added successfully!');
    process.exit(0);
  } catch (error) {
    console.error('✗ Failed to add column:', error.message);
    console.error('Error details:', error);
    await prisma.$disconnect();
    process.exit(1);
  }
}

addColumn();
