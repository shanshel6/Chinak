import { PrismaClient } from '@prisma/client';
import { fileURLToPath } from 'url';
import path from 'path';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.join(__dirname, '..', '.env');
dotenv.config({ path: envPath, override: true });

const DATABASE_URL = process.env.GOOFISH_DATABASE_URL || process.env.DATABASE_URL;

console.log('Deleting all products from database...');
console.log('Database URL:', DATABASE_URL.replace(/:[^:@]+@/, ':****@'));

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: DATABASE_URL
    }
  }
});

async function deleteAllProducts() {
  try {
    console.log('Connecting to database...');
    await prisma.$connect();
    console.log('✓ Connected to database');

    // Delete all product images first (due to foreign key constraints)
    console.log('Deleting all product images...');
    const deletedImages = await prisma.productImage.deleteMany({});
    console.log(`✓ Deleted ${deletedImages.count} product images`);

    // Delete all products
    console.log('Deleting all products...');
    const deletedProducts = await prisma.product.deleteMany({});
    console.log(`✓ Deleted ${deletedProducts.count} products`);

    await prisma.$disconnect();
    console.log('✓ Disconnected successfully');
    console.log('\nAll products deleted successfully!');
    process.exit(0);
  } catch (error) {
    console.error('✗ Failed to delete products:', error.message);
    console.error('Error details:', error);
    await prisma.$disconnect();
    process.exit(1);
  }
}

deleteAllProducts();
