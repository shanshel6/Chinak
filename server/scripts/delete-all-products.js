import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: join(__dirname, '..', '.env'), override: false });

const prisma = new PrismaClient();

async function deleteAllProducts() {
  try {
    console.log('Deleting all products...');
    
    // First delete related records
    await prisma.productImage.deleteMany({});
    console.log('Deleted all product images');
    
    await prisma.product.deleteMany({});
    console.log('Deleted all products');
    
    console.log('✅ Successfully deleted all products');
  } catch (error) {
    console.error('❌ Error deleting products:', error);
  } finally {
    await prisma.$disconnect();
  }
}

deleteAllProducts();
