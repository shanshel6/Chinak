
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Dropping old embedding columns from the database...');
  
  // Drop embedding column from Product
  console.log('1. Dropping "embedding" column from "Product" table...');
  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Product" DROP COLUMN IF EXISTS "embedding"`);
    console.log('✅ Done!');
  } catch (e) {
    console.error('⚠️ Failed to drop "embedding" column:', e.message);
  }
  
  // Drop imageEmbedding column from ProductImage
  console.log('\n2. Dropping "imageEmbedding" column from "ProductImage" table...');
  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE "ProductImage" DROP COLUMN IF EXISTS "imageEmbedding"`);
    console.log('✅ Done!');
  } catch (e) {
    console.error('⚠️ Failed to drop "imageEmbedding" column:', e.message);
  }

  console.log('\n✅ All old embedding columns dropped!');
}

main()
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
