import { PrismaClient } from '@prisma/client';
import { fileURLToPath } from 'url';
import path from 'path';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.join(__dirname, '..', '.env');
dotenv.config({ path: envPath, override: true });

const DATABASE_URL = process.env.GOOFISH_DATABASE_URL || process.env.DATABASE_URL;
const categoryId = process.argv[2] || '2430';

console.log(`Checking category ID ${categoryId} in database...`);
console.log('Database URL:', DATABASE_URL.replace(/:[^:@]+@/, ':****@'));

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: DATABASE_URL
    }
  }
});

async function checkCategory() {
  try {
    console.log('Connecting to database...');
    await prisma.$connect();
    console.log('✓ Connected to database');

    const category = await prisma.category.findUnique({
      where: { id: parseInt(categoryId) }
    });

    if (category) {
      console.log('\n✓ Category found:');
      console.log(JSON.stringify(category, null, 2));
    } else {
      console.log(`\n✗ Category with ID ${categoryId} not found in database`);
      
      // Check if there are any categories at all
      const allCategories = await prisma.category.findMany();
      console.log(`\nTotal categories in database: ${allCategories.length}`);
      
      if (allCategories.length > 0) {
        console.log('\nRecent categories:');
        allCategories.slice(-5).forEach(cat => {
          console.log(`  ID: ${cat.id}, Slug: ${cat.slug}, Name AR: ${cat.nameAr}`);
        });
      }
    }

    await prisma.$disconnect();
    console.log('\n✓ Disconnected successfully');
    process.exit(0);
  } catch (error) {
    console.error('✗ Failed to check category:', error.message);
    console.error('Error details:', error);
    await prisma.$disconnect();
    process.exit(1);
  }
}

checkCategory();
