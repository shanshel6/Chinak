import { PrismaClient } from '@prisma/client';
import { fileURLToPath } from 'url';
import path from 'path';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.join(__dirname, '..', '.env');
dotenv.config({ path: envPath, override: true });

const DATABASE_URL = process.env.GOOFISH_DATABASE_URL || process.env.DATABASE_URL;

console.log('Adding goofish_category_id column to categories table...');
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
      WHERE table_name = 'categories' 
      AND column_name = 'goofish_category_id'
    `);

    if (result && result.length > 0) {
      console.log('✓ Column goofish_category_id already exists');
      await prisma.$disconnect();
      process.exit(0);
    }

    // Add the column
    console.log('Adding column...');
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "categories" 
      ADD COLUMN "goofish_category_id" TEXT
    `);
    console.log('✓ Column added successfully');

    // Add index
    console.log('Adding index...');
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "categories_goofish_category_id_idx" 
      ON "categories"("goofish_category_id")
    `);
    console.log('✓ Index added successfully');

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
