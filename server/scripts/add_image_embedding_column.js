import prisma from '../prismaClient.js';

async function main() {
  await prisma.$connect();
  try {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "Product"
      ADD COLUMN IF NOT EXISTS "imageEmbedding" vector(512);
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "Product_imageEmbedding_hnsw"
      ON "Product"
      USING hnsw ("imageEmbedding" vector_cosine_ops);
    `);
    console.log('imageEmbedding column and index are ready');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

