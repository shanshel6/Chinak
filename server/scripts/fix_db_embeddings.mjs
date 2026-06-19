// Standalone DB connectivity test + migration runner.
// Usage: node scripts/fix_db_embeddings.cjs
//   (uses the DATABASE_URL env var, or reads from .env.migration)

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.join(__dirname, '..');

const URL_FROM_ENV = process.env.DATABASE_URL;
let URL_FROM_FILE = null;
const envFile = path.join(REPO_ROOT, '.env.migration');
if (fs.existsSync(envFile)) {
  // Detect encoding: UTF-16 LE BOM (FF FE) vs UTF-8 BOM (EF BB BF) vs none.
  const buf = fs.readFileSync(envFile);
  let raw;
  if (buf[0] === 0xFF && buf[1] === 0xFE) {
    raw = buf.toString('utf16le').slice(1); // strip BOM char
  } else if (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
    raw = buf.toString('utf8').slice(1);
  } else {
    raw = buf.toString('utf8');
  }
  // Extract DATABASE_URL=... value, handling optional quotes
  const m = raw.match(/^DATABASE_URL\s*=\s*["']?([^"'\r\n]+)["']?/m);
  if (m) URL_FROM_FILE = m[1].trim();
}

const DATABASE_URL = URL_FROM_ENV || URL_FROM_FILE;
if (!DATABASE_URL) {
  console.error('No DATABASE_URL found (env or .env.migration)');
  process.exit(1);
}

const SQL_FILE = path.join(REPO_ROOT, 'prisma', 'fix_image_embedding_column.sql');
if (!fs.existsSync(SQL_FILE)) {
  console.error('SQL file not found:', SQL_FILE);
  process.exit(1);
}

const sql = fs.readFileSync(SQL_FILE, 'utf8');

async function main() {
  console.log('[DB Fix] Connecting to Railway Postgres...');
  const client = new pg.Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 8000,
    statement_timeout: 30000,
  });

  // Hard kill-switch in case connection hangs past timeout
  const hardKill = setTimeout(() => {
    console.error('[DB Fix] Hard timeout after 25s — likely a firewall/VPN is dropping Postgres wire-protocol traffic.');
    console.error('          Run:  node scripts\\diag_db.mjs');
    process.exit(3);
  }, 25000);
  hardKill.unref();

  await client.connect();
  console.log('[DB Fix] Connected.');

  // 1. Inspect current state
  const before = await client.query(`
    SELECT column_name, data_type, udt_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'Product'
      AND column_name IN ('imageEmbedding', 'textEmbedding', 'embedding')
    ORDER BY column_name
  `);
  console.log('[DB Fix] Current columns:');
  if (before.rows.length === 0) {
    console.log('  (none of the three embedding columns exist)');
  } else {
    for (const r of before.rows) {
      console.log(`  - ${r.column_name}: ${r.data_type} (${r.udt_name})`);
    }
  }

  // 2. Run the migration
  console.log('[DB Fix] Running migration...');
  await client.query(sql);
  console.log('[DB Fix] Migration SQL executed.');

  // 3. Inspect after state
  const after = await client.query(`
    SELECT column_name, data_type, udt_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'Product'
      AND column_name IN ('imageEmbedding', 'textEmbedding', 'embedding')
    ORDER BY column_name
  `);
  console.log('[DB Fix] After migration:');
  for (const r of after.rows) {
    console.log(`  - ${r.column_name}: ${r.data_type} (${r.udt_name})`);
  }

  await client.end();
  console.log('[DB Fix] Done.');
}

main().catch((e) => {
  console.error('[DB Fix] Fatal:', e);
  process.exit(1);
});
