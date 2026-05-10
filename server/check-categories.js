import { PrismaClient } from '@prisma/client';
import { fileURLToPath } from 'url';
import path from 'path';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.join(__dirname, '..', '.env');
dotenv.config({ path: envPath, override: true });

const DATABASE_URL = process.env.GOOFISH_DATABASE_URL || process.env.DATABASE_URL;

console.log('Checking database state...');
console.log('Database URL:', DATABASE_URL.replace(/:[^:@]+@/, ':****@'));

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: DATABASE_URL
    }
  }
});

async function checkDatabase() {
  try {
    await prisma.$connect();
    console.log('✓ Connected to database\n');

    // Check categories
    console.log('=== CATEGORIES ===');
    const categoryCount = await prisma.category.count();
    console.log(`Total categories: ${categoryCount}`);
    
    if (categoryCount > 0) {
      const sampleCategories = await prisma.category.findMany({
        take: 5,
        orderBy: { id: 'asc' }
      });
      console.log('\nSample categories:');
      sampleCategories.forEach(cat => {
        console.log(`  - ID: ${cat.id}, Slug: ${cat.slug}, Name (AR): ${cat.nameAr}, Name (EN): ${cat.nameEn}`);
      });
    }

    // Check products
    console.log('\n=== PRODUCTS ===');
    const totalProducts = await prisma.product.count();
    const productsWithCategoryId = await prisma.product.count({
      where: { categoryId: { not: null } }
    });
    const productsWithoutCategoryId = await prisma.product.count({
      where: { categoryId: null }
    });

    console.log(`Total products: ${totalProducts}`);
    console.log(`Products with categoryId: ${productsWithCategoryId}`);
    console.log(`Products without categoryId: ${productsWithoutCategoryId}`);

    // Check products with categorySlug in aiMetadata
    const productsWithCategorySlug = await prisma.product.count({
      where: {
        aiMetadata: {
          path: ['categorySlug'],
          not: null
        }
      }
    });
    console.log(`Products with categorySlug in aiMetadata: ${productsWithCategorySlug}`);

    // Sample products
    if (totalProducts > 0) {
      console.log('\nSample products:');
      const sampleProducts = await prisma.product.findMany({
        take: 5,
        orderBy: { id: 'asc' },
        select: {
          id: true,
          name: true,
          categoryId: true,
          aiMetadata: true
        }
      });
      sampleProducts.forEach(prod => {
        console.log(`  - ID: ${prod.id}, Name: ${prod.name.substring(0, 50)}..., CategoryID: ${prod.categoryId}, CategorySlug in aiMetadata: ${prod.aiMetadata?.categorySlug || 'null'}`);
      });
    }

    await prisma.$disconnect();
    console.log('\n✓ Check completed');
    process.exit(0);
  } catch (error) {
    console.error('✗ Check failed:', error.message);
    console.error('Error details:', error);
    await prisma.$disconnect();
    process.exit(1);
  }
}

checkDatabase();
