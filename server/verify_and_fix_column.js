
import { PrismaClient } from '@prisma/client';
import fs from 'fs';

const prisma = new PrismaClient();

async function main() {
  const output = [];
  const log = (msg) => {
    console.log(msg);
    output.push(String(msg));
  };

  try {
    // 1. Get current connection info (masked)
    const url = process.env.DATABASE_URL || 'No URL found in env';
    log(`Connecting to: ${url.replace(/:[^:@]+@/, ':***@')}`);

    // 2. Check current columns
    log('\n--- Checking Columns ---');
    const columns = await prisma.$queryRawUnsafe(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'Product' 
      ORDER BY column_name;
    `);
    
    const colNames = columns.map(c => c.column_name);
    log(`Columns found (${colNames.length}): ${colNames.join(', ')}`);
    
    if (colNames.includes('scrapedReviews')) {
      log('\n✅ "scrapedReviews" column ALREADY EXISTS.');
    } else {
      log('\n❌ "scrapedReviews" column MISSING. Attempting to add...');
      
      try {
        await prisma.$executeRawUnsafe(`ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "scrapedReviews" JSONB;`);
        log('ALTER TABLE command executed.');
        
        // Verify again
        const verify = await prisma.$queryRawUnsafe(`
          SELECT column_name 
          FROM information_schema.columns 
          WHERE table_name = 'Product' AND column_name = 'scrapedReviews';
        `);
        
        if (verify.length > 0) {
          log('✅ Column successfully added!');
        } else {
          log('❌ FAILED to add column even after command.');
        }
      } catch (e) {
        log(`❌ Error adding column: ${e.message}`);
      }
    }

    // 3. Check for any other issues (e.g., conflicting migrations)
    log('\n--- Checking Migration Status (via _prisma_migrations table if exists) ---');
    try {
        const migrations = await prisma.$queryRawUnsafe(`SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 5;`);
        log('Recent migrations:');
        migrations.forEach(m => log(`- ${m.migration_name} (${m.finished_at})`));
    } catch (e) {
        log('Could not read _prisma_migrations (this is normal if not using migrate dev): ' + e.message);
    }

  } catch (e) {
    log(`\n❌ CRITICAL ERROR: ${e.message}`);
  } finally {
    await prisma.$disconnect();
    fs.writeFileSync('db_verify_output.txt', output.join('\n'));
  }
}

main();
