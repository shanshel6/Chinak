console.log('Testing BGE-M3 embedding generation...');

// Mock the environment variables if needed
process.env.SILICONFLOW_API_KEY = process.env.SILICONFLOW_API_KEY || 'your-api-key-here';

const { generateEmbedding } = require('./services/aiService.js');

async function testEmbedding() {
  try {
    console.log('1. Testing embedding generation with sample Arabic text...');
    
    const arabicText = "هاتف ذكي بشاشة كبيرة وكاميرا ممتازة";
    console.log(`Text: "${arabicText}"`);
    
    const embedding = await generateEmbedding(arabicText);
    
    if (!embedding) {
      console.error('❌ Failed to generate embedding');
      return;
    }
    
    console.log(`✅ Embedding generated successfully!`);
    console.log(`   Dimensions: ${embedding.length}`);
    console.log(`   First 5 values: [${embedding.slice(0, 5).join(', ')}]`);
    console.log(`   Last 5 values: [${embedding.slice(-5).join(', ')}]`);
    
    // Check dimension
    if (embedding.length === 1024) {
      console.log('✅ Correct dimension (1024) for BGE-M3');
    } else {
      console.error(`❌ Wrong dimension: ${embedding.length} (expected 1024)`);
    }
    
    // Check if all values are numbers
    const allNumbers = embedding.every(v => typeof v === 'number' && !isNaN(v));
    if (allNumbers) {
      console.log('✅ All embedding values are valid numbers');
    } else {
      console.error('❌ Some embedding values are not valid numbers');
    }
    
  } catch (error) {
    console.error('❌ Error during test:', error.message);
    console.error(error);
  }
}

testEmbedding();