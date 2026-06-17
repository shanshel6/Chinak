/**
 * Quick script to generate CLIP embeddings for product images
 * Uses @xenova/transformers locally
 *
 * Usage:
 *   node reembed_images_clip.cjs [--reset] [--batch-size=50] [--concurrent=3]
 */

import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.join(__dirname, '.env') });

// Dynamically import the ES modules we need (this script is CommonJS)
let embedImage, ensureProductImageEmbeddings;
async function loadModules() {
  const clipService = await import('./services/clipService.js');
  embedImage = clipService.embedImage;
  const productVectorService = await import('./services/productImageVectorService.js');
  ensureProductImageEmbeddings = productVectorService.ensureProductImageEmbeddings;
}

const prisma = new PrismaClient();
const PROGRESS_FILE = path.join(__dirname, 'reembed_images_progress.json');
const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_CONCURRENT = 3;

const args = process.argv.slice(2);
const DO_RESET = args.includes('--reset');
const batchSize = parseInt(args.find(a => a.startsWith('--batch-size='))?.split('=')[1]) || DEFAULT_BATCH_SIZE;
const maxConcurrent = parseInt(args.find(a => a.startsWith('--concurrent='))?.split('=')[1]) || DEFAULT_CONCURRENT;

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

async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  Re-embed All Product Images — CLIP (512-dim)');
  console.log(`  Batch size: ${batchSize} | Concurrent: ${maxConcurrent}`);
  console.log('═══════════════════════════════════════════════════════\n');

  // Load our services
  console.log('🔧 Loading CLIP service...');
  await loadModules();
  console.log('✅ CLIP service loaded\n');

  // Load progress
  const progress = loadProgress();
  const doneSet = new Set(progress.doneIds);
  if (!progress.startTime) progress.startTime = Date.now();

  // Count products
  const totalCount = await prisma.product.count();
  const alreadyDone = doneSet.size;
  const remaining = totalCount - alreadyDone;
  console.log(`📊 Total products: ${totalCount}`);
  console.log(`📊 Already embedded: ${alreadyDone}`);
  console.log(`📊 Remaining: ${remaining}\n`);

  if (remaining === 0) {
    console.log('✅ All products already have CLIP image embeddings!');
    return;
  }

  // Start processing
  let startAfterId = 0;
  if (doneSet.size > 0) {
    startAfterId = Math.max(...doneSet);
    console.log(`📌 Resuming from product ID > ${startAfterId} (skipping ${doneSet.size} already done)\n`);
  }

  const startTime = Date.now();
  let batchNum = 0;
  let lastId = startAfterId;

  while (true) {
    batchNum++;

    // Fetch next batch of products
    const products = await prisma.product.findMany({
      where: { id: { gt: lastId } },
      take: batchSize,
      orderBy: { id: 'asc' },
      select: { id: true, name: true, image: true }, // Just need id, name, and main image
    });

    if (products.length === 0) break;

    // Filter out already-done products
    const toProcess = products.filter(p => !doneSet.has(p.id));
    if (toProcess.length === 0) {
      lastId = products[products.length - 1].id;
      continue;
    }

    console.log(`📦 Processing batch ${batchNum} (${toProcess.length} products)...`);

    // Process with concurrency limit
    const results = new Array(toProcess.length);
    let idx = 0;
    async function worker() {
      while (idx < toProcess.length) {
        const i = idx++;
        const product = toProcess[i];

        try {
          // Use our existing ensureProductImageEmbeddings service!
          // This handles fetching images, generating embeddings,
          // and updating both Product.imageEmbedding and ProductImage.imageEmbedding
          const result = await ensureProductImageEmbeddings({
            prisma,
            productId: product.id,
            productName: product.name,
            fallbackImageUrl: product.image,
            maxProductImageEmbeddings: 4,
            logger: null, // Quiet for batch processing
          });

          results[i] = { product, success: result.embeddedCount > 0, error: null };
        } catch (err) {
          results[i] = { product, success: false, error: err };
        }
      }
    }

    // Start workers
    const workers = Array.from({ length: Math.min(maxConcurrent, toProcess.length) }, () => worker());
    await Promise.all(workers);

    // Update progress
    for (const { product, success, error } of results) {
      if (error) {
        console.error(`  ❌ Product ${product.id}: ${error.message}`);
        progress.totalFailed++;
      } else if (success) {
        doneSet.add(product.id);
        progress.doneIds.push(product.id);
        progress.totalSuccess++;
      } else {
        progress.totalFailed++;
      }
    }

    lastId = products[products.length - 1].id;
    progress.totalProcessed += toProcess.length;
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
      `✅ ${progress.totalSuccess} ❌ ${progress.totalFailed} | ` +
      `⚡ ${rate.toFixed(1)}/s | ETA: ${etaMin}m ${etaSec}s`
    );
  }

  // Final summary
  const totalTimeMin = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  ✅ CLIP Image Embedding Complete!');
  console.log(`  ✅ Success:    ${progress.totalSuccess}`);
  console.log(`  ❌ Failed:     ${progress.totalFailed}`);
  console.log(`  ⏱️  Time:       ${totalTimeMin} minutes`);
  console.log(`  📊 Avg speed:  ${(progress.totalSuccess / (totalTimeMin * 60)).toFixed(1)} embeddings/sec`);
  console.log('═══════════════════════════════════════════════════════');
}

main()
  .catch(err => { console.error('❌ Fatal error:', err); process.exit(1); })
  .finally(() => prisma.$disconnect());
