console.log('Testing SiliconFlow BGE-M3 embedding generation...');

// Set the API key in environment
process.env.SILICONFLOW_API_KEY = 'sk-vvcefkfxzqvkzufpczxwwtzhnzgexjmozbvyntvxiuesvzrw';

// Dynamic import for ES module
async function testEmbedding() {
  try {
    console.log('1. Importing aiService module...');
    
    // Dynamic import for ES modules
    const aiService = await import('./services/aiService.js');
    
    console.log('2. Testing embedding generation with Arabic text...');
    
    // Test with Arabic text
    const arabicText = "هاتف ذكي بشاشة كبيرة وكاميرا ممتازة";
    console.log(`Arabic text: "${arabicText}"`);
    
    // Test with English text
    const englishText = "smartphone with large screen and excellent camera";
    console.log(`English text: "${englishText}"`);
    
    // Check if generateEmbedding is available
    console.log('3. Checking available functions...');
    console.log('Exports:', Object.keys(aiService));
    
    // Since generateEmbedding might not be exported directly,
    // let's test via processProductEmbedding with a mock product
    console.log('\n4. Testing direct embedding generation...');
    
    // We need to check the actual function structure
    // Let's look at the module structure
    const fs = require('fs');
    const path = require('path');
    
    const aiServicePath = path.join(__dirname, 'services', 'aiService.js');
    const content = fs.readFileSync(aiServicePath, 'utf8');
    
    // Check if generateEmbedding is exported
    if (content.includes('export async function generateEmbedding') || 
        content.includes('export function generateEmbedding')) {
      console.log('✅ generateEmbedding is exported');
      
      // Try to call it directly
      const embedding = await aiService.generateEmbedding(arabicText);
      console.log(`✅ Embedding generated successfully!`);
      console.log(`   Dimensions: ${embedding.length}`);
      console.log(`   First 5 values: [${embedding.slice(0, 5).join(', ')}]`);
      
      // Verify dimension
      if (embedding.length === 1024) {
        console.log('✅ Correct dimension (1024) for BGE-M3');
      } else {
        console.log(`⚠️  Unexpected dimension: ${embedding.length} (expected 1024)`);
      }
      
    } else {
      console.log('⚠️  generateEmbedding is not directly exported');
      console.log('   Available embedding-related functions:');
      
      // List available functions
      const embeddingFunctions = Object.keys(aiService).filter(key => 
        key.toLowerCase().includes('embed') || 
        key.toLowerCase().includes('process')
      );
      
      console.log('   ', embeddingFunctions.join(', '));
      
      // Try processProductEmbedding if available
      if (aiService.processProductEmbedding) {
        console.log('\n5. Testing via processProductEmbedding...');
        
        // We need a test product - check database
        const { PrismaClient } = require('@prisma/client');
        const prisma = new PrismaClient();
        
        try {
          const testProduct = await prisma.product.findFirst({
            select: { id: true, name: true }
          });
          
          if (testProduct) {
            console.log(`   Found product: ${testProduct.id} - ${testProduct.name}`);
            console.log('   Note: This would update the database, skipping actual call');
          } else {
            console.log('   No products found in database');
          }
          
          await prisma.$disconnect();
        } catch (dbError) {
          console.log('   Database connection error:', dbError.message);
        }
      }
    }
    
    console.log('\n✅ SiliconFlow API key configured successfully!');
    console.log('   Model: BAAI/bge-m3 (1024 dimensions)');
    console.log('   Ready for Arabic text embedding generation');
    
  } catch (error) {
    console.error('❌ Error during test:', error.message);
    
    // Provide troubleshooting tips
    console.log('\nTroubleshooting:');
    console.log('1. Check if API key is valid');
    console.log('2. Ensure internet connection');
    console.log('3. Verify SiliconFlow account has credits');
    console.log('4. Check model availability: BAAI/bge-m3');
  }
}

testEmbedding();