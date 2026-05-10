import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.join(__dirname, '..', '.env');
dotenv.config({ path: envPath });

const prisma = new PrismaClient();

const SEED_PATH = path.join(__dirname, 'canonical-categories.seed.json');
const BATCH_SIZE = 100;

// Load categories
function loadCategories() {
  try {
    const data = fs.readFileSync(SEED_PATH, 'utf8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

// Update category in all products for a specific category
async function updateCategoryInProducts(categorySlug, newNameAr, newNameEn) {
  try {
    const timestamp = new Date().toISOString();
    const result = await prisma.$executeRawUnsafe(`
      UPDATE "Product"
      SET "aiMetadata" = jsonb_set(
        jsonb_set(
          jsonb_set(
            COALESCE("aiMetadata", '{}'::jsonb),
            '{categoryNameAr}',
            $1::jsonb
          ),
          '{categoryNameEn}',
          $2::jsonb
        ),
        '{categoryUpdatedAt}',
        $3::jsonb
      )
      WHERE "isActive" = true
        AND status = 'PUBLISHED'
        AND "aiMetadata"->>'categorySlug' = $4
    `, newNameAr, newNameEn, timestamp, categorySlug);
    
    return result;
  } catch (error) {
    console.error(`Error updating products for category ${categorySlug}:`, error.message);
    return 0;
  }
}

// Main function
async function main() {
  console.log('========================================');
  console.log('  BULK CATEGORY NAME UPDATE');
  console.log('========================================\n');

  const categories = loadCategories();
  console.log(`Loaded ${categories.length} categories from seed file\n`);

  let updatedCount = 0;
  let totalProductsUpdated = 0;

  for (let i = 0; i < categories.length; i++) {
    const category = categories[i];
    console.log(`[${i + 1}/${categories.length}] Updating products for category: ${category.slug} (${category.name_en})`);

    const productsUpdated = await updateCategoryInProducts(category.slug, category.name_ar, category.name_en);
    
    if (productsUpdated > 0) {
      totalProductsUpdated += productsUpdated;
      updatedCount++;
      console.log(`  Updated ${productsUpdated} products\n`);
    } else {
      console.log(`  No products found with this category\n`);
    }

    // Progress update every 50 categories
    if ((i + 1) % 50 === 0) {
      console.log(`[Progress] ${i + 1}/${categories.length} categories processed, ${totalProductsUpdated} products updated total\n`);
    }
  }

  console.log('\n========================================');
  console.log('  BULK UPDATE COMPLETE');
  console.log('========================================');
  console.log(`Total categories: ${categories.length}`);
  console.log(`Categories with updates: ${updatedCount}`);
  console.log(`Total products updated: ${totalProductsUpdated}\n`);

  await prisma.$disconnect();
}

(async () => {
  try {
    await main();
  } catch (error) {
    console.error('Error:', error);
    await prisma.$disconnect();
    process.exit(1);
  }
})();
