import { PrismaClient } from '@prisma/client';
import { fileURLToPath } from 'url';
import path from 'path';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.join(__dirname, '..', '.env');
dotenv.config({ path: envPath, override: true });

const DATABASE_URL = process.env.GOOFISH_DATABASE_URL || process.env.DATABASE_URL;
const productId = process.argv[2] || '54';

console.log(`Checking product ID ${productId} in database...`);
console.log('Database URL:', DATABASE_URL.replace(/:[^:@]+@/, ':****@'));

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: DATABASE_URL
    }
  }
});

async function checkProduct() {
  try {
    console.log('Connecting to database...');
    await prisma.$connect();
    console.log('✓ Connected to database');

    const product = await prisma.product.findUnique({
      where: { id: parseInt(productId) }
    });

    if (product) {
      console.log('\n✓ Product found:');
      console.log(`ID: ${product.id}`);
      console.log(`Name: ${product.name}`);
      console.log(`Description: ${product.description || 'NULL'}`);
      console.log(`Specs: ${product.specs || 'NULL'}`);
      console.log(`Price: ${product.price}`);
      console.log(`AI Metadata: ${JSON.stringify(product.aiMetadata, null, 2)}`);
    } else {
      console.log(`\n✗ Product with ID ${productId} not found in database`);
    }

    await prisma.$disconnect();
    console.log('\n✓ Disconnected successfully');
    process.exit(0);
  } catch (error) {
    console.error('✗ Failed to check product:', error.message);
    console.error('Error details:', error);
    await prisma.$disconnect();
    process.exit(1);
  }
}

checkProduct();
