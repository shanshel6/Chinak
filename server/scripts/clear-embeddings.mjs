import prisma from '../prismaClient.js';

async function main() {
  const result = await prisma.$executeRawUnsafe(`UPDATE "Product" SET "textEmbedding" = NULL WHERE "textEmbedding" IS NOT NULL`);
  console.log(`Cleared textEmbedding for all products`);
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });