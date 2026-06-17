/**
 * Clear all old vector embeddings from the database.
 * 
 * SAFE: Only deletes vector embedding columns. Does NOT touch:
 *   - Product name, price, description, specs, images, etc.
 *   - aiMetadata (product scraped data)
 *   - ProductImage URLs
 *   - Any other product data
 * 
 * What it clears:
 *   - Product.embedding (text search vector)
 *   - Product.imageEmbedding (image vector on Product)
 *   - ProductImage.imageEmbedding (image vectors on ProductImage)
 * 
 * Usage: node clear_old_embeddings.cjs [--dry-run]
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Clear Old Vector Embeddings');
  if (DRY_RUN) console.log('  ⚠️  DRY RUN — no changes will be made');
  console.log('═══════════════════════════════════════════════\n');

  // ── Count what will be affected ──────────────────────────────────
  const stats = await prisma.$queryRaw`
    SELECT
      COUNT(*)::int as total_products,
      COUNT(embedding)::int as with_text_embedding,
      COUNT("imageEmbedding")::int as with_image_embedding
    FROM "Product"
  `;

  const imgStats = await prisma.$queryRaw`
    SELECT
      COUNT(*)::int as total_images,
      COUNT("imageEmbedding")::int as with_embedding
    FROM "ProductImage"
  `;

  console.log('--- Current Embedding Counts ---');
  console.log(`  Products with text embedding:    ${stats[0].with_text_embedding}`);
  console.log(`  Products with image embedding:   ${stats[0].with_image_embedding}`);
  console.log(`  ProductImages with embedding:    ${imgStats[0].with_embedding}`);
  console.log(`  Total products (unchanged):      ${stats[0].total_products}`);
  console.log(`  Total images (unchanged):        ${imgStats[0].total_images}`);
  console.log();

  const totalToClear = stats[0].with_text_embedding + stats[0].with_image_embedding + imgStats[0].with_embedding;

  if (totalToClear === 0) {
    console.log('✅ No embeddings to clear. Database is already clean.');
    return;
  }

  console.log(`Will clear ${totalToClear} embedding vectors total.`);
  console.log(`All other data (names, prices, images, aiMetadata) will be preserved.\n`);

  if (DRY_RUN) {
    console.log('⚠️  Dry run — skipping actual deletion.');
    console.log('   Run without --dry-run to execute.');
    return;
  }

  // ── Confirm ──────────────────────────────────────────────────────
  console.log('Clearing embeddings...\n');

  // 1. Clear Product.text embedding
  if (stats[0].with_text_embedding > 0) {
    console.log(`  Clearing ${stats[0].with_text_embedding} Product.embedding values...`);
    const r = await prisma.$executeRawUnsafe(`
      UPDATE "Product" SET "embedding" = NULL WHERE "embedding" IS NOT NULL
    `);
    console.log(`    ✅ Cleared ${r} rows`);
  }

  // 2. Clear Product.imageEmbedding
  if (stats[0].with_image_embedding > 0) {
    console.log(`  Clearing ${stats[0].with_image_embedding} Product.imageEmbedding values...`);
    const r = await prisma.$executeRawUnsafe(`
      UPDATE "Product" SET "imageEmbedding" = NULL WHERE "imageEmbedding" IS NOT NULL
    `);
    console.log(`    ✅ Cleared ${r} rows`);
  }

  // 3. Clear ProductImage.imageEmbedding
  if (imgStats[0].with_embedding > 0) {
    console.log(`  Clearing ${imgStats[0].with_embedding} ProductImage.imageEmbedding values...`);
    const r = await prisma.$executeRawUnsafe(`
      UPDATE "ProductImage" SET "imageEmbedding" = NULL WHERE "imageEmbedding" IS NOT NULL
    `);
    console.log(`    ✅ Cleared ${r} rows`);
  }

  // ── Verify ──────────────────────────────────────────────────────
  const verify = await prisma.$queryRaw`
    SELECT
      COUNT(embedding)::int as text_emb,
      COUNT("imageEmbedding")::int as img_emb
    FROM "Product"
  `;
  const verifyImg = await prisma.$queryRaw`
    SELECT COUNT("imageEmbedding")::int as img_emb
    FROM "ProductImage"
  `;

  console.log('\n--- After Cleanup ---');
  console.log(`  Product.text embeddings:         ${verify[0].text_emb}`);
  console.log(`  Product.image embeddings:        ${verify[0].img_emb}`);
  console.log(`  ProductImage embeddings:         ${verifyImg[0].img_emb}`);

  // Verify no data was lost
  const dataCheck = await prisma.$queryRaw`
    SELECT
      COUNT(*)::int as total_products,
      COUNT(name)::int as with_name,
      COUNT(price)::int as with_price,
      COUNT(image)::int as with_image,
      COUNT("aiMetadata")::int as with_metadata
    FROM "Product"
  `;

  console.log('\n--- Data Integrity Check ---');
  console.log(`  Total products:                  ${dataCheck[0].total_products}`);
  console.log(`  Products with names:             ${dataCheck[0].with_name}`);
  console.log(`  Products with prices:            ${dataCheck[0].with_price}`);
  console.log(`  Products with images:            ${dataCheck[0].with_image}`);
  console.log(`  Products with aiMetadata:        ${dataCheck[0].with_metadata}`);

  console.log('\n═══════════════════════════════════════════════');
  console.log('  ✅ Embeddings cleared successfully!');
  console.log('  All product data preserved.');
  console.log('═══════════════════════════════════════════════');
}

main()
  .catch(err => { console.error('Error:', err); process.exit(1); })
  .finally(() => prisma.$disconnect());
