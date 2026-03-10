
import { PrismaClient } from '@prisma/client';
import fs from 'fs';

const prisma = new PrismaClient();

async function main() {
  try {
    const result = await prisma.$queryRawUnsafe(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'Product' AND column_name = 'scrapedReviews';
    `);
    
    let message = '';
    if (result.length > 0) {
      message = 'SUCCESS: "scrapedReviews" column exists.';
    } else {
      message = 'FAILURE: "scrapedReviews" column MISSING.';
    }
    console.log(message);
    fs.writeFileSync('db_check_result.txt', message);
  } catch (e) {
    console.error('Error checking column:', e);
    fs.writeFileSync('db_check_result.txt', 'ERROR: ' + e.message);
  } finally {
    await prisma.$disconnect();
  }
}

main();
