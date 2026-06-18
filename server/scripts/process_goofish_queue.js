/**
 * Queue → DB inserter for the Goofish pipeline.
 *
 * Reads JSON files produced by scripts/goofish-pipeline.js when run
 * in queue mode (GOOFISH_USE_QUEUE=true, GOOFISH_QUEUE_DIR=product-queue
 * or product-queue-2), inserts the products into the database, and
 * generates image embeddings using the SAME service the rest of the
 * app uses (services/productImageVectorService.js -> clipService.js).
 *
 * Why this exists:
 *   The pipeline's queue mode skips DB writes during scraping (to be
 *   fast and avoid blocking on the DB). This script is the "second
 *   half" — it takes the queued products, inserts them, and ensures
 *   the embedding is stored on the ProductImage and (via the
 *   service) the Product itself.
 *
 * Usage:
 *   node scripts/process_goofish_queue.js [queue-dir]
 *
 *   If no queue-dir is given, it defaults to the value of
 *   GOOFISH_QUEUE_DIR or "product-queue".
 *
 * It is safe to re-run: products with the same `purchaseUrl` are
 * updated, not duplicated. Queue JSON files are deleted after a
 * successful insert.
 */

import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient, Prisma } from '@prisma/client';
import dotenv from 'dotenv';

import { ensureProductImageEmbeddings } from '../services/productImageVectorService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.join(__dirname, '..', '..');

dotenv.config({ path: path.join(__dirname, '..', '.env'), override: false });

// Queue directory:
//   1. CLI arg
//   2. env GOOFISH_QUEUE_DIR
//   3. default "product-queue"
const queueDirArg = process.argv[2];
const QUEUE_DIR = path.join(
  REPO_ROOT,
  queueDirArg || process.env.GOOFISH_QUEUE_DIR || 'product-queue'
);

const CNY_TO_IQD_RATE = 200;
const PRICE_MULTIPLIER = 1.2;
const MAX_RETRIES = 3;

const prisma = new PrismaClient();

const log = (...args) => console.log('[QueueInsert]', ...args);
const warn = (...args) => console.warn('[QueueInsert]', ...args);
const errLog = (...args) => console.error('[QueueInsert]', ...args);

/**
 * Sanitize an image URL the same way the rest of the app does.
 */
function sanitizeImageUrl(input) {
  if (typeof input !== 'string') return '';
  let url = input.trim();
  if (!url) return '';
  url = url.replace(/^[`'"]+|[`'"]+$/g, '');
  if (url.startsWith('//')) url = `https:${url}`;
  url = url.replace(/[)\]}",:;`]+$/g, '');
  url = url.replace(/[#?].*$/, '');
  url = url.replace(/_\d+x\d+.*$/, '').replace(/\.webp$/i, '');
  return /^https?:\/\//i.test(url) ? url : '';
}

function extractGoofishItemId(url) {
  if (!url) return null;
  try {
    const m = url.match(/[?&]id=(\d+)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

function ensureKeywordList(arr, fallback) {
  if (Array.isArray(arr) && arr.length > 0) return arr.filter(Boolean);
  if (typeof fallback === 'string' && fallback.trim()) {
    return [fallback.trim()];
  }
  return [];
}

/**
 * Insert (or update) a single queued product. Returns the product id.
 *
 * Embeddings are generated AFTER the product + images are in the DB,
 * using the production `ensureProductImageEmbeddings` service. This
 * means we automatically use whatever model the server is currently
 * configured for (Xenova/clip-vit-base-patch32 by default).
 */
async function processOne(queued, attempt = 1) {
  const {
    url,
    name,
    originalTitle,
    priceCny,
    description,
    specs,
    images,
    imageEmbeddings,
    categoryId,
    soldCount,
    isActive,
    itemId
  } = queued;

  if (!url) {
    warn('Skipping queue file with no url');
    return null;
  }

  // 1. Find existing product by purchaseUrl.
  const existing = await prisma.product.findFirst({
    where: { purchaseUrl: url }
  });

  // 2. Compute price.
  const basePriceIQD = Math.max(0, Number(priceCny || 0) * CNY_TO_IQD_RATE);
  const priceIQD = Math.round(basePriceIQD * PRICE_MULTIPLIER);

  // 3. Build metadata blob.
  const metadata = {
    originalTitle: originalTitle || null,
    translatedDescription: description || '',
    goofishItemId: itemId || extractGoofishItemId(url) || null,
    source: 'goofish',
    scrapedAt: new Date().toISOString(),
    soldCount: Number.isFinite(Number(soldCount)) ? Number(soldCount) : null,
    isRealBrand: null
  };

  // 4. Normalize image list.
  const cleanImages = (Array.isArray(images) ? images : [])
    .map(sanitizeImageUrl)
    .filter(Boolean);
  const mainImage = cleanImages[0] || '';

  const keywordList = ensureKeywordList(queued.keywords, name);

  let productId = null;

  if (existing) {
    log(`  Updating existing product ${existing.id} (${existing.name?.slice(0, 30)}...)`);
    await prisma.product.update({
      where: { id: existing.id },
      data: {
        name: name || existing.name,
        price: priceIQD || existing.price,
        basePriceIQD: basePriceIQD || existing.basePriceIQD,
        image: mainImage || existing.image,
        aiMetadata: metadata,
        updatedAt: new Date()
      }
    });
    productId = existing.id;
  } else {
    log(`  Creating new product (${(name || '').slice(0, 30)}...)`);
    const created = await prisma.product.create({
      data: {
        name: name || 'Untitled product',
        price: priceIQD,
        basePriceIQD: basePriceIQD,
        image: mainImage,
        purchaseUrl: url,
        status: 'PUBLISHED',
        isActive: isActive !== false,
        aiMetadata: metadata
      }
    });
    productId = created.id;
  }

  // 5. Update keywords (raw SQL, same as the existing pipeline).
  if (productId && keywordList.length > 0) {
    try {
      const keywordsSql = Prisma.join(keywordList);
      await prisma.$executeRaw`
        UPDATE "Product"
        SET "keywords" = ARRAY[${keywordsSql}]
        WHERE "id" = ${productId}
      `;
    } catch (e) {
      warn(`  Could not set keywords for product ${productId}: ${e.message}`);
    }
  }

  // 6. Insert product images (without embedding — the service
  //    will populate the embedding afterwards).
  if (cleanImages.length > 0 && !existing) {
    try {
      await prisma.productImage.createMany({
        data: cleanImages.slice(0, 8).map((url, idx) => ({
          productId,
          url,
          order: idx,
          type: 'GALLERY'
        })),
        skipDuplicates: true
      });
    } catch (e) {
      warn(`  Could not create images for product ${productId}: ${e.message}`);
    }
  }

  // 7. Generate embedding using the NEW (current production) service.
  //    This uses services/clipService.js (Xenova/clip-vit-base-patch32).
  //    The service itself writes the 512-dim vector to Product.imageEmbedding.
  //    Only updates if no existing embedding OR new valid embedding is generated.
  try {
    // Check if product already has a valid embedding - preserve it if so
    const existingProduct = await prisma.product.findUnique({
      where: { id: productId },
      select: { imageEmbedding: true }
    });

    if (existingProduct?.imageEmbedding) {
      log(`  → Product ${productId} already has an image embedding, preserving it`);
      return productId;
    }

    const embedResult = await ensureProductImageEmbeddings({
      prisma,
      productId,
      productName: name || null,
      fallbackImageUrl: mainImage || null
    });
    if (embedResult.mainVector) {
      log(`  ✓ Embedding saved (512d) for product ${productId}`);
    } else {
      warn(`  ⚠ No embedding produced for product ${productId} (image: ${mainImage.slice(0, 60)}...)`);
    }
  } catch (e) {
    const msg = String(e && e.message || e);
    if (/column\s+"?imageEmbedding"?\s+does not exist/i.test(msg)) {
      warn('');
      warn('  ! Product.imageEmbedding column is MISSING in the database.');
      warn('    The product was inserted, but its embedding could not be saved.');
      warn('    Run this on your Railway DB to fix it:');
      warn('      server/prisma/fix_image_embedding_column.sql');
      warn('');
    } else {
      warn(`  ⚠ Embedding failed for product ${productId}: ${msg}`);
    }
  }

  return productId;
}

async function processOneWithRetry(queued) {
  let lastErr = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await processOne(queued, attempt);
    } catch (e) {
      lastErr = e;
      const backoffMs = Math.min(5000, 800 * attempt);
      warn(`  Attempt ${attempt}/${MAX_RETRIES} failed: ${e.message}. Retrying in ${backoffMs}ms...`);
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }
  throw lastErr;
}

async function main() {
  log(`Queue directory: ${QUEUE_DIR}`);

  if (!fs.existsSync(QUEUE_DIR)) {
    log('Queue directory does not exist — nothing to do.');
    return;
  }

  const files = (await fsPromises.readdir(QUEUE_DIR))
    .filter((f) => f.endsWith('.json'))
    .sort();

  if (files.length === 0) {
    log('Queue is empty — nothing to do.');
    return;
  }

  log(`Found ${files.length} queued product(s).`);

  let inserted = 0;
  let updated = 0;
  let failed = 0;

  for (const file of files) {
    const filePath = path.join(QUEUE_DIR, file);
    let queued;
    try {
      const raw = await fsPromises.readFile(filePath, 'utf8');
      queued = JSON.parse(raw);
    } catch (e) {
      errLog(`Failed to read/parse ${file}: ${e.message}`);
      failed++;
      continue;
    }

    log(`[${inserted + updated + failed + 1}/${files.length}] ${file} -> ${queued.name?.slice(0, 40) || '(no name)'}`);

    const isNew = !(await prisma.product.findFirst({ where: { purchaseUrl: queued.url } }));

    try {
      await processOneWithRetry(queued);
      if (isNew) inserted++; else updated++;
      // Remove the queue file on success so we don't reprocess.
      try { await fsPromises.unlink(filePath); } catch {}
    } catch (e) {
      errLog(`  ✗ Failed: ${e.message}`);
      failed++;
    }
  }

  log('');
  log('======================================');
  log(`Inserted: ${inserted}`);
  log(`Updated:  ${updated}`);
  log(`Failed:   ${failed}`);
  log('======================================');
}

main()
  .catch((e) => {
    errLog('Fatal:', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    try { await prisma.$disconnect(); } catch {}
  });
