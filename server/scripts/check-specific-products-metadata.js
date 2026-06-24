import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkProducts() {
  const ids = [494, 495, 496, 497];
  console.log(`Checking products: ${ids.join(', ')}\n`);

  try {
    const products = await prisma.$queryRaw`
      SELECT id, name, "aiMetadata", "textEmbedding"::text as "textEmbeddingStr"
      FROM "Product"
      WHERE id IN (494, 495, 496, 497)
    `;

    products.forEach(p => {
      console.log(`--- Product #${p.id} ---`);
      console.log(`Name: ${p.name}`);
      console.log(`aiMetadata: ${JSON.stringify(p.aiMetadata, null, 2)}`);
      const hasEmbedding = p.textEmbeddingStr !== null;
      console.log(`Has textEmbedding: ${hasEmbedding}`);
      if (hasEmbedding) {
          // Just show a snippet of the vector string
          console.log(`Embedding Preview: ${p.textEmbeddingStr.slice(0, 50)}...`);
      }
      console.log('');
    });
  } catch (error) {
    console.error('Error querying database:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkProducts();
