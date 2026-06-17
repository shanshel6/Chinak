
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Clearing all product embeddings (text and image)...');
  
  // Use raw SQL because embedding and imageEmbedding are Unsupported types
  const result = await prisma.$executeRawUnsafe(`
    UPDATE "Product" 
    SET "embedding" = NULL, 
        "imageEmbedding" = NULL
  `);
  
  console.log(`Cleared embeddings!`);
  console.log('All done!');
}

main()
  .catch((e) => {
    console.error('Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
