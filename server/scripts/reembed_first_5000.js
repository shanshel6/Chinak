import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env') });

if (process.env.DATABASE_URL) {
  try {
    const url = new URL(process.env.DATABASE_URL);
    const connectionLimit = String(process.env.REEMBED_DB_CONNECTION_LIMIT || '1');
    url.searchParams.set('connection_limit', connectionLimit);
    if (!url.searchParams.get('pool_timeout')) {
      url.searchParams.set('pool_timeout', '30');
    }
    process.env.DATABASE_URL = url.toString();
  } catch (err) {
    console.warn('[Reembed] Could not adjust DATABASE_URL:', err?.message || err);
  }
}

const TOTAL_LIMIT = Number(process.env.REEMBED_LIMIT) > 0 ? Number(process.env.REEMBED_LIMIT) : null;
const BATCH_SIZE = Number(process.env.REEMBED_BATCH_SIZE) > 0 ? Number(process.env.REEMBED_BATCH_SIZE) : 100;
const CONCURRENCY = Number(process.env.REEMBED_CONCURRENCY) > 0 ? Number(process.env.REEMBED_CONCURRENCY) : 1;
const ITEM_DELAY_MS = Number(process.env.REEMBED_ITEM_DELAY_MS) >= 0 ? Number(process.env.REEMBED_ITEM_DELAY_MS) : 100;
const BATCH_DELAY_MS = Number(process.env.REEMBED_BATCH_DELAY_MS) >= 0 ? Number(process.env.REEMBED_BATCH_DELAY_MS) : 500;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const { default: prisma } = await import('../prismaClient.js');
  const { processProductEmbedding } = await import('../services/aiService.js');
  let processed = 0;
  let lastId = 0;

  while (!TOTAL_LIMIT || processed < TOTAL_LIMIT) {
    const take = TOTAL_LIMIT ? Math.min(BATCH_SIZE, TOTAL_LIMIT - processed) : BATCH_SIZE;
    const batch = await prisma.product.findMany({
      take,
      where: { id: { gt: lastId } },
      orderBy: { id: 'asc' },
      select: { id: true }
    });

    if (batch.length === 0) break;

    let index = 0;
    while (index < batch.length) {
      const slice = batch.slice(index, index + CONCURRENCY);
      await Promise.all(slice.map(async (item) => {
        try {
          await processProductEmbedding(item.id);
        } catch (err) {
          console.error(`[Reembed] Failed for product ${item.id}:`, err?.message || err);
        } finally {
          processed += 1;
        }
      }));
      index += CONCURRENCY;
      if (ITEM_DELAY_MS > 0) {
        await sleep(ITEM_DELAY_MS);
      }
    }

    lastId = batch[batch.length - 1].id;
    if (!TOTAL_LIMIT || processed < TOTAL_LIMIT) {
      await sleep(BATCH_DELAY_MS);
    }
  }

  console.log(`[Reembed] Completed ${processed} products.`);
}

main()
  .catch((err) => {
    console.error('[Reembed] Fatal error:', err?.message || err);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
