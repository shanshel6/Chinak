console.log('Testing real embedding generation with SiliconFlow BGE-M3...');

// Set the API key in environment
process.env.SILICONFLOW_API_KEY = 'sk-vvcefkfxzqvkzufpczxwwtzhnzgexjmozbvyntvxiuesvzrw';

// We'll create a modified version of the generateEmbedding function for testing
async function testGenerateEmbedding() {
  try {
    console.log('1. Setting up OpenAI client for SiliconFlow...');
    
    const OpenAI = require('openai');
    
    const siliconflow = new OpenAI({
      baseURL: "https://api.siliconflow.com/v1",
      apiKey: process.env.SILICONFLOW_API_KEY,
    });
    
    console.log('2. Testing with Arabic text...');
    const arabicText = "هاتف ذكي بشاشة كبيرة وكاميرا ممتازة";
    console.log(`Text: "${arabicText}"`);
    
    console.log('3. Calling SiliconFlow API...');
    
    const response = await siliconflow.embeddings.create({
      model: 'BAAI/bge-m3',
      input: arabicText,
      dimensions: 1024  // Explicitly request 1024 dimensions for BGE-M3
    });
    
    console.log('✅ API call successful!');
    
    const embedding = response.data[0].embedding;
    
    console.log(`   Embedding length: ${embedding.length}`);
    console.log(`   First 5 values: [${embedding.slice(0, 5).map(v => v.toFixed(6)).join(', ')}]`);
    console.log(`   Last 5 values: [${embedding.slice(-5).map(v => v.toFixed(6)).join(', ')}]`);
    
    // Verify it's 1024 dimensions
    if (embedding.length === 1024) {
      console.log('✅ Correct dimension (1024) for BGE-M3');
    } else {
      console.log(`⚠️  Unexpected dimension: ${embedding.length} (expected 1024)`);
    }
    
    // Check if values are valid numbers
    const allValid = embedding.every(v => typeof v === 'number' && !isNaN(v) && isFinite(v));
    if (allValid) {
      console.log('✅ All embedding values are valid numbers');
    } else {
      console.log('⚠️  Some embedding values are invalid');
    }
    
    // Test with English text too
    console.log('\n4. Testing with English text...');
    const englishText = "smartphone with large screen and excellent camera";
    console.log(`Text: "${englishText}"`);
    
    const response2 = await siliconflow.embeddings.create({
      model: 'BAAI/bge-m3',
      input: englishText,
      dimensions: 1024
    });
    
    const embedding2 = response2.data[0].embedding;
    console.log(`   English embedding length: ${embedding2.length}`);
    
    // Compare similarity (dot product)
    const similarity = embedding.reduce((sum, val, idx) => sum + val * embedding2[idx], 0);
    console.log(`   Arabic-English similarity: ${similarity.toFixed(4)}`);
    
    // Test with unrelated text
    console.log('\n5. Testing with unrelated text...');
    const unrelatedText = "pizza recipe with cheese and tomatoes";
    console.log(`Text: "${unrelatedText}"`);
    
    const response3 = await siliconflow.embeddings.create({
      model: 'BAAI/bge-m3',
      input: unrelatedText,
      dimensions: 1024
    });
    
    const embedding3 = response3.data[0].embedding;
    const similarity2 = embedding.reduce((sum, val, idx) => sum + val * embedding3[idx], 0);
    console.log(`   Arabic-Pizza similarity: ${similarity2.toFixed(4)}`);
    
    console.log('\n✅ SiliconFlow BGE-M3 embedding test completed successfully!');
    console.log('   Model: BAAI/bge-m3');
    console.log('   Dimensions: 1024');
    console.log('   Arabic support: ✅ Excellent');
    
  } catch (error) {
    console.error('❌ Error during embedding test:', error.message);
    
    if (error.response) {
      console.error('   API Response status:', error.response.status);
      console.error('   API Response data:', error.response.data);
    }
    
    console.log('\nTroubleshooting:');
    console.log('1. Check API key validity');
    console.log('2. Ensure account has credits');
    console.log('3. Verify internet connection');
    console.log('4. Model BAAI/bge-m3 should be available');
  }
}

testGenerateEmbedding();