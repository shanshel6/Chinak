import prisma from './prismaClient.js';

async function main() {
  const count1 = await prisma.$queryRawUnsafe('SELECT count(*) FROM "Product" WHERE "imageEmbedding" IS NOT NULL');
  const count2 = await prisma.$queryRawUnsafe('SELECT count(*) FROM "Product"');
  console.log('Total products with embeddings:', count1);
  console.log('Total products in database:', count2);
}

main().finally(() => prisma.$disconnect());
