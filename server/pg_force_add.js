
import pg from 'pg';
import fs from 'fs';

const { Client } = pg;

// Hardcoded DIRECT_URL to bypass any environment variable issues
const connectionString = "postgresql://postgres.puxjtecjxfjldwxiwzrk:aLajApB0IEwLdJaE@aws-1-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require";

async function main() {
  const output = [];
  const log = (msg) => {
      console.log(msg);
      output.push(String(msg));
  };

  const client = new Client({
    connectionString,
  });

  try {
    log('Connecting to database via pg client...');
    await client.connect();
    log('Connected successfully.');

    // 1. Check existing columns
    log('Checking existing columns in "Product" table...');
    const resInitial = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'Product';
    `);
    log('Current columns: ' + resInitial.rows.map(c => c.column_name).join(', '));

    // 2. Add the column
    log('Attempting to add "scrapedReviews" column...');
    try {
      await client.query(`ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "scrapedReviews" JSONB;`);
      log('ALTER TABLE command executed successfully.');
    } catch (e) {
      log('Error executing ALTER TABLE: ' + e.message);
    }

    // 3. Verify the column
    log('Verifying "scrapedReviews" column...');
    const resFinal = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'Product';
    `);
    
    const hasColumn = resFinal.rows.some(c => c.column_name === 'scrapedReviews');
    
    if (hasColumn) {
      log('SUCCESS: "scrapedReviews" column is present in the database.');
    } else {
      log('FAILURE: "scrapedReviews" column is STILL MISSING after ALTER TABLE.');
    }

  } catch (e) {
    log('Critical Error: ' + e.message);
    log(e.stack);
  } finally {
    await client.end();
    fs.writeFileSync('pg_force_result.txt', output.join('\n'));
  }
}

main();
