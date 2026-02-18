
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env') });

const prisma = new PrismaClient();

async function main() {
  try {
    const output = [];
    const log = (...args) => {
        console.log(...args);
        output.push(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
    };

    log('--- DB DIAGNOSTIC START ---');
    log('DATABASE_URL:', process.env.DATABASE_URL ? process.env.DATABASE_URL.substring(0, 20) + '...' : 'UNDEFINED');
    
    // 1. Check if the table exists
    const tableExists = await prisma.$queryRawUnsafe(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'Product'
      );
    `);
    log('Table "Product" exists:', tableExists);

    // 2. Check if the column exists
    const columns = await prisma.$queryRawUnsafe(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'Product';
    `);
    
    log('Columns in "Product" table:');
    const columnNames = Array.isArray(columns) ? columns.map(c => c.column_name) : [];
    log(columnNames.join(', '));

    const hasScrapedReviews = columnNames.includes('scrapedReviews');
    log('Has "scrapedReviews" column:', hasScrapedReviews);

    if (!hasScrapedReviews) {
        log('ATTEMPTING TO ADD COLUMN...');
        try {
            await prisma.$executeRawUnsafe(`ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "scrapedReviews" JSONB;`);
            log('Column added successfully.');
        } catch (err) {
            log('Failed to add column:', err.message);
        }
    } else {
        log('Column already exists. No action needed.');
    }

    log('--- DB DIAGNOSTIC END ---');
    
    // Write to file
    const fs = await import('fs');
    fs.writeFileSync(path.join(__dirname, 'db_check_result.txt'), output.join('\n'));


  } catch (e) {
    console.error('Diagnostic Error:', e);
  } finally {
    await prisma.$disconnect();
  }
}

main();
