
import { PrismaClient } from '@prisma/client';
import fs from 'fs';

// Hardcoded DIRECT_URL to bypass any environment variable issues
const DIRECT_URL = "postgresql://postgres.puxjtecjxfjldwxiwzrk:aLajApB0IEwLdJaE@aws-1-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require";

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: DIRECT_URL,
    },
  },
});

async function main() {
  const output = [];
  const log = (msg) => {
      console.log(msg);
      output.push(msg);
  };
  
  try {
    log('Using DIRECT_URL: ' + DIRECT_URL.substring(0, 20) + '...');
    
    // 1. Check existing columns
    log('Checking existing columns in "Product" table...');
    const initialColumns = await prisma.$queryRawUnsafe(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'Product';
    `);
    log('Current columns: ' + initialColumns.map(c => c.column_name).join(', '));

    // 2. Add the column
    log('Attempting to add "scrapedReviews" column...');
    try {
      await prisma.$executeRawUnsafe(`ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "scrapedReviews" JSONB;`);
      log('ALTER TABLE command executed successfully.');
    } catch (e) {
      log('Error executing ALTER TABLE: ' + e.message);
    }

    // 3. Verify the column
    log('Verifying "scrapedReviews" column...');
    const finalColumns = await prisma.$queryRawUnsafe(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'Product';
    `);
    
    const hasColumn = finalColumns.some(c => c.column_name === 'scrapedReviews');
    
    if (hasColumn) {
      log('SUCCESS: "scrapedReviews" column is present in the database.');
    } else {
      log('FAILURE: "scrapedReviews" column is STILL MISSING after ALTER TABLE.');
    }

  } catch (e) {
    log('Critical Error: ' + e.message);
  } finally {
    await prisma.$disconnect();
    fs.writeFileSync('force_add_column_result.txt', output.join('\n'));
  }
}

main();
