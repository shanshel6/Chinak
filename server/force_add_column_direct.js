
import { PrismaClient } from '@prisma/client';

// Hardcoded DIRECT_URL to bypass any environment variable issues
const DIRECT_URL = "postgresql://postgres.puxjtecjxfjldwxiwzrk:aLajApB0IEwLdJaE@aws-1-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require";

console.log('Using DIRECT_URL:', DIRECT_URL);

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: DIRECT_URL,
    },
  },
});

async function main() {
  try {
    console.log('Connecting to database...');
    
    // 1. Check existing columns
    console.log('Checking existing columns in "Product" table...');
    const initialColumns = await prisma.$queryRawUnsafe(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'Product';
    `);
    console.log('Current columns:', initialColumns.map(c => c.column_name).join(', '));

    // 2. Add the column
    console.log('Attempting to add "scrapedReviews" column...');
    try {
      await prisma.$executeRawUnsafe(`ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "scrapedReviews" JSONB;`);
      console.log('ALTER TABLE command executed successfully.');
    } catch (e) {
      console.error('Error executing ALTER TABLE:', e.message);
    }

    // 3. Verify the column
    console.log('Verifying "scrapedReviews" column...');
    const finalColumns = await prisma.$queryRawUnsafe(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'Product';
    `);
    
    const hasColumn = finalColumns.some(c => c.column_name === 'scrapedReviews');
    
    if (hasColumn) {
      console.log('SUCCESS: "scrapedReviews" column is present in the database.');
    } else {
      console.error('FAILURE: "scrapedReviews" column is STILL MISSING after ALTER TABLE.');
    }

  } catch (e) {
    console.error('Critical Error:', e);
  } finally {
    await prisma.$disconnect();
  }
}

main();
