// Detailed SiliconFlow API test
import axios from 'axios';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.join(__dirname, '..', '.env');
dotenv.config({ path: envPath });

console.log('=== Detailed SiliconFlow API Test ===\n');

const SILICONFLOW_API_KEY = String(process.env.SILICONFLOW_API_KEY || '').trim();
const GOOFISH_AI_MODEL = String(process.env.GOOFISH_AI_MODEL || 'deepseek-ai/DeepSeek-V4-Flash').trim() || 'deepseek-ai/DeepSeek-V4-Flash';

console.log('Configuration:');
console.log(`- API Key: ${SILICONFLOW_API_KEY ? 'Set (' + SILICONFLOW_API_KEY.length + ' chars)' : 'NOT SET!'}`);
console.log(`- Model: ${GOOFISH_AI_MODEL}`);
console.log('');

if (!SILICONFLOW_API_KEY) {
  console.error('❌ ERROR: API key not set');
  process.exit(1);
}

// Test 1: List available models
console.log('Test 1: Listing available models...');
try {
  const response = await axios.get('https://api.siliconflow.com/v1/models', {
    headers: {
      'Authorization': `Bearer ${SILICONFLOW_API_KEY}`
    },
    timeout: 30000,
    proxy: false
  });

  console.log(`✅ Models API call successful (Status: ${response.status})`);
  
  if (response.data && Array.isArray(response.data.data)) {
    console.log(`   Found ${response.data.data.length} models:`);
    
    // Filter for Qwen models
    const qwenModels = response.data.data.filter(model => 
      model.id && model.id.includes('Qwen')
    );
    
    console.log(`   Qwen models (${qwenModels.length}):`);
    for (const model of qwenModels.slice(0, 10)) { // Show first 10
      console.log(`     - ${model.id}`);
    }
    
    if (qwenModels.length > 10) {
      console.log(`     ... and ${qwenModels.length - 10} more`);
    }
    
    // Check if our configured model exists
    const modelExists = response.data.data.some(model => model.id === GOOFISH_AI_MODEL);
    console.log(`\n   Configured model "${GOOFISH_AI_MODEL}": ${modelExists ? '✅ Found' : '❌ NOT FOUND'}`);
    
    if (!modelExists) {
      console.log('   Similar models:');
      const similar = response.data.data.filter(model => 
        model.id.includes('Qwen') && model.id.includes('9B')
      );
      for (const model of similar.slice(0, 5)) {
        console.log(`     - ${model.id}`);
      }
    }
  } else {
    console.log('   Response data structure unexpected:');
    console.log(JSON.stringify(response.data, null, 2).slice(0, 500));
  }
} catch (error) {
  console.error('❌ Models API call failed:');
  console.error(`   Error: ${error.message}`);
  
  if (error.response) {
    console.error(`   Status: ${error.response.status}`);
    if (error.response.data) {
      console.error('   Data:', JSON.stringify(error.response.data).slice(0, 300));
    }
  }
}

console.log('\n---\n');

// Test 2: Test chat completion with detailed logging
console.log('Test 2: Detailed chat completion test...');
console.log('Request details:');
console.log(`  Model: ${GOOFISH_AI_MODEL}`);
console.log('  Messages: [{ role: "user", content: "Translate: Hello world to Arabic" }]');
console.log('  Temperature: 0.3');
console.log('  Max tokens: 50');
console.log('');

try {
  const startTime = Date.now();
  const response = await axios.post('https://api.siliconflow.com/v1/chat/completions', {
    model: GOOFISH_AI_MODEL,
    messages: [{ role: 'user', content: 'Translate: Hello world to Arabic' }],
    temperature: 0.3,
    max_tokens: 50,
    stream: false
  }, {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SILICONFLOW_API_KEY}`
    },
    timeout: 30000,
    proxy: false
  });

  const elapsed = Date.now() - startTime;
  console.log(`✅ Chat completion successful (${elapsed}ms)`);
  console.log(`   Status: ${response.status}`);
  
  if (response.data) {
    console.log('   Response structure:');
    console.log(`     - Object keys: ${Object.keys(response.data).join(', ')}`);
    
    if (response.data.choices && Array.isArray(response.data.choices)) {
      console.log(`     - Choices count: ${response.data.choices.length}`);
      
      for (let i = 0; i < response.data.choices.length; i++) {
        const choice = response.data.choices[i];
        console.log(`     - Choice ${i}:`);
        console.log(`       - Finish reason: ${choice.finish_reason}`);
        
        if (choice.message) {
          console.log(`       - Role: ${choice.message.role}`);
          const content = choice.message.content || '';
          console.log(`       - Content: "${content}"`);
          console.log(`       - Content length: ${content.length} chars`);
          
          if (content.trim() === '') {
            console.log('       ⚠️  WARNING: Content is empty!');
          }
        }
      }
    }
    
    if (response.data.usage) {
      console.log('   Usage:');
      console.log(`     - Prompt tokens: ${response.data.usage.prompt_tokens}`);
      console.log(`     - Completion tokens: ${response.data.usage.completion_tokens}`);
      console.log(`     - Total tokens: ${response.data.usage.total_tokens}`);
    }
  }
} catch (error) {
  console.error('❌ Chat completion failed:');
  console.error(`   Error: ${error.message}`);
  
  if (error.response) {
    console.error(`   Status: ${error.response.status}`);
    if (error.response.data) {
      console.error('   Data:', JSON.stringify(error.response.data).slice(0, 400));
    }
  }
  
  if (error.code === 'ECONNREFUSED') {
    console.error('\n   🔍 Connection refused. Possible issues:');
    console.error('   1. Proxy blocking connection');
    console.error('   2. API service down');
    console.error('   3. Network issues');
  }
}

console.log('\n---\n');

// Test 3: Try alternative models
console.log('Test 3: Testing alternative models...');
const alternativeModels = [
  'deepseek-ai/DeepSeek-V4-Flash',
  'Qwen/Qwen3-14B',
  'deepseek-ai/DeepSeek-V3.2',
  'Qwen/Qwen3-8B',
  'Qwen/Qwen2.5-7B-Instruct'
];

console.log('Will test these models:');
for (const model of alternativeModels) {
  console.log(`  - ${model}`);
}

console.log('\nStarting tests...');

for (const model of alternativeModels) {
  console.log(`\n  Testing model: ${model}`);
  
  try {
    const response = await axios.post('https://api.siliconflow.com/v1/chat/completions', {
      model: model,
      messages: [{ role: 'user', content: 'Say "Test" in Arabic' }],
      temperature: 0.3,
      max_tokens: 10,
      stream: false
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SILICONFLOW_API_KEY}`
      },
      timeout: 15000,
      proxy: false
    });

    const content = response.data.choices[0].message.content || '';
    console.log(`    ✅ Success: "${content.trim()}"`);
  } catch (error) {
    console.log(`    ❌ Failed: ${error.message}`);
    
    if (error.response?.status === 404) {
      console.log(`      - Model not found`);
    }
  }
}

console.log('\n=== Summary ===');
console.log('The API key appears to be valid.');
console.log('If the configured model is not working, try:');
console.log('1. Check the exact model name on SiliconFlow');
console.log('2. Use deepseek-ai/DeepSeek-V4-Flash (default model)');
console.log('3. Use deepseek-ai/DeepSeek-V3.2 (alternative)');
console.log('\nTo fix the circuit breaker issue:');
console.log('1. Restart the scraper to reset circuit breaker');
console.log('2. Ensure API calls are not using proxy');
console.log('3. Use a working model name');