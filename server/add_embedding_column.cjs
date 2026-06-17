console.log('Adding embedding column to Product table...');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    console.log('1. Checking if embedding column already exists...');
    const existingColumn = await prisma.$queryRaw`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'Product' 
      AND column_name = 'embedding';
    `;
    
    if (existingColumn.length > 0) {
      console.log('Embedding column already exists. Checking dimension...');
      
      // Check current dimension
      const dimensionInfo = await prisma.$queryRaw`
        SELECT atttypmod as dimension 
        FROM pg_attribute 
        WHERE attrelid = '"Product"'::regclass 
        AND attname = 'embedding';
      `;
      
      console.log('Current embedding dimension:', dimensionInfo[0]?.dimension);
      
      // If dimension is not 1024, we need to alter it
      if (dimensionInfo[0]?.dimension !== 1024) {
        console.log('Updating embedding column dimension to 1024...');
        await prisma.$queryRaw`
          ALTER TABLE "Product" 
          ALTER COLUMN "embedding" TYPE vector(1024);
        `;
        console.log('Embedding column dimension updated to 1024.');
      } else {
        console.log('Embedding column already has dimension 1024.');
      }
    } else {
      console.log('2. Adding embedding column with dimension 1024...');
      await prisma.$queryRaw`
        ALTER TABLE "Product" 
        ADD COLUMN "embedding" vector(1024);
      `;
      console.log('Embedding column added successfully.');
    }
    
    console.log('\n3. Checking current imageEmbedding dimension...');
    const imageDimInfo = await prisma.$queryRaw`
      SELECT atttypmod as dimension 
      FROM pg_attribute 
      WHERE attrelid = '"Product"'::regclass 
      AND attname = 'imageEmbedding';
    `;
    console.log('Current imageEmbedding dimension:', imageDimInfo[0]?.dimension);
    
    // Update imageEmbedding to 1024 as well if needed
    if (imageDimInfo[0]?.dimension !== 1024) {
      console.log('4. Updating imageEmbedding column dimension to 1024...');
      await prisma.$queryRaw`
        ALTER TABLE "Product" 
        ALTER COLUMN "imageEmbedding" TYPE vector(1024);
      `;
      console.log('imageEmbedding column dimension updated to 1024.');
    }
    
    console.log('\n5. Checking ProductImage table imageEmbedding column...');
    const productImageDimInfo = await prisma.$queryRaw`
      SELECT atttypmod as dimension 
      FROM pg_attribute 
      WHERE attrelid = '"ProductImage"'::regclass 
      AND attname = 'imageEmbedding';
    `;
    console.log('ProductImage imageEmbedding dimension:', productImageDimInfo[0]?.dimension);
    
    // Update ProductImage imageEmbedding to 1024 as well if needed
    if (productImageDimInfo[0]?.dimension !== 1024) {
      console.log('6. Updating ProductImage imageEmbedding column dimension to 1024...');
      await prisma.$queryRaw`
        ALTER TABLE "ProductImage" 
        ALTER COLUMN "imageEmbedding" TYPE vector(1024);
      `;
      console.log('ProductImage imageEmbedding column dimension updated to 1024.');
    }
    
    console.log('\n✅ Database schema updated successfully!');
    console.log('All vector columns now have dimension 1024 for BGE-M3 compatibility.');
    
  } catch (e) {
    console.error('❌ Error:', e.message);
    console.error('Full error:', e);
  } finally {
    await prisma.$disconnect();
  }
}

main();