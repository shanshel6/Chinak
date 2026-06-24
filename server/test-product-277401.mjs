
import prisma from './prismaClient.js';
import { embedText } from './services/clipService.js';

async function testSearch() {
  console.log('=== TESTING PRODUCT 277401 ===');

  // Step 1: Load product 277401 from DB using raw SQL (cast vector to text)
  const productResult = await prisma.$queryRawUnsafe(`
    SELECT id, name, "aiMetadata", "textEmbedding"::text as "textEmbeddingStr", status, "isActive"
    FROM "Product"
    WHERE id = $1
  `, 277401);

  if (!productResult || productResult.length === 0) {
    console.error('❌ Product 277401 not found');
    await prisma.$disconnect();
    return;
  }

  const product = productResult[0];
  console.log('✅ Product found:', product.id);
  console.log('Product name (Arabic):', product.name);
  console.log('Product status:', product.status, 'isActive:', product.isActive);
  console.log('aiMetadata:', JSON.stringify(product.aiMetadata, null, 2));
  console.log('Has textEmbedding:', !!product.textEmbeddingStr);
  if (product.textEmbeddingStr) {
    console.log('textEmbedding (preview):', product.textEmbeddingStr.slice(0, 100));
  }

  // Step 2: Generate embedding for search query
  const searchQuery = "High-Pressure Drain Unclogging Tool One Shot";
  console.log('\n=== Generating embedding for search query ===');
  const queryEmbedding = await embedText(searchQuery);
  console.log('Generated query embedding, length:', queryEmbedding.length);

  // Step 3: Search using this embedding via raw SQL
  console.log('\n=== Searching for similar products ===');
  const searchResults = await prisma.$queryRawUnsafe(`
    SELECT
      id,
      1 - ("textEmbedding" <=> $1::vector) AS similarity,
      ("textEmbedding" <=> $1::vector) AS distance
    FROM "Product"
    WHERE "textEmbedding" IS NOT NULL
      AND status = 'PUBLISHED'
      AND "isActive" = true
    ORDER BY "textEmbedding" <=> $1::vector ASC
    LIMIT 50
  `, JSON.stringify(queryEmbedding));

  console.log('Search results count:', searchResults.length);

  // Step 4: Check if product 277401 is in results
  const found = searchResults.find(r => r.id === 277401);
  if (found) {
    console.log('🎉✅ Product 277401 found in search results!');
    console.log('Position:', searchResults.indexOf(found) + 1);
    console.log('Similarity:', found.similarity);
    console.log('Distance:', found.distance);
  } else {
    console.log('❌ Product 277401 NOT found in search results');
    console.log('Top 10 results:');
    searchResults.slice(0, 10).forEach((r, i) => {
      console.log(`${i+1}. ID: ${r.id}, Similarity: ${r.similarity}`);
    });
  }

  await prisma.$disconnect();
}

testSearch().catch(console.error);
