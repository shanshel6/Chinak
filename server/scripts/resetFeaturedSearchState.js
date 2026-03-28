import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envMigrationPath = path.resolve(__dirname, '..', '.env.migration');

const rawUrl = String(process.env.DATABASE_URL || '').trim();
if (!rawUrl) {
  throw new Error(`DATABASE_URL not set. Load it before running this script. Expected source: ${envMigrationPath}`);
}

const databaseUrl = rawUrl.includes('?')
  ? `${rawUrl}&connect_timeout=20&connection_limit=1&pool_timeout=20`
  : `${rawUrl}?connect_timeout=20&connection_limit=1&pool_timeout=20`;
const { Client } = pg;

const run = async () => {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const client = new Client({
      connectionString: databaseUrl,
      ssl: {
        rejectUnauthorized: false
      }
    });
    try {
      await client.connect();
      console.log(`connected on attempt ${attempt}`);
      await client.query('ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "featuredSearchSentences" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];');
      console.log('column ensured');
      const result = await client.query(`
        UPDATE "Product"
        SET
          "isFeatured" = false,
          "featuredSearchSentences" = ARRAY[]::TEXT[],
          "aiMetadata" = CASE
            WHEN "aiMetadata" IS NULL THEN NULL
            WHEN jsonb_typeof("aiMetadata") = 'object' THEN "aiMetadata" - 'featuredSearchTerms'
            ELSE "aiMetadata"
          END
      `);
      console.log(`updated rows: ${result.rowCount || 0}`);
      console.log(JSON.stringify({ attempt, updatedProducts: result.rowCount || 0 }));
      try {
        await client.end();
      } catch {}
      return;
    } catch (error) {
      console.error(`attempt ${attempt} failed: ${error?.message || error}`);
      try {
        await client.end();
      } catch {}
      if (attempt === 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
      continue;
    }
    try {
      await client.end();
    } catch {}
  }
};

await run();
