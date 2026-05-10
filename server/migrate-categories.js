import { PrismaClient } from '@prisma/client';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.join(__dirname, '..', '.env');
dotenv.config({ path: envPath, override: true });

const CATEGORIES_SEED_PATH = path.join(__dirname, 'scripts', 'canonical-categories.seed.json');

// Explicitly use the Railway database URL
const DATABASE_URL = process.env.GOOFISH_DATABASE_URL || process.env.DATABASE_URL;

console.log('Starting category migration...');
console.log('Database URL:', DATABASE_URL.replace(/:[^:@]+@/, ':****@'));

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: DATABASE_URL
    }
  }
});

async function migrateCategories() {
  let retryCount = 0;
  const maxRetries = 3;
  
  while (retryCount < maxRetries) {
    try {
      console.log('Connecting to database...');
      await prisma.$connect();
      console.log('✓ Connected to database');

      // Load categories from seed file
      console.log('Loading categories from seed file...');
      const categoriesData = JSON.parse(fs.readFileSync(CATEGORIES_SEED_PATH, 'utf8'));
      console.log(`✓ Loaded ${categoriesData.length} categories from seed file`);

      // Insert categories into database in batches
      console.log('Inserting categories into database in batches...');
      const BATCH_SIZE = 50; // Reduced batch size to avoid connection timeouts
      let insertedCount = 0;
      let skippedCount = 0;
      
      for (let i = 0; i < categoriesData.length; i += BATCH_SIZE) {
        const batch = categoriesData.slice(i, i + BATCH_SIZE);
        
        try {
          // Try to create batch
          await prisma.category.createMany({
            data: batch.map(cat => ({
              slug: cat.slug,
              nameAr: cat.name_ar,
              nameEn: cat.name_en
            })),
            skipDuplicates: true
          });
          insertedCount += batch.length;
          console.log(`  - Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(categoriesData.length / BATCH_SIZE)}: Inserted ${batch.length} categories`);
        } catch (err) {
          // If batch fails due to duplicates, insert one by one
          if (err.code === 'P2002' || err.message.includes('unique constraint')) {
            console.log(`  - Batch ${Math.floor(i / BATCH_SIZE) + 1}: Has duplicates, inserting one by one...`);
            for (const category of batch) {
              try {
                await prisma.category.create({
                  data: {
                    slug: category.slug,
                    nameAr: category.name_ar,
                    nameEn: category.name_en
                  }
                });
                insertedCount++;
              } catch (dupErr) {
                if (dupErr.code === 'P2002') {
                  skippedCount++;
                } else {
                  console.error(`  - Failed to insert category "${category.slug}":`, dupErr.message);
                }
              }
            }
          } else {
            console.error(`  - Batch ${Math.floor(i / BATCH_SIZE) + 1} failed:`, err.message);
          }
        }
        
        console.log(`  - Progress: ${insertedCount + skippedCount}/${categoriesData.length} categories processed`);
      }
      
      console.log(`✓ Inserted ${insertedCount} categories into database`);
      console.log(`✓ Skipped ${skippedCount} existing categories`);

      // Update products with category references
      console.log('Updating products with category references...');
      const products = await prisma.product.findMany({
        where: {
          categoryId: null
        }
      });
      console.log(`✓ Found ${products.length} products without category reference`);

      let updatedCount = 0;
      for (const product of products) {
        if (product.aiMetadata) {
          const categorySlug = product.aiMetadata.categorySlug;
          if (categorySlug) {
            const category = await prisma.category.findUnique({
              where: { slug: categorySlug }
            });
            if (category) {
              await prisma.product.update({
                where: { id: product.id },
                data: { categoryId: category.id }
              });
              updatedCount++;
              if (updatedCount % 100 === 0) {
                console.log(`  - Updated ${updatedCount} products...`);
              }
            }
          }
        }
      }
      console.log(`✓ Updated ${updatedCount} products with category references`);

      await prisma.$disconnect();
      console.log('✓ Disconnected successfully');
      console.log('\nMigration completed successfully!');
      process.exit(0);
    } catch (error) {
      retryCount++;
      console.error(`✗ Migration attempt ${retryCount}/${maxRetries} failed:`, error.message);
      
      if (retryCount >= maxRetries) {
        console.error('✗ All retry attempts exhausted');
        await prisma.$disconnect();
        process.exit(1);
      }
      
      console.log('Retrying in 3 seconds...');
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Reconnect
      try {
        await prisma.$disconnect();
      } catch (e) {
        // Ignore disconnect errors
      }
    }
  }
}

migrateCategories();
