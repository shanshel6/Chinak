console.log('Testing BGE-M3 embedding generation (simple test)...');

// Use dynamic import for ES module
async function testEmbedding() {
  try {
    console.log('1. Importing aiService module...');
    
    // Dynamic import for ES modules
    const aiService = await import('./services/aiService.js');
    
    console.log('2. Testing embedding generation with sample Arabic text...');
    
    const arabicText = "هاتف ذكي بشاشة كبيرة وكاميرا ممتازة";
    console.log(`Text: "${arabicText}"`);
    
    // Since generateEmbedding is not exported, let's check what's available
    console.log('Available exports:', Object.keys(aiService));
    
    // Try to use processProductEmbedding which should use generateEmbedding internally
    console.log('3. Testing via processProductEmbedding...');
    
    // We need a test product ID - let's check if we have any products
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();
    
    const testProduct = await prisma.product.findFirst({
      select: { id: true }
    });
    
    if (testProduct) {
      console.log(`Found test product ID: ${testProduct.id}`);
      // We can't call processProductEmbedding without proper setup
      console.log('Skipping actual embedding generation due to missing API key setup');
    } else {
      console.log('No products found in database');
    }
    
    await prisma.$disconnect();
    
  } catch (error) {
    console.error('❌ Error during test:', error.message);
    console.error(error);
  }
}

testEmbedding();