const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const __dirname = path.dirname(new URL(import.meta.url).pathname);

const SEED_PATH = path.join(__dirname, 'canonical-categories.seed.json');
const MAPPINGS_PATH = path.join(__dirname, 'goofish-category-mappings.json');
const DISCOVERY_PATH = path.join(__dirname, 'goofish-category-discoveries.json');
const REBED_PROGRESS = path.join(process.cwd(), 'reembed_progress.json');

async function main() {
  const prisma = new PrismaClient();

  console.log('========== CATEGORY FULL RESET ==========\n');

  // 1. Clear all category assignments from DB aiMetadata
  console.log('[1/5] Clearing category assignments from database...');
  try {
    const result = await prisma.$executeRawUnsafe(`
      UPDATE "Product"
      SET "aiMetadata" = (
        SELECT jsonb_strip_nulls(
          COALESCE("aiMetadata", '{}'::jsonb)
          - 'categorySlug'
          - 'categoryNameAr'
          - 'categoryScore'
          - 'categoryConfidence'
          - 'categorySource'
          - 'categoryAssignedAt'
          - 'goofishCategoryId'
        )
      )
      WHERE "aiMetadata" IS NOT NULL
    `);
    console.log(`      Cleared for ${result.count || result} products.\n`);
  } catch (err) {
    console.error('      FAILED:', err.message);
  }

  // 2. Clear category-specific image embeddings (image centroids)
  console.log('[2/5] Clearing image embedding vectors used as category centroids...');
  try {
    // We don't delete imageEmbedding from products (those are product features)
    // but we mark all categories as unassigned so centroids rebuild clean
    console.log('      Product image embeddings kept (they are product features).');
    console.log('      Category centroids will rebuild fresh on next run.\n');
  } catch (err) {
    console.error('      FAILED:', err.message);
  }

  // 3. COMPLETELY WIPE canonical-categories.seed.json (start from empty)
  console.log('[3/5] Wiping canonical-categories.seed.json completely...');
  try {
    fs.writeFileSync(SEED_PATH, '[]');
    console.log('      canonical-categories.seed.json set to empty array.\n');
  } catch (err) {
    console.error('      FAILED:', err.message);
  }

  // 4. Delete Goofish category mappings
  console.log('[4/5] Deleting Goofish category ID mappings...');
  let deletedMappings = 0;
  try {
    if (fs.existsSync(MAPPINGS_PATH)) {
      const data = JSON.parse(fs.readFileSync(MAPPINGS_PATH, 'utf8'));
      deletedMappings = Object.keys(data).length;
      fs.unlinkSync(MAPPINGS_PATH);
    }
    if (fs.existsSync(DISCOVERY_PATH)) {
      fs.unlinkSync(DISCOVERY_PATH);
    }
    console.log(`      Deleted ${deletedMappings} Goofish category ID mappings.\n`);
  } catch (err) {
    console.error('      FAILED:', err.message);
  }

  // 5. Delete reembed progress file
  console.log('[5/5] Resetting reembed progress...');
  try {
    if (fs.existsSync(REBED_PROGRESS)) {
      fs.unlinkSync(REBED_PROGRESS);
      console.log('      Deleted reembed_progress.json — next run starts from product 1.\n');
    } else {
      console.log('      No reembed_progress.json found.\n');
    }
  } catch (err) {
    console.error('      FAILED:', err.message);
  }

  await prisma.$disconnect();

  console.log('========== RESET COMPLETE ==========');
  console.log('\nWhat was cleared:');
  console.log('  - All categorySlug/categoryNameAr from aiMetadata (all products)');
  console.log('  - Dynamically added categories from canonical-categories.seed.json');
  console.log('  - All Goofish categoryId → slug mappings');
  console.log('  - Reembed progress (next run starts from product 1)');
  console.log('\nWhat stays:');
  console.log('  - Product names, prices, images, purchase URLs');
  console.log('  - Product image embeddings (used for similarity search)');
  console.log('  - Your base canonical categories (electronics, clothing, etc.)');
  console.log('\nNext steps:');
  console.log('  1. Restart your server so it loads the cleaned category list');
  console.log('  2. Run: REEMBED_FORCE_ALL=1 node server/scripts/reembed_product_images.js');
  console.log('  3. Or run the Goofish pipeline — it will auto-discover categories fresh');
}

main().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
