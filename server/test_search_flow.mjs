
import prisma from './prismaClient.js';
import { embedText } from './services/clipService.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  console.log('=== Starting Search Flow Test ===');

  // 1. The search query
  const searchQuery = "High-Pressure Drain Unclogging Tool One Shot";
  console.log('Search Query:', searchQuery);

  // 2. Generate text embedding using CLIP (same as client/server uses)
  console.log('\nStep 1: Generating CLIP embedding...');
  const queryEmbedding = await embedText(searchQuery);
  console.log('✓ Embedding generated, length:', queryEmbedding.length);

  // 3. Search the database for similar products
  console.log('\nStep 2: Searching database...');
  const searchResults = await prisma.$queryRawUnsafe(`
    SELECT
      id,
      name,
      "aiMetadata",
      status,
      "isActive",
      1 - ("textEmbedding" <=> $1::vector) AS similarity,
      ("textEmbedding" <=> $1::vector) AS distance
    FROM "Product"
    WHERE "textEmbedding" IS NOT NULL
      AND status = 'PUBLISHED'
      AND "isActive" = true
    ORDER BY "textEmbedding" <=> $1::vector ASC
    LIMIT 50
  `, JSON.stringify(queryEmbedding));

  console.log(`✓ Found ${searchResults.length} products`);

  // 4. Check if product 277401 is in the results
  console.log('\nStep 3: Checking for product 277401...');
  const targetProductId = 277401;
  const foundProduct = searchResults.find(p => p.id === targetProductId);
  
  if (foundProduct) {
    const position = searchResults.indexOf(foundProduct) + 1;
    console.log(`🎉✓ FOUND! Product ${targetProductId} is at position ${position} with similarity ${(foundProduct.similarity * 100).toFixed(2)}%`);
  } else {
    console.log(`❌ NOT FOUND! Product ${targetProductId} is NOT in the top ${searchResults.length} results`);
  }

  // 5. Save results to JSON file
  console.log('\nStep 4: Saving results to JSON file...');
  const resultsJson = {
    searchQuery,
    queryEmbedding,
    resultsCount: searchResults.length,
    targetProductFound: !!foundProduct,
    targetProductPosition: foundProduct ? searchResults.indexOf(foundProduct) + 1 : null,
    targetProductData: foundProduct,
    allResults: searchResults.map((r, idx) => ({
      position: idx + 1,
      id: r.id,
      name: r.name,
      aiMetadata: r.aiMetadata,
      similarity: r.similarity,
      distance: r.distance
    }))
  };

  const outputPath = path.join(__dirname, 'test_search_results.json');
  await fs.writeFile(outputPath, JSON.stringify(resultsJson, null, 2), 'utf8');
  
  console.log(`✓ Results saved to: ${outputPath}`);

  await prisma.$disconnect();
  console.log('\n=== Test Complete ===');
}

main().catch(error => {
  console.error('Error during test:', error);
  process.exit(1);
});
