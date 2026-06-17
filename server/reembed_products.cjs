console.log('Starting re-embedding of all products with BGE-M3 (1024 dimensions)...');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Import the embedding function from aiService
const { generateEmbedding } = require('./services/aiService.js');

function buildEmbeddingContent(product) {
  const parts = [];
  if (product?.name) parts.push(`Title: ${product.name}`);
  if (product?.specs) parts.push(`Specs: ${product.specs}`);
  
  // Extract metadata tokens
  const metadataTokens = [];
  const pushToken = (token) => {
    const cleaned = String(token || '').replace(/[\\\/.,()!?;:]/g, ' ').replace(/['"`]/g, ' ').replace(/[%_]/g, ' ').replace(/\s+/g, ' ').trim();
    if (cleaned) metadataTokens.push(cleaned);
  };
  
  if (product?.aiMetadata) {
    const normalizeEmbeddingTokens = (value) => {
      if (!value) return [];
      const tokens = [];
      if (Array.isArray(value)) {
        value.forEach((item) => {
          if (Array.isArray(item) || typeof item === 'object') {
            normalizeEmbeddingTokens(item).forEach(pushToken);
          } else {
            pushToken(item);
          }
        });
        return tokens;
      }
      if (typeof value === 'object') {
        Object.values(value).forEach((item) => {
          normalizeEmbeddingTokens(item).forEach(pushToken);
        });
        return tokens;
      }
      pushToken(value);
      return tokens;
    };
    
    normalizeEmbeddingTokens(product.aiMetadata).forEach(pushToken);
  }
  
  if (metadataTokens.length > 0) {
    parts.push(`Metadata: ${metadataTokens.join(' ')}`);
  }
  
  return parts.join('\n');
}

async function reembedProduct(product) {
  try {
    console.log(`Processing product ${product.id}: ${product.name}`);
    
    const content = buildEmbeddingContent(product);
    const embedding = await generateEmbedding(content);
    
    if (!embedding || embedding.length !== 1024) {
      console.error(`Invalid embedding for product ${product.id}: length=${embedding?.length}`);
      return false;
    }
    
    const vectorStr = `[${embedding.join(',')}]`;
    const query = `
      UPDATE "Product"
      SET "embedding" = $1::vector
      WHERE "id" = $2
    `;
    
    await prisma.$executeRawUnsafe(query, vectorStr, product.id);
    console.log(`✅ Successfully re-embedded product ${product.id}`);
    return true;
  } catch (error) {
    console.error(`❌ Failed to re-embed product ${product.id}:`, error.message);
    return false;
  }
}

async function main() {
  try {
    console.log('1. Counting total products...');
    const totalProducts = await prisma.product.count();
    console.log(`Total products: ${totalProducts}`);
    
    console.log('2. Fetching products in batches...');
    const batchSize = 10;
    let processed = 0;
    let successful = 0;
    let failed = 0;
    
    for (let skip = 0; skip < totalProducts; skip += batchSize) {
      console.log(`\n--- Processing batch ${skip / batchSize + 1} (products ${skip + 1}-${Math.min(skip + batchSize, totalProducts)}) ---`);
      
      const products = await prisma.product.findMany({
        skip,
        take: batchSize,
        select: {
          id: true,
          name: true,
          specs: true,
          aiMetadata: true
        },
        orderBy: { id: 'asc' }
      });
      
      for (const product of products) {
        processed++;
        const success = await reembedProduct(product);
        if (success) {
          successful++;
        } else {
          failed++;
        }
        
        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      console.log(`Progress: ${processed}/${totalProducts} (${Math.round(processed / totalProducts * 100)}%)`);
    }
    
    console.log('\n✅ Re-embedding completed!');
    console.log(`Summary:`);
    console.log(`  Total products: ${totalProducts}`);
    console.log(`  Successfully re-embedded: ${successful}`);
    console.log(`  Failed: ${failed}`);
    console.log(`  Processed: ${processed}`);
    
  } catch (error) {
    console.error('❌ Critical error:', error.message);
    console.error(error);
  } finally {
    await prisma.$disconnect();
  }
}

main();