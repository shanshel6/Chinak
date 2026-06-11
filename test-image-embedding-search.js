
import prisma from './server/prismaClient.js';
import { embedText } from './server/services/clipService.js';
import { searchProductsByImageVector } from './server/services/productImageVectorService.js';

async function main() {
  console.log('=== Testing Image Embedding Search ===');
  
  // 1. First check products with embeddings using raw SQL
  console.log('\n1. Checking products with embeddings...');
  const productsWithLegacyEmbedding = await prisma.$queryRaw`
    SELECT id, name, price, image
    FROM "Product"
    WHERE "imageEmbedding" IS NOT NULL
    AND "status" = 'PUBLISHED'
    AND "isActive" = true
    LIMIT 10
  `;
  console.log(`Products with legacy imageEmbedding: ${productsWithLegacyEmbedding.length}`);
  if (productsWithLegacyEmbedding.length > 0) {
    productsWithLegacyEmbedding.forEach(p => {
      console.log(`  - [${p.id}] ${p.name}`);
    });
  }

  const productImagesWithEmbedding = await prisma.$queryRaw`
    SELECT id, "productId", url
    FROM "ProductImage"
    WHERE "imageEmbedding" IS NOT NULL
    LIMIT 10
  `;
  console.log(`ProductImages with imageEmbedding: ${productImagesWithEmbedding.length}`);
  if (productImagesWithEmbedding.length > 0) {
    productImagesWithEmbedding.forEach(pi => {
      console.log(`  - [${pi.id}] Product ${pi.productId}: ${pi.url}`);
    });
  }

  // 2. Test text embedding
  console.log('\n2. Testing text embedding...');
  const testQueries = [
    'phone case',
    'حاسوب محمول', // laptop in Arabic
    'سماعات بلوتوث', // bluetooth headphones in Arabic
    'شاحن سريع' // fast charger in Arabic
  ];

  for (const query of testQueries) {
    console.log(`\n   Testing query: "${query}"`);
    try {
      const embedding = await embedText(query);
      console.log(`   ✓ Generated embedding (length: ${embedding.length})`);

      // 3. Test search by vector
      const matches = await searchProductsByImageVector(prisma, embedding, 10, 0);
      console.log(`   ✓ Found ${matches.length} matches`);

      if (matches.length > 0) {
        console.log('\n   Top results:');
        for (let i = 0; i < matches.length; i++) {
          const match = matches[i];
          const product = await prisma.product.findUnique({
            where: { id: match.id },
            select: { id: true, name: true, price: true, image: true }
          });
          if (product) {
            console.log(`   ${i+1}. [ID: ${product.id}] Similarity: ${(match.similarity * 100).toFixed(1)}% - ${product.name}`);
          }
        }
      }
    } catch (err) {
      console.error(`   ✗ Failed: ${err.message}`);
      console.error(err.stack);
    }
  }

  await prisma.$disconnect();
}

main().catch(console.error);
