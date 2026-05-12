import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function runMigration() {
  try {
    console.log('Adding notes column to Order table...');
    
    // Execute raw SQL to add the column
    await prisma.$executeRawUnsafe(`ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "notes" TEXT;`);
    
    console.log('Migration completed successfully!');
  } catch (error) {
    console.error('Error running migration:', error);
    if (error.code === 'P1001') {
      console.error('Cannot reach database. Please check your database connection.');
    }
  } finally {
    await prisma.$disconnect();
  }
}

runMigration();
