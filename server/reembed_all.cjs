/**
 * Re-embed ALL products with BGE-M3 (1024-dim) via local Ollama
 * 
 * Features:
 *  - Checks DB compatibility and auto-fixes vector dimensions
 *  - Resumes from last checkpoint (skips already-embedded products)
 *  - Parallel/concurrent embedding requests for speed
 *  - Saves progress to reembed_progress.json
 * 
 * Usage:
 *   node reembed_all.cjs                      Resume from checkpoint
 *   node reembed_all.cjs --reset              Start fresh
 *   node reembed_all.cjs --batch-size=200     DB fetch batch size (default 100)
 *   node reembed_all.cjs --concurrent=10      Parallel Ollama requests (default 5)
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const fs = require('fs');
const path = require('path');

// ── Config ──────────────────────────────────────────────────────────
const PROGRESS_FILE = path.join(__dirname, 'reembed_progress.json');
const TARGET_DIM = 1024;
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const OLLAMA_MODEL = process.env.OLLAMA_EMBEDDING_MODEL || 'bge-m3';
const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_CONCURRENT = 5;

const args = process.argv.slice(2);
const DO_RESET = args.includes('--reset');
const batchSize = parseInt(args.find(a => a.startsWith('--batch-size='))?.split('=')[1]) || DEFAULT_BATCH_SIZE;
const maxConcurrent = parseInt(args.find(a => a.startsWith('--concurrent='))?.split('=')[1]) || DEFAULT_CONCURRENT;

// ── Helpers ─────────────────────────────────────────────────────────
function loadProgress() {
  if (DO_RESET) return { doneIds: [], totalProcessed: 0, totalSuccess: 0, totalFailed: 0, startTime: null };
  try {
    if (fs.existsSync(PROGRESS_FILE)) {
      const p = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
      console.log(`📂 Loaded progress: ${p.totalSuccess} already embedded, ${p.totalFailed} failed`);
      return p;
    }
  } catch (e) { /* ignore */ }
  return { doneIds: [], totalProcessed: 0, totalSuccess: 0, totalFailed: 0, startTime: null };
}

function saveProgress(progress) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

function sanitizeForEmbedding(term) {
  if (!term) return '';
  return String(term)
    .replace(/[\\\/.,()!?;:]/g, ' ')
    .replace(/['"`]/g, ' ')
    .replace(/[%_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 64);
}

function buildEmbeddingContent(product) {
  const parts = [];
  if (product?.name) parts.push(`Title: ${product.name}`);
  if (product?.specs) parts.push(`Specs: ${product.specs}`);
  if (product?.aiMetadata) {
    const tokens = [];
    const extract = (val) => {
      if (!val) return;
      if (Array.isArray(val)) val.forEach(v => {
        if (typeof v === 'object') extract(v);
        else { const t = sanitizeForEmbedding(v); if (t) tokens.push(t); }
      });
      else if (typeof val === 'object') Object.values(val).forEach(extract);
      else { const t = sanitizeForEmbedding(val); if (t) tokens.push(t); }
    };
    extract(product.aiMetadata);
    if (tokens.length > 0) parts.push(`Metadata: ${tokens.join(' ')}`);
  }
  return parts.join('\n');
}

// ── Ollama Embedding (single) ──────────────────────────────────────
async function generateEmbeddingOllama(text) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  try {
    const res = await fetch(`${OLLAMA_URL}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: OLLAMA_MODEL, prompt: text }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Ollama HTTP ${res.status}: ${body}`);
    }
    const data = await res.json();
    if (!data.embedding || !Array.isArray(data.embedding)) throw new Error('No embedding returned');
    const vec = data.embedding.map(Number);
    if (vec.length === TARGET_DIM) return vec;
    if (vec.length > TARGET_DIM) return vec.slice(0, TARGET_DIM);
    return vec.concat(new Array(TARGET_DIM - vec.length).fill(0));
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

// ── Parallel embedding with concurrency limit ──────────────────────
async function embedProductsParallel(products, concurrency) {
  const results = new Array(products.length);
  let idx = 0;

  async function worker() {
    while (idx < products.length) {
      const i = idx++;
      const product = products[i];
      const content = buildEmbeddingContent(product);
      if (!content.trim()) {
        results[i] = { product, embedding: null, error: new Error('No content') };
        continue;
      }
      try {
        const embedding = await generateEmbeddingOllama(content);
        results[i] = { product, embedding, error: null };
      } catch (err) {
        results[i] = { product, embedding: null, error: err };
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, products.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// ── DB Compatibility Check & Fix ───────────────────────────────────
async function checkAndFixSchema() {
  console.log('\n🔍 Checking database compatibility...\n');

  const ext = await prisma.$queryRaw`SELECT extversion FROM pg_extension WHERE extname = 'vector'`;
  if (ext.length === 0) {
    console.log('❌ pgvector not installed. Installing...');
    await prisma.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS vector`);
    console.log('✅ pgvector installed');
  } else {
    console.log(`✅ pgvector ${ext[0].extversion}`);
  }

  const vectorCols = await prisma.$queryRaw`
    SELECT c.relname as table_name, a.attname as column_name, a.atttypmod as dim
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_type t ON t.oid = a.atttypid
    WHERE t.typname = 'vector'
      AND c.relname IN ('Product', 'ProductImage')
      AND a.attnum > 0 AND NOT a.attisdropped
    ORDER BY c.relname, a.attname;
  `;

  for (const col of vectorCols) {
    if (col.dim !== TARGET_DIM) {
      console.log(`⚠️  ${col.table_name}.${col.column_name} is ${col.dim} dims → altering to ${TARGET_DIM}...`);
      await prisma.$executeRawUnsafe(`ALTER TABLE "${col.table_name}" DROP COLUMN "${col.column_name}"`);
      await prisma.$executeRawUnsafe(`ALTER TABLE "${col.table_name}" ADD COLUMN "${col.column_name}" vector(${TARGET_DIM})`);
      console.log(`✅ ${col.table_name}.${col.column_name} is now vector(${TARGET_DIM})`);
    } else {
      console.log(`✅ ${col.table_name}.${col.column_name}: ${TARGET_DIM} dims`);
    }
  }

  if (vectorCols.length === 0) {
    console.log('⚠️  No vector columns found. Adding them...');
    const cols = [
      { table: 'Product', col: 'embedding' },
      { table: 'Product', col: 'imageEmbedding' },
      { table: 'ProductImage', col: 'imageEmbedding' },
    ];
    for (const { table, col } of cols) {
      const exists = await prisma.$queryRaw`
        SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
        WHERE c.relname = ${table} AND a.attname = ${col} AND a.attnum > 0 AND NOT a.attisdropped
      `;
      if (exists.length === 0) {
        await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" ADD COLUMN "${col}" vector(${TARGET_DIM})`);
        console.log(`✅ Added ${table}.${col} vector(${TARGET_DIM})`);
      }
    }
  }

  console.log('\n✅ Database is ready for 1024-dim embeddings\n');
}

// ── Main ────────────────────────────────────────────────────────────
async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  Re-embed All Products — BGE-M3 (1024-dim)');
  console.log(`  Ollama:     ${OLLAMA_URL} / ${OLLAMA_MODEL}`);
  console.log(`  Batch size: ${batchSize} | Concurrent: ${maxConcurrent}`);
  console.log('═══════════════════════════════════════════════════════\n');

  // Step 1: Check/fix schema
  await checkAndFixSchema();

  // Step 2: Load progress
  const progress = loadProgress();
  const doneSet = new Set(progress.doneIds);
  if (!progress.startTime) progress.startTime = Date.now();

  // Step 3: Count products
  const totalCount = await prisma.product.count();
  const alreadyDone = doneSet.size;
  const remaining = totalCount - alreadyDone;
  console.log(`📊 Total products: ${totalCount}`);
  console.log(`📊 Already embedded: ${alreadyDone}`);
  console.log(`📊 Remaining: ${remaining}\n`);

  if (remaining === 0) {
    console.log('✅ All products already embedded!');
    return;
  }

  // Step 4: Process in batches with parallel embeddings
  // Find the starting point: if we have done products, start after the max done ID
  // This avoids re-scanning from offset 0 on resume
  let startAfterId = 0;
  if (doneSet.size > 0) {
    startAfterId = Math.max(...doneSet);
    console.log(`📌 Resuming from product ID > ${startAfterId} (skipping ${doneSet.size} already done)\n`);
  }

  const startTime = Date.now();
  let batchNum = 0;
  let skippedBatches = 0;

  // Use ID-based pagination instead of offset for efficient resume
  let lastId = startAfterId;

  while (true) {
    batchNum++;
    const products = await prisma.product.findMany({
      where: { id: { gt: lastId } },
      take: batchSize,
      orderBy: { id: 'asc' },
      select: { id: true, name: true, specs: true, aiMetadata: true },
    });

    if (products.length === 0) break; // No more products

    // Filter out already-done products (safety check)
    const toProcess = products.filter(p => !doneSet.has(p));
    if (toProcess.length === 0) {
      progress.totalProcessed += products.length;
      continue;
    }

    // Embed in parallel
    const results = await embedProductsParallel(toProcess, maxConcurrent);

    // Update DB for successful embeddings
    for (const { product, embedding, error } of results) {
      if (error || !embedding) {
        if (error && error.message !== 'No content') {
          console.error(`  ❌ Product ${product.id}: ${error.message}`);
        }
        progress.totalFailed++;
        continue;
      }
      try {
        const vectorStr = `[${embedding.join(',')}]`;
        await prisma.$executeRawUnsafe(
          `UPDATE "Product" SET "embedding" = $1::vector WHERE "id" = $2`,
          vectorStr, product.id
        );
        doneSet.add(product.id);
        progress.doneIds.push(product.id);
        progress.totalSuccess++;
      } catch (dbErr) {
        console.error(`  ❌ DB update failed for product ${product.id}: ${dbErr.message}`);
        progress.totalFailed++;
      }
    }

    // Update lastId to the last product in this batch
    lastId = products[products.length - 1].id;

    progress.totalProcessed += toProcess.length;

    // Save progress after each batch
    saveProgress(progress);

    // Stats
    const elapsed = (Date.now() - startTime) / 1000;
    const rate = progress.totalSuccess / elapsed;
    const remainingToDo = remaining - progress.totalSuccess - progress.totalFailed;
    const eta = remainingToDo / (rate || 1);
    const pct = ((progress.totalSuccess + progress.totalFailed) / remaining * 100).toFixed(1);
    const etaMin = Math.floor(eta / 60);
    const etaSec = Math.round(eta % 60);

    console.log(
      `📦 Batch ${batchNum} | ${pct}% | ` +
      `✅ ${progress.totalSuccess} ❌ ${progress.totalFailed} | ` +
      `⚡ ${rate.toFixed(1)}/s | ETA: ${etaMin}m ${etaSec}s`
    );
  }

  // Final summary
  const totalTimeMin = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  ✅ Re-embedding Complete!');
  console.log(`  ✅ Success:    ${progress.totalSuccess}`);
  console.log(`  ❌ Failed:     ${progress.totalFailed}`);
  console.log(`  ⏱️  Time:       ${totalTimeMin} minutes`);
  console.log(`  📊 Avg speed:  ${(progress.totalSuccess / (totalTimeMin * 60)).toFixed(1)} embeddings/sec`);
  console.log('═══════════════════════════════════════════════════════');
}

main()
  .catch(err => { console.error('Fatal:', err); process.exit(1); })
  .finally(() => prisma.$disconnect());
