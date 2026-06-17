console.log('Checking vector dimension...');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    // Check if pgvector extension is installed
    const extensions = await prisma.$queryRaw`
      SELECT * FROM pg_extension WHERE extname = 'vector';
    `;
    console.log('Vector extension:', extensions.length > 0 ? 'Installed' : 'Not installed');
    
    // Check the dimension of imageEmbedding column
    const dimension = await prisma.$queryRaw`
      SELECT atttypmod as dimension 
      FROM pg_attribute 
      WHERE attrelid = '"Product"'::regclass 
      AND attname = 'imageEmbedding';
    `;
    console.log('imageEmbedding dimension:', dimension);
    
    // Check if embedding column exists
    const embeddingExists = await prisma.$queryRaw`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'Product' 
      AND column_name = 'embedding';
    `;
    console.log('embedding column exists:', embeddingExists.length > 0);
    
    // Check a sample product to see if it has imageEmbedding
    const sample = await prisma.$queryRaw`
      SELECT id, name, 
             array_length("imageEmbedding"::float8[], 1) as embedding_length
      FROM "Product" 
      WHERE "imageEmbedding" IS NOT NULL 
      LIMIT 5;
    `;
    console.log('Sample products with imageEmbedding:', sample);
    
  } catch (e) {
    console.error('Error:', e);
  } finally {
    await prisma.$disconnect();
  }
}

main();