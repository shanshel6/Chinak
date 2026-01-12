import prisma from '../prismaClient.js';

async function checkData() {
  try {
    const products = await prisma.product.findMany({
      take: 5,
      select: {
        id: true,
        name: true,
        aiMetadata: true,
        // embedding is Unsupported, so we can't select it directly via Prisma
      }
    });

    console.log('Sample Products:');
    products.forEach(p => {
      console.log(`ID: ${p.id}, Name: ${p.name}`);
      console.log(`AI Metadata: ${JSON.stringify(p.aiMetadata, null, 2)}`);
      console.log('---');
    });

    // Check if any product has an embedding using raw query
    const embeddingCount = await prisma.$queryRaw`SELECT count(*) FROM "Product" WHERE embedding IS NOT NULL`;
    console.log('Products with embeddings:', embeddingCount);

  } catch (error) {
    console.error('Error checking data:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkData();
