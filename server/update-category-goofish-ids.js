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

const DATABASE_URL = process.env.GOOFISH_DATABASE_URL || process.env.DATABASE_URL;

// Resume from this category slug (set to null to start from beginning)
const RESUME_FROM_SLUG = "colored_pencils"; // Change this to resume from a specific category

// Timeout settings
const TIMEOUT_MS = 30000; // 30 seconds timeout
const DB_OP_TIMEOUT_MS = 15000; // 15 seconds timeout for individual DB operations

console.log('Updating categories with goofish category IDs...');
console.log('Database URL:', DATABASE_URL.replace(/:[^:@]+@/, ':****@'));
if (RESUME_FROM_SLUG) {
  console.log(`Resuming from category: ${RESUME_FROM_SLUG}`);
}

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: DATABASE_URL
    }
  }
});

function withTimeout(promise, ms, operationName) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout: ${operationName} took more than ${ms}ms`)), ms)
    )
  ]);
}

async function updateCategories() {
  let retryCount = 0;
  const maxRetries = 5;
  let lastProgressTime = Date.now();

  while (retryCount < maxRetries) {
    try {
      await prisma.$connect();
      console.log('✓ Connected to database');

      // Load categories from seed file
      console.log('Loading categories from seed file...');
      const categoriesData = JSON.parse(fs.readFileSync(CATEGORIES_SEED_PATH, 'utf8'));
      console.log(`✓ Loaded ${categoriesData.length} categories from seed file`);

      let updatedCount = 0;
      let skippedCount = 0;
      let notFoundCount = 0;
      let alreadyHasIdCount = 0;
      let resumeIndex = 0;

      // Find resume index if specified
      if (RESUME_FROM_SLUG) {
        resumeIndex = categoriesData.findIndex(c => c.slug === RESUME_FROM_SLUG);
        if (resumeIndex === -1) {
          console.log(`Resume category "${RESUME_FROM_SLUG}" not found, starting from beginning`);
          resumeIndex = 0;
        } else {
          console.log(`Resuming from index ${resumeIndex} (${RESUME_FROM_SLUG})`);
        }
      }

      for (let i = resumeIndex; i < categoriesData.length; i++) {
        const category = categoriesData[i];

        // Check for timeout
        const now = Date.now();
        if (now - lastProgressTime > TIMEOUT_MS) {
          console.log(`\n⚠ Timeout detected (${TIMEOUT_MS}ms without progress)`);
          console.log(`Saving resume point at: ${category.slug}`);
          
          // Update the resume slug in this file
          const scriptPath = path.join(__dirname, 'update-category-goofish-ids.js');
          let scriptContent = fs.readFileSync(scriptPath, 'utf8');
          scriptContent = scriptContent.replace(
            /const RESUME_FROM_SLUG = "[^"]+"/,
            `const RESUME_FROM_SLUG = "${category.slug}"`
          );
          fs.writeFileSync(scriptPath, scriptContent);
          
          console.log('✓ Resume point saved. Restarting...');
          await prisma.$disconnect();
          throw new Error('TIMEOUT_RESTART');
        }

        // Progress logging every 50 categories
        if (i % 50 === 0) {
          console.log(`Processing category ${i}/${categoriesData.length}...`);
          lastProgressTime = Date.now();
        }

        if (!category.discovered_from) {
          skippedCount++;
          continue;
        }

        try {
          // Check connection and reconnect if needed
          try {
            await withTimeout(prisma.$queryRaw`SELECT 1`, DB_OP_TIMEOUT_MS, 'Connection check');
          } catch (connErr) {
            console.log('Connection lost, reconnecting...');
            await prisma.$disconnect();
            await prisma.$connect();
          }

          // Check if category already has goofishCategoryId
          const existing = await withTimeout(
            prisma.category.findUnique({
              where: { slug: category.slug },
              select: { goofishCategoryId: true }
            }),
            DB_OP_TIMEOUT_MS,
            'Find category'
          );

          if (existing?.goofishCategoryId) {
            alreadyHasIdCount++;
            lastProgressTime = Date.now();
            continue;
          }

          const result = await withTimeout(
            prisma.category.updateMany({
              where: { slug: category.slug },
              data: { goofishCategoryId: category.discovered_from }
            }),
            DB_OP_TIMEOUT_MS,
            'Update category'
          );

          if (result.count > 0) {
            updatedCount++;
            console.log(`  ✓ Updated category "${category.slug}" with goofishCategoryId: ${category.discovered_from}`);
            lastProgressTime = Date.now();
          } else {
            notFoundCount++;
            console.log(`  ✗ Category "${category.slug}" not found in database`);
            lastProgressTime = Date.now();
          }
        } catch (err) {
          console.error(`  ✗ Failed to update category "${category.slug}":`, err.message);
          // If it's a connection error, try to reconnect
          if (err.message.includes('closed') || err.message.includes('timeout')) {
            console.log('Attempting to reconnect...');
            try {
              await prisma.$disconnect();
              await prisma.$connect();
              lastProgressTime = Date.now();
            } catch (reconnectErr) {
              console.error('Reconnection failed:', reconnectErr.message);
              throw err; // Re-throw to trigger retry
            }
          }
        }
      }

      console.log(`\n✓ Updated ${updatedCount} categories with goofishCategoryId`);
      console.log(`✓ Skipped ${skippedCount} categories without goofishCategoryId in seed file`);
      console.log(`✓ ${alreadyHasIdCount} categories already had goofishCategoryId`);
      console.log(`✓ ${notFoundCount} categories not found in database`);

      await prisma.$disconnect();
      console.log('\n✓ Disconnected successfully');
      console.log('\nUpdate completed successfully!');
      process.exit(0);
    } catch (error) {
      if (error.message === 'TIMEOUT_RESTART') {
        console.log('Restarting due to timeout...');
        retryCount = 0; // Reset retry count for timeout restart
        continue;
      }

      retryCount++;
      console.error(`✗ Update attempt ${retryCount}/${maxRetries} failed:`, error.message);
      
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

updateCategories();
