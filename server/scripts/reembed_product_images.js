import prisma from '../prismaClient.js';
import { embedImage } from '../services/clipService.js';
import fs from 'node:fs/promises';
import path from 'node:path';

// Setup HF endpoint
process.env.HF_ENDPOINT = 'https://hf-mirror.com';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

async function main() {
  const batchSize = Math.max(1, Number.parseInt(process.env.REEMBED_BATCH_SIZE || '100', 10) || 100);
  const maxItems = Math.max(1, Number.parseInt(process.env.REEMBED_MAX_ITEMS || '5000', 10) || 5000);
  const startId = Number.parseInt(process.env.REEMBED_START_ID || '0', 10) || 0;
  const progressFilePath = path.resolve(process.env.REEMBED_PROGRESS_FILE || 'reembed_progress.json');
  const resetProgress = String(process.env.REEMBED_RESET_PROGRESS || '').trim() === '1';
  const forceAll = String(process.env.REEMBED_FORCE_ALL || '').trim() === '1';

  await prisma.$connect();
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
    
    if (forceAll) {
      console.log('FORCE MODE: Processing ALL products (ignoring existing embeddings)');
    }

    while (processed < maxItems) {
      const remaining = maxItems - processed;
      const take = Math.min(batchSize, remaining);
      
      const whereClause = forceAll 
        ? `WHERE id > ${lastId}` 
        : `WHERE id > ${lastId} AND "imageEmbedding" IS NULL`;

      const rows = await prisma.$queryRawUnsafe(`
        SELECT id, image, name FROM "Product" 
        ${whereClause} 
        ORDER BY id ASC 
        LIMIT ${take}
      `);
      
      const products = Array.isArray(rows) ? rows : [];
      if (products.length === 0) {
         console.log('No more products to process.');
         break;
      }

      console.log(`Processing batch of ${products.length} products starting from ID ${products[0].id}...`);

      // Process in chunks for concurrency
      const CONCURRENCY = 5;
      for (let i = 0; i < products.length; i += CONCURRENCY) {
        const chunk = products.slice(i, i + CONCURRENCY);
        await Promise.all(chunk.map(async (product) => {
          try {
            const imageUrl = String(product.image || '').trim();
            if (!imageUrl || imageUrl === 'null' || imageUrl === 'undefined') {
              console.log(`Skipping product ${product.id}: No valid image URL`);
              return;
            }

            // Pass null for product name to disable context-aware object detection (as requested)
            const embedding = await embedImage(imageUrl, null);

            if (embedding.every((v) => v === 0)) {
              console.log(`Warning: Zero embedding for product ${product.id}. URL: ${imageUrl}`);
              return;
            }

            const vectorStr = `[${embedding.join(',')}]`;
            await prisma.$executeRawUnsafe(
              `UPDATE "Product" SET "imageEmbedding" = $1::vector WHERE "id" = $2`,
              vectorStr,
              product.id
            );
            processed += 1;
            if (processed % 25 === 0) {
              console.log(`Embedded ${processed} images (last product id=${product.id})`);
            }
          } catch (err) {
            console.error(`Unexpected error for product ${product.id}: ${err?.message || err}`);
          }
        }));
        
        // Update progress with the last ID in the chunk
        lastId = chunk[chunk.length - 1].id;
        try {
            await writeProgress(progressFilePath, { lastId });
        } catch (err) {
            console.error(`Failed to write progress file: ${err?.message || err}`);
        }
        
        // Small delay between chunks to let GC run if needed
        await sleep(100);
        if (processed >= maxItems) break;
      }
    }

    console.log(`Done. Embedded ${processed} product images.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
