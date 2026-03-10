
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  try {
    console.log('Attempting to manually fix database schema...');
    
    // Check if column exists or just try to add it
    // PostgreSQL syntax
    try {
      await prisma.$executeRawUnsafe(`ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "scrapedReviews" JSONB;`);
      console.log('Successfully executed: ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "scrapedReviews" JSONB;');
    } catch (e) {
      console.log('Error executing ADD COLUMN (might already exist or permission issue):', e.message);
    }

    console.log('Verifying column existence...');
    // We can try to query it
    try {
        const result = await prisma.$queryRawUnsafe(`SELECT "scrapedReviews" FROM "Product" LIMIT 1;`);
        console.log('Query successful, column exists.');
    } catch(e) {
        console.error('Column verification failed:', e.message);
        process.exit(1);
    }

    console.log('Database repair complete.');
    
  } catch (e) {
    console.error('Critical error in repair script:', e);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
