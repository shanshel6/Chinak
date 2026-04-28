import prisma from '../prismaClient.js';
import { ensureProductImageEmbeddings, MAX_PRODUCT_IMAGE_EMBEDDINGS } from '../services/productImageVectorService.js';
import { embedText } from '../services/clipService.js';
import { canonicalCategories } from '../services/categoryCanonicalService.js';
import fs from 'node:fs/promises';
import path from 'node:path';

// Setup HF endpoint
process.env.HF_ENDPOINT = 'https://hf-mirror.com';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const formatProductLabel = (product) => {
  const id = Number(product?.id) || 0;
  const name = String(product?.name || '').replace(/\s+/g, ' ').trim();
  return name ? `Product ${id} - ${name}` : `Product ${id}`;
};

const withTimeout = async (promiseFactory, label, timeoutMs = 60000) => {
  let timer;
  let heartbeat = null;
  try {
    return await Promise.race([
      promiseFactory(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
};

const withRetry = async (run, label, retries = 5, timeoutMs = 60000, backoffMs = 1500) => {
  let lastError;
  for (let i = 1; i <= retries; i++) {
    try {
      return await withTimeout(run, label, timeoutMs);
    } catch (error) {
      lastError = error;
      const msg = String(error?.message || '');
      const retryable = msg.includes('Timed out fetching a new connection from the connection pool')
        || msg.includes("Can't reach database server")
        || msg.includes('timed out after')
        || msg.includes('Server has closed the connection')
        || String(error?.code || '') === 'P2024'
        || String(error?.code || '') === 'P1017';
      if (!retryable || i === retries) break;
      console.warn(`${label} failed (attempt ${i}/${retries}), retrying... ${msg}`);
      try { await prisma.$disconnect(); } catch {}
      await new Promise((r) => setTimeout(r, backoffMs * i));
      try { await prisma.$connect(); } catch {}
    }
  }
  throw lastError;
};

const waitForDbReady = async (maxWaitMs, retryCount, timeoutMs, backoffMs, progressFilePath, lastId) => {
  const start = Date.now();
  const infiniteWait = maxWaitMs <= 0;
  while (infiniteWait || (Date.now() - start < maxWaitMs)) {
    try {
      await withRetry(() => prisma.$connect(), 'connect', retryCount, timeoutMs, backoffMs);
      await withRetry(() => prisma.$queryRawUnsafe('SELECT 1'), 'db ping', retryCount, timeoutMs, backoffMs);
      return true;
    } catch (error) {
      const msg = String(error?.message || '');
      console.warn(`Database not ready, retrying... ${msg}`);
      if (progressFilePath && lastId > 0) {
        try { await writeProgress(progressFilePath, { lastId }); } catch {}
      }
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  return false;
};

async function readProgress(progressFilePath) {
  try {
    const raw = await fs.readFile(progressFilePath, 'utf8');
    const data = JSON.parse(raw);
    const lastId = Number.parseInt(String(data?.lastId ?? '0'), 10) || 0;
    return { lastId };
  } catch {
    return { lastId: 0 };
  }
}

async function writeProgress(progressFilePath, progress) {
  const dir = path.dirname(progressFilePath);
  await fs.mkdir(dir, { recursive: true });

  const tmpPath = `${progressFilePath}.tmp`;
  const payload = JSON.stringify(
    {
      lastId: progress.lastId,
      updatedAt: new Date().toISOString(),
    },
    null,
    2
  );

  await fs.writeFile(tmpPath, payload, 'utf8');
  try {
    await fs.rename(tmpPath, progressFilePath);
  } catch {
    try {
      await fs.unlink(progressFilePath);
    } catch {}
    await fs.rename(tmpPath, progressFilePath);
  }
}

const assignCategories = process.env.REEMBED_ASSIGN_CATEGORIES === '1';

function cosineSimilarity(vecA, vecB) {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function main() {
  const batchSize = Math.max(1, Number.parseInt(process.env.REEMBED_BATCH_SIZE || '100', 10) || 100);
  const maxItems = Math.max(1, Number.parseInt(process.env.REEMBED_MAX_ITEMS || '5000', 10) || 5000);
  const startId = Number.parseInt(process.env.REEMBED_START_ID || '0', 10) || 0;
  const progressFilePath = path.resolve(process.env.REEMBED_PROGRESS_FILE || 'reembed_progress.json');
  const resetProgress = String(process.env.REEMBED_RESET_PROGRESS || '').trim() === '1';
  const forceAll = String(process.env.REEMBED_FORCE_ALL || '').trim() === '1';
  const testOnly = String(process.env.REEMBED_TEST_ONLY || '').trim() === '1';
  const queryTimeoutMs = Math.max(1000, Number.parseInt(process.env.REEMBED_QUERY_TIMEOUT_MS || '90000', 10) || 90000);
  const updateTimeoutMs = Math.max(1000, Number.parseInt(process.env.REEMBED_UPDATE_TIMEOUT_MS || '180000', 10) || 180000);
  const retryCount = Math.max(1, Number.parseInt(process.env.REEMBED_RETRY_COUNT || '5', 10) || 5);
  const concurrency = Math.max(1, Number.parseInt(process.env.REEMBED_CONCURRENCY || '1', 10) || 1);
  const retryBackoffMs = Math.max(200, Number.parseInt(process.env.REEMBED_RETRY_BACKOFF_MS || '1500', 10) || 1500);
  const pingEveryChunk = String(process.env.REEMBED_DB_PING_EVERY_CHUNK || '1').trim() === '1';
  const reconnectEveryChunk = String(process.env.REEMBED_RECONNECT_EVERY_CHUNK || '0').trim() === '1';
  const dbWaitMs = Math.max(1000, Number.parseInt(process.env.REEMBED_DB_WAIT_MS || '300000', 10) || 300000);
  const progressEvery = Math.max(1, Number.parseInt(process.env.REEMBED_PROGRESS_EVERY || '5', 10) || 5);
  const heartbeatMs = Math.max(5000, Number.parseInt(process.env.REEMBED_HEARTBEAT_MS || '30000', 10) || 30000);

  const dbHost = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).hostname : 'unknown';
  console.log(`\n=================================================`);
  console.log(`🚀 Starting embedding process on Database: ${dbHost}`);
  console.log(`=================================================\n`);

  let heartbeat = null;

  const categoryEmbeddings = [];
  if (assignCategories) {
    console.log('Pre-computing category embeddings...');
    for (const cat of canonicalCategories) {
      if (cat.slug === 'other') continue;
      
      // Try to find a purely English alias for a better CLIP prompt
      const englishAlias = (cat.aliases || []).find(a => /^[a-zA-Z\s-]+$/.test(a));
      const promptSubject = englishAlias || cat.slug.replace(/_/g, ' ');
      const text = `a photo of ${promptSubject}`;
      
      const vec = await embedText(text);
      if (vec && vec.length === 512 && !vec.every(v => v === 0)) {
        categoryEmbeddings.push({ cat, vec });
      }
    }
    console.log(`Pre-computed embeddings for ${categoryEmbeddings.length} categories.`);
  }

  try {
    let processed = 0;
    if (resetProgress) {
      try {
        await fs.unlink(progressFilePath);
      } catch {}
    }

    const resumeProgress = await readProgress(progressFilePath);
    let lastId = Math.max(startId, resumeProgress.lastId);
    if (lastId > 0) {
      console.log(`Resuming from product id > ${lastId} (progress file: ${progressFilePath})`);
    } else {
      console.log(`Starting from the first product in the database (progress file: ${progressFilePath})`);
    }
    heartbeat = setInterval(async () => {
      try { await writeProgress(progressFilePath, { lastId }); } catch {}
    }, heartbeatMs);

    const dbReady = await waitForDbReady(dbWaitMs, retryCount, queryTimeoutMs, retryBackoffMs, progressFilePath, lastId);
    if (!dbReady) {
      console.error('Database was not reachable within the wait window. Exiting.');
      if (heartbeat) clearInterval(heartbeat);
      return;
    }

    await withRetry(
      () => prisma.$executeRawUnsafe(`SET statement_timeout TO ${Math.max(queryTimeoutMs, updateTimeoutMs)}`),
      'set statement_timeout',
      retryCount,
      Math.max(queryTimeoutMs, updateTimeoutMs),
      retryBackoffMs
    );
    
    if (forceAll) {
      console.log('FORCE MODE: Processing ALL products (ignoring existing embeddings)');
    }
    if (testOnly) {
      console.log('TEST MODE: Fetching only one batch and exiting (no embedding).');
    }

    while (processed < maxItems) {
      const ready = await waitForDbReady(dbWaitMs, retryCount, queryTimeoutMs, retryBackoffMs, progressFilePath, lastId);
      if (!ready) {
        console.error('Database was not reachable within the wait window. Exiting.');
        break;
      }
      const remaining = maxItems - processed;
      const take = Math.min(batchSize, remaining);
      
      const whereClause = forceAll
        ? `WHERE id > ${lastId}`
        : `WHERE id > ${lastId}
            AND (
              "imageEmbedding" IS NULL
              OR EXISTS (
                SELECT 1
                FROM "ProductImage" pi
                WHERE pi."productId" = "Product".id
                  AND pi."order" < ${MAX_PRODUCT_IMAGE_EMBEDDINGS}
                  AND pi."imageEmbedding" IS NULL
              )
            )`;

      console.log(`Fetching next batch with lastId=${lastId}...`);
      const rows = await withRetry(
        () => prisma.$queryRawUnsafe(`
          SELECT id, image, name FROM "Product" 
          ${whereClause} 
          ORDER BY id ASC 
          LIMIT ${take}
        `),
        'fetch products',
        retryCount,
        queryTimeoutMs,
        retryBackoffMs
      );
      
      const products = Array.isArray(rows) ? rows : [];
      if (products.length === 0) {
         console.log('No more products to process.');
         break;
      }

      console.log(`Processing batch of ${products.length} products starting from ID ${products[0].id}...`);

      if (testOnly) {
        lastId = products[products.length - 1].id;
        await writeProgress(progressFilePath, { lastId });
        console.log('TEST MODE: Batch fetch OK. Exiting.');
        break;
      }

      for (let i = 0; i < products.length; i += concurrency) {
        const chunk = products.slice(i, i + concurrency);
        if (pingEveryChunk) {
          await withRetry(
            () => prisma.$queryRawUnsafe('SELECT 1'),
            'db ping',
            retryCount,
            queryTimeoutMs,
            retryBackoffMs
          );
        }
        if (reconnectEveryChunk) {
          try { await prisma.$disconnect(); } catch {}
          await withRetry(() => prisma.$connect(), 'reconnect', retryCount, queryTimeoutMs, retryBackoffMs);
        }
        await Promise.all(chunk.map(async (product) => {
          try {
            const imageUrl = String(product.image || '').trim();
            const productLabel = formatProductLabel(product);
            const result = await ensureProductImageEmbeddings({
              prisma,
              productId: product.id,
              productName: product.name || null,
              fallbackImageUrl: imageUrl,
              runDb: (operation, label) => withRetry(
                operation,
                label,
                retryCount,
                updateTimeoutMs,
                retryBackoffMs
              ),
              logger: console,
            });
            if (result.embeddedCount === 0) {
              console.log(`Skipping ${productLabel}: No embeddable product images`);
              return;
            }

            if (assignCategories && result.mainVector && categoryEmbeddings.length > 0) {
              try {
                const vecStr = result.mainVector;
                const vecArray = JSON.parse(vecStr);
                
                let bestCat = null;
                let bestScore = -1;
                
                for (const { cat, vec } of categoryEmbeddings) {
                  const score = cosineSimilarity(vecArray, vec);
                  if (score > bestScore) {
                    bestScore = score;
                    bestCat = cat;
                  }
                }
                
                // If the score is extremely low, fallback to 'other'
                if (bestScore < 0.22) {
                  bestCat = { slug: 'other', name_ar: 'أخرى' };
                }
                
                if (bestCat) {
                  const metadataPatch = JSON.stringify({
                    categorySlug: bestCat.slug,
                    categoryNameAr: bestCat.name_ar,
                    categoryScore: Math.round(bestScore * 100),
                    categoryConfidence: 'high',
                    categorySource: 'vision_zero_shot',
                    categoryAssignedAt: new Date().toISOString()
                  });
                  
                  await withRetry(
                    () => prisma.$executeRawUnsafe(`
                      UPDATE "Product"
                      SET "aiMetadata" = COALESCE("aiMetadata", '{}'::jsonb) || $2::jsonb
                      WHERE id = $1
                    `, product.id, metadataPatch),
                    'update category',
                    retryCount,
                    updateTimeoutMs,
                    retryBackoffMs
                  );
                  console.log(`Category Assigned: ${productLabel} -> ${bestCat.slug} (${Math.round(bestScore * 100)}% match)`);
                }
              } catch (catErr) {
                console.error(`Failed to assign category for ${productLabel}: ${catErr?.message || catErr}`);
              }
            }

            processed += 1;
            console.log(`Success: ${productLabel} (${result.embeddedCount} image embedding${result.embeddedCount === 1 ? '' : 's'})`);
            if (processed % 25 === 0) {
              console.log(`Embedded ${processed} products (last successful=${productLabel})`);
            }
            lastId = product.id;
            if (processed % progressEvery === 0) {
              try { await writeProgress(progressFilePath, { lastId }); } catch {}
            }
          } catch (err) {
            console.error(`Unexpected error for ${formatProductLabel(product)}: ${err?.message || err}`);
            lastId = product.id;
            if (processed % progressEvery === 0) {
              try { await writeProgress(progressFilePath, { lastId }); } catch {}
            }
          }
        }));
        
        // Update progress with the last ID in the chunk
        lastId = chunk[chunk.length - 1].id;
        try {
            await writeProgress(progressFilePath, { lastId });
        } catch (err) {
            console.error(`Failed to write progress file: ${err?.message || err}`);
        }
        
        await sleep(100);
        if (processed >= maxItems) break;
      }
    }

    if (heartbeat) clearInterval(heartbeat);
    console.log(`Done. Embedded image vectors for ${processed} products.`);
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
