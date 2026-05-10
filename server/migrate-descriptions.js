import { PrismaClient } from '@prisma/client';
import { fileURLToPath } from 'url';
import path from 'path';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.join(__dirname, '..', '.env');
dotenv.config({ path: envPath, override: true });

const DATABASE_URL = process.env.GOOFISH_DATABASE_URL || process.env.DATABASE_URL;

console.log('Migrating descriptions from aiMetadata to description field...');
console.log('Database URL:', DATABASE_URL.replace(/:[^:@]+@/, ':****@'));

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: DATABASE_URL
    }
  }
});

async function migrateDescriptions() {
  try {
    console.log('Connecting to database...');
    await prisma.$connect();
    console.log('✓ Connected to database');

    // Fetch all products using raw SQL
    console.log('Fetching all products...');
    const products = await prisma.$queryRawUnsafe(`
      SELECT id, "description", "aiMetadata"
      FROM "Product"
    `);

    console.log(`Found ${products.length} products`);

    let updatedCount = 0;
    let skippedCount = 0;

    for (const product of products) {
      console.log(`Processing Product ${product.id}...`);
      
      // Skip if description already exists
      if (product.description && product.description.trim()) {
        console.log(`  → Has description, skipping`);
        skippedCount++;
        continue;
      }

      // Extract description from aiMetadata
      let meta = product.aiMetadata;
      console.log(`  → Metadata type: ${typeof meta}`);
      console.log(`  → Metadata value: ${JSON.stringify(meta).substring(0, 200)}...`);
      
      if (typeof meta === 'string') {
        try {
          meta = JSON.parse(meta);
          console.log(`  → Parsed metadata successfully`);
        } catch {
          console.log(`  → Failed to parse metadata as JSON`);
          meta = null;
        }
      }

      const metaDescription = meta?.translatedDescription
        ?? meta?.translatedDesc
        ?? meta?.descriptionAr
        ?? meta?.description_ar
        ?? meta?.product_description
        ?? meta?.description
        ?? '';

      console.log(`  → Extracted description: ${metaDescription.substring(0, 100)}...`);

      if (!metaDescription || !metaDescription.trim()) {
        console.log(`⚠️ Skipping Product ${product.id}: no description in metadata`);
        skippedCount++;
        continue;
      }

      // Update product with description from metadata
      await prisma.$executeRawUnsafe(`
        UPDATE "Product"
        SET "description" = $1,
            "updatedAt" = NOW()
        WHERE id = $2
      `, metaDescription, product.id);

      updatedCount++;
      console.log(`✓ Updated description for Product ${product.id}`);
    }

    await prisma.$disconnect();
    console.log('\n✓ Disconnected successfully');
    console.log(`\nMigration complete:`);
    console.log(`  - Updated: ${updatedCount} products`);
    console.log(`  - Skipped: ${skippedCount} products`);
    process.exit(0);
  } catch (error) {
    console.error('✗ Failed to migrate descriptions:', error.message);
    console.error('Error details:', error);
    await prisma.$disconnect();
    process.exit(1);
  }
}

migrateDescriptions();
