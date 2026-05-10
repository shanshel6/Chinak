import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let prisma = new PrismaClient();

async function ensureConnection() {
  try {
    await prisma.$queryRawUnsafe(`SELECT 1 as test`);
  } catch (err) {
    console.log('    Connection lost, reconnecting...');
    try { await prisma.$disconnect(); } catch {}
    prisma = new PrismaClient();
    await prisma.$connect();
    console.log('    Reconnected');
  }
}

const tryLoadJson = (filePath) => {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8').trim();
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || (Array.isArray(parsed) && parsed.length === 0)) return null;
    return parsed;
  } catch (err) {
    console.log(`  Failed to load ${filePath}: ${err.message}`);
    return null;
  }
};

// Helper to add timeout to promises
const withTimeout = (promise, ms, label) => {
  const timeout = new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]);
};

async function main() {
  console.log('========== REMOVING ORPHANED CATEGORIES ==========\n');

  // 1. Load seed file categories
  const seedPath = path.join(__dirname, 'canonical-categories.seed.json');
  const seedData = tryLoadJson(seedPath);
  const seedCategories = Array.isArray(seedData) ? seedData : [];
  const seedSlugs = new Set(seedCategories.map(c => String(c.slug || c.id || '').trim()).filter(Boolean));
  console.log(`[1] Loaded ${seedSlugs.size} categories from seed file`);

  // 2. Test database connection
  console.log('[2] Testing database connection...');
  try {
    await withTimeout(prisma.$connect(), 10000, 'Database connection');
    const testResult = await withTimeout(prisma.$queryRawUnsafe(`SELECT 1 as test`), 10000, 'Test query');
    console.log(`[2] Database connection successful: ${JSON.stringify(testResult)}`);
  } catch (err) {
    console.error(`[2] Database connection failed: ${err.message}`);
    await prisma.$disconnect();
    process.exit(1);
  }

  // 3. Get all orphaned categories from database using batches
  console.log('[3] Finding orphaned categories in database (batched)...');
  const orphanedSlugs = new Set();
  let totalScanned = 0;
  let batchNum = 0;
  const BATCH_SIZE = 1000;

  while (true) {
    batchNum++;
    const rows = await prisma.$queryRawUnsafe(`
      SELECT "aiMetadata"->>'categorySlug' as slug
      FROM "Product"
      WHERE "aiMetadata"->>'categorySlug' IS NOT NULL
        AND "aiMetadata"->>'categorySlug' != ''
        AND "aiMetadata"->>'categorySlug' != 'other'
      ORDER BY id
      LIMIT $1 OFFSET $2
    `, BATCH_SIZE, totalScanned);

    if (!rows || rows.length === 0) break;

    rows.forEach(row => {
      const slug = String(row.slug || '').trim();
      if (slug && !seedSlugs.has(slug)) {
        orphanedSlugs.add(slug);
      }
    });

    totalScanned += rows.length;
    if (batchNum % 10 === 0) {
      console.log(`  Batch ${batchNum}: scanned ${totalScanned} products, found ${orphanedSlugs.size} orphaned slugs`);
    }
  }

  console.log(`[3] Scanned ${totalScanned} total products`);
  console.log(`[4] Found ${orphanedSlugs.size} orphaned category slugs: ${[...orphanedSlugs].sort().join(', ')}\n`);

  if (orphanedSlugs.size === 0) {
    console.log('No orphaned categories found. Exiting.');
    await prisma.$disconnect();
    return;
  }

  // 5. Remove orphaned categories using fast SQL UPDATE (no per-product processing)
  console.log('[5] Removing orphaned category assignments via SQL UPDATE...');
  let totalUpdated = 0;
  let totalFailed = 0;
  const orphanedList = [...orphanedSlugs].sort();

  for (let i = 0; i < orphanedList.length; i++) {
    const orphanedSlug = orphanedList[i];
    console.log(`\n  [${i + 1}/${orphanedList.length}] Removing category: ${orphanedSlug}`);

    await ensureConnection();

    try {
      // Fast SQL UPDATE: remove category keys from aiMetadata for all matching products at once
      const result = await prisma.$executeRawUnsafe(`
        UPDATE "Product"
        SET "aiMetadata" = "aiMetadata"
          - 'categorySlug'
          - 'categoryNameAr'
          - 'categoryNameEn'
          - 'categoryScore'
          - 'categoryConfidence'
          - 'categorySource'
          - 'goofishCategoryId'
          - 'categoryAssignedAt'
        WHERE "aiMetadata"->>'categorySlug' = $1
      `, orphanedSlug);

      totalUpdated += result || 0;
      console.log(`    Updated ${result || 0} products`);
    } catch (err) {
      totalFailed++;
      console.error(`    FAILED to remove ${orphanedSlug}: ${err.message}`);

      // Try once more with reconnect
      console.log(`    Retrying...`);
      await ensureConnection();
      try {
        const result = await prisma.$executeRawUnsafe(`
          UPDATE "Product"
          SET "aiMetadata" = "aiMetadata"
            - 'categorySlug'
            - 'categoryNameAr'
            - 'categoryNameEn'
            - 'categoryScore'
            - 'categoryConfidence'
            - 'categorySource'
            - 'goofishCategoryId'
            - 'categoryAssignedAt'
          WHERE "aiMetadata"->>'categorySlug' = $1
        `, orphanedSlug);
        totalUpdated += result || 0;
        console.log(`    Retry successful: updated ${result || 0} products`);
      } catch (err2) {
        console.error(`    Retry also failed: ${err2.message}`);
      }
    }

    // Small delay between categories
    await new Promise(r => setTimeout(r, 100));
  }

  console.log(`\n========== SUMMARY ==========`);
  console.log(`Total categories processed: ${orphanedList.length}`);
  console.log(`Total products updated: ${totalUpdated}`);
  console.log(`Categories failed: ${totalFailed}`);
  console.log();

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('Error:', err);
  await prisma.$disconnect();
  process.exit(1);
});
