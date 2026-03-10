
import { PrismaClient } from '@prisma/client';
import fs from 'fs';

const prisma = new PrismaClient();

async function main() {
  const output = [];
  try {
    const result = await prisma.$queryRawUnsafe(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'Product' AND column_name = 'scrapedReviews';
    `);
    
    output.push(JSON.stringify(result));
    
    if (result.length > 0) {
        output.push('VERIFIED: scrapedReviews column exists.');
    } else {
        output.push('FAILED: scrapedReviews column missing.');
    }
  } catch (e) {
    output.push('ERROR: ' + e.message);
  } finally {
    await prisma.$disconnect();
    fs.writeFileSync('db_verify.txt', output.join('\n'));
  }
}

main();
