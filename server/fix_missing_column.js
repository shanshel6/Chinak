
import { PrismaClient } from '@prisma/client';
import fs from 'fs';

const prisma = new PrismaClient();

async function main() {
  console.log('Starting column check...');
  try {
    // 1. Check if column exists using raw SQL
    const checkQuery = `
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'Product' AND column_name = 'scrapedReviews';
    `;
    console.log('Executing check query...');
    const result = await prisma.$queryRawUnsafe(checkQuery);
    
    if (result.length > 0) {
      console.log('SUCCESS: "scrapedReviews" column ALREADY exists.');
    } else {
      console.log('WARNING: "scrapedReviews" column MISSING. Attempting to add it...');
      
      // 2. Add column if missing
      const alterQuery = `ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "scrapedReviews" JSONB;`;
      await prisma.$executeRawUnsafe(alterQuery);
      console.log('SUCCESS: executed ALTER TABLE command.');
      
      // 3. Verify again
      const verifyResult = await prisma.$queryRawUnsafe(checkQuery);
      if (verifyResult.length > 0) {
        console.log('VERIFICATION: Column added successfully!');
      } else {
        console.error('ERROR: Column still missing after ALTER TABLE.');
      }
    }

  } catch (e) {
    console.error('CRITICAL ERROR:', e);
  } finally {
    await prisma.$disconnect();
  }
}

main();
