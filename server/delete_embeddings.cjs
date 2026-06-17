console.log('Deleting all existing embeddings from database...');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    console.log('1. Checking current embedding counts...');
    
    // Check if embedding column exists
    const embeddingColumnExists = await prisma.$queryRaw`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'Product' 
      AND column_name = 'embedding';
    `;
    
    if (embeddingColumnExists.length > 0) {
      // Count products with embeddings
      const productEmbeddingCount = await prisma.$queryRaw`
        SELECT COUNT(*) as count 
        FROM "Product" 
        WHERE "embedding" IS NOT NULL;
      `;
      console.log(`Products with embeddings: ${productEmbeddingCount[0].count}`);
    } else {
      console.log('embedding column does not exist yet (will be created by migration)');
    }
    
    // Count products with imageEmbeddings
    const productImageEmbeddingCount = await prisma.$queryRaw`
      SELECT COUNT(*) as count 
      FROM "Product" 
      WHERE "imageEmbedding" IS NOT NULL;
    `;
    console.log(`Products with imageEmbeddings: ${productImageEmbeddingCount[0].count}`);
    
    // Count ProductImage records with embeddings
    const productImageCount = await prisma.$queryRaw`
      SELECT COUNT(*) as count 
      FROM "ProductImage" 
      WHERE "imageEmbedding" IS NOT NULL;
    `;
    console.log(`ProductImage records with embeddings: ${productImageCount[0].count}`);
    
    console.log('\n2. Deleting all embeddings...');
    
    // Delete imageEmbeddings from Product table
    console.log('Deleting imageEmbeddings from Product table...');
    await prisma.$queryRaw`
      UPDATE "Product" 
      SET "imageEmbedding" = NULL;
    `;
    console.log('Product imageEmbeddings cleared.');
    
    // Delete embeddings from ProductImage table
    console.log('Deleting embeddings from ProductImage table...');
    await prisma.$queryRaw`
      UPDATE "ProductImage" 
      SET "imageEmbedding" = NULL;
    `;
    console.log('ProductImage embeddings cleared.');
    
    // If embedding column exists, clear it too
    if (embeddingColumnExists.length > 0) {
      console.log('Deleting embeddings from Product table...');
      await prisma.$queryRaw`
        UPDATE "Product" 
        SET "embedding" = NULL;
      `;
      console.log('Product embeddings cleared.');
    }
    
    console.log('\n3. Verifying deletions...');
    
    const verifyProductImageEmbedding = await prisma.$queryRaw`
      SELECT COUNT(*) as count 
      FROM "Product" 
      WHERE "imageEmbedding" IS NOT NULL;
    `;
    console.log(`Products with imageEmbeddings after deletion: ${verifyProductImageEmbedding[0].count}`);
    
    const verifyProductImage = await prisma.$queryRaw`
      SELECT COUNT(*) as count 
      FROM "ProductImage" 
      WHERE "imageEmbedding" IS NOT NULL;
    `;
    console.log(`ProductImage records with embeddings after deletion: ${verifyProductImage[0].count}`);
    
    console.log('\n✅ All embeddings deleted successfully!');
    console.log('The database is now ready for re-embedding with BGE-M3.');
    
  } catch (e) {
    console.error('❌ Error:', e.message);
    console.error('Full error:', e);
  } finally {
    await prisma.$disconnect();
  }
}

main();