import prisma from '../prismaClient.js';

function isSharedMemoryIndexError(err) {
  const prismaCode = String(err?.code || '');
  const dbCode = String(err?.meta?.code || '');
  const message = String(err?.meta?.message || err?.message || '');
  return (prismaCode === 'P2010' || dbCode === '53100')
    && /shared memory|No space left on device|could not resize shared memory segment/i.test(message);
}

async function createIndexOrWarn(sql, indexName) {
  try {
    await prisma.$executeRawUnsafe(sql);
    console.log(`Created index: ${indexName}`);
  } catch (err) {
    if (isSharedMemoryIndexError(err)) {
      console.warn(
        `Skipped index ${indexName} because PostgreSQL ran out of shared memory during index build. ` +
        'The embedding columns were still created, but vector search may be slower until the index is created on a larger database instance.'
      );
      return;
    }
    throw err;
  }
}

async function main() {
  await prisma.$connect();
  try {
    // Optimization for shared memory limits on Railway/Docker
    await prisma.$executeRawUnsafe(`SET max_parallel_maintenance_workers = 0;`);
    await prisma.$executeRawUnsafe(`SET maintenance_work_mem = '16MB';`);

    await prisma.$executeRawUnsafe(`
      CREATE EXTENSION IF NOT EXISTS vector;
    `);
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "Product"
      ADD COLUMN IF NOT EXISTS "imageEmbedding" vector(512);
    `);
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "Product"
      ALTER COLUMN "imageEmbedding" TYPE vector(512)
      USING CASE
        WHEN "imageEmbedding" IS NULL THEN NULL
        ELSE "imageEmbedding"::vector(512)
      END;
    `);
    await createIndexOrWarn(`
      CREATE INDEX IF NOT EXISTS "Product_imageEmbedding_hnsw"
      ON "Product"
      USING hnsw ("imageEmbedding" vector_cosine_ops);
    `, 'Product_imageEmbedding_hnsw');
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "ProductImage"
      ADD COLUMN IF NOT EXISTS "imageEmbedding" vector(512);
    `);
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "ProductImage"
      ALTER COLUMN "imageEmbedding" TYPE vector(512)
      USING CASE
        WHEN "imageEmbedding" IS NULL THEN NULL
        ELSE "imageEmbedding"::vector(512)
      END;
    `);
    await createIndexOrWarn(`
      CREATE INDEX IF NOT EXISTS "ProductImage_imageEmbedding_hnsw"
      ON "ProductImage"
      USING hnsw ("imageEmbedding" vector_cosine_ops);
    `, 'ProductImage_imageEmbedding_hnsw');
    console.log('Product and ProductImage image embedding columns are ready');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
