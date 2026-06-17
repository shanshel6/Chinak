/**
 * Check all existing embeddings in the database
 * Run: node check_existing_embeddings.cjs
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('=== Existing Embeddings Report ===\n');

  // 1. Product text embeddings
  const productEmbStats = await prisma.$queryRaw`
    SELECT
      COUNT(*)::int as total,
      COUNT(embedding)::int as with_embedding,
      COUNT("imageEmbedding")::int as with_image_embedding
    FROM "Product"
  `;
  console.log('--- Product Table ---');
  console.log(`  Total products:              ${productEmbStats[0].total}`);
  console.log(`  With text embedding:         ${productEmbStats[0].with_embedding}`);
  console.log(`  With imageEmbedding:         ${productEmbStats[0].with_image_embedding}`);

  // 2. ProductImage embeddings
  const imgEmbStats = await prisma.$queryRaw`
    SELECT
      COUNT(*)::int as total,
      COUNT("imageEmbedding")::int as with_embedding
    FROM "ProductImage"
  `;
  console.log('\n--- ProductImage Table ---');
  console.log(`  Total images:                ${imgEmbStats[0].total}`);
  console.log(`  With imageEmbedding:         ${imgEmbStats[0].with_embedding}`);

  // 3. Check embedding dimensions (sample)
  if (productEmbStats[0].with_embedding > 0) {
    const sample = await prisma.$queryRaw`
      SELECT id, length(embedding::text) as text_len
      FROM "Product"
      WHERE embedding IS NOT NULL
      LIMIT 3
    `;
    console.log('\n--- Sample Product Embedding Sizes ---');
    for (const r of sample) {
      console.log(`  Product ${r.id}: text_len=${r.text_len}`);
    }
  }

  if (imgEmbStats[0].with_embedding > 0) {
    const sample = await prisma.$queryRaw`
      SELECT id, length("imageEmbedding"::text) as text_len
      FROM "ProductImage"
      WHERE "imageEmbedding" IS NOT NULL
      LIMIT 3
    `;
    console.log('\n--- Sample ProductImage Embedding Sizes ---');
    for (const r of sample) {
      console.log(`  ProductImage ${r.id}: text_len=${r.text_len}`);
    }
  }

  // 4. Check if any products have aiMetadata with embedding-related data
  const aiMetaCount = await prisma.$queryRaw`
    SELECT COUNT(*)::int as cnt FROM "Product" WHERE "aiMetadata" IS NOT NULL
  `;
  console.log(`\n--- AI Metadata ---`);
  console.log(`  Products with aiMetadata:    ${aiMetaCount[0].cnt}`);

  console.log('\n=== Done ===');
}

main().catch(e => console.error(e)).finally(() => prisma.$disconnect());
