// One-time, idempotent migration for hybrid Arabic search.
//   1. pg_trgm extension
//   2. Product.nameNormalized column (+ backfill from existing names)
//   3. GIN trigram index on nameNormalized
//   4. (best-effort) HNSW index on textEmbedding for faster vector search
//
// Safe to re-run: every step is guarded with IF NOT EXISTS / NULL-only backfill.
import prisma from '../prismaClient.js';
import { normalizeArabic } from '../services/arabicNormalize.js';

const BATCH = 1000;

async function backfill() {
  let total = 0;
  for (;;) {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT id, name FROM "Product" WHERE "nameNormalized" IS NULL AND name IS NOT NULL LIMIT ${BATCH}`
    );
    if (!rows.length) break;
    const ids = rows.map((r) => Number(r.id));
    const norms = rows.map((r) => normalizeArabic(r.name));
    await prisma.$executeRawUnsafe(
      `UPDATE "Product" AS p SET "nameNormalized" = v.norm
       FROM (SELECT unnest($1::int[]) AS id, unnest($2::text[]) AS norm) v
       WHERE p.id = v.id`,
      ids,
      norms
    );
    total += rows.length;
    console.log(`  backfilled ${total}...`);
    if (rows.length < BATCH) break;
  }
  // Also refresh rows whose name has no Arabic/Latin content -> empty string
  console.log(`Backfill complete: ${total} rows.`);
}

async function main() {
  console.log('1) CREATE EXTENSION pg_trgm');
  await prisma.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);

  console.log('2) ADD COLUMN nameNormalized');
  await prisma.$executeRawUnsafe(`ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "nameNormalized" text`);

  console.log('3) Backfill nameNormalized (existing rows)');
  await backfill();

  console.log('4) GIN trigram index on nameNormalized');
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS product_namenorm_trgm ON "Product" USING gin ("nameNormalized" gin_trgm_ops)`
  );

  console.log('5) HNSW index on textEmbedding (best-effort)');
  try {
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS product_textemb_hnsw ON "Product" USING hnsw ("textEmbedding" vector_cosine_ops)`
    );
    console.log('   HNSW index ready.');
  } catch (e) {
    console.warn('   HNSW index skipped (non-fatal):', e.message);
  }

  const stats = await prisma.$queryRawUnsafe(
    `SELECT
       (SELECT COUNT(*)::int FROM "Product")                                   AS total,
       (SELECT COUNT(*)::int FROM "Product" WHERE "nameNormalized" IS NOT NULL) AS has_norm`
  );
  console.log(`\nDone. total=${stats[0].total}, nameNormalized set=${stats[0].has_norm}`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
