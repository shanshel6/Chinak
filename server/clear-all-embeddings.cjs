/**
 * Script to clear all textEmbedding and imageEmbedding from products table
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function clearEmbeddings() {
  console.log('🗑️  Clearing all textEmbedding and imageEmbedding from products...');
  
  try {
    // Clear textEmbedding for all products
    const textResult = await prisma.$executeRaw`
      UPDATE "Product" 
      SET "textEmbedding" = NULL
      WHERE "textEmbedding" IS NOT NULL
    `;
    console.log(`✅ Cleared textEmbedding for ${textResult} products`);
    
    // Clear imageEmbedding for all products
    const imageResult = await prisma.$executeRaw`
      UPDATE "Product" 
      SET "imageEmbedding" = NULL
      WHERE "imageEmbedding" IS NOT NULL
    `;
    console.log(`✅ Cleared imageEmbedding for ${imageResult} products`);
    
    // Reset pipeline progress if exists
    const pipelineResult = await prisma.setting.deleteMany({
      where: {
        key: 'lastProcessedProductId'
      }
    }).catch(() => {
      // Setting might not exist, ignore error
    });
    
    console.log('✅ All embeddings cleared successfully!');
    
  } catch (error) {
    console.error('❌ Error clearing embeddings:', error);
  } finally {
    await prisma.$disconnect();
  }
}

clearEmbeddings();
