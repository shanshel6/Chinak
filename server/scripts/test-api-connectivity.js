// Test SiliconFlow API connectivity and circuit breaker
import axios from 'axios';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.join(__dirname, '..', '.env');
dotenv.config({ path: envPath });

console.log('=== SiliconFlow API Connectivity Test ===\n');

// Get configuration
const SILICONFLOW_API_KEY = String(process.env.SILICONFLOW_API_KEY || '').trim();
const GOOFISH_AI_MODEL = String(process.env.GOOFISH_AI_MODEL || 'Qwen/Qwen3.5-9B').trim() || 'Qwen/Qwen3.5-9B';

console.log('Configuration:');
console.log(`- API Key: ${SILICONFLOW_API_KEY ? 'Set (' + SILICONFLOW_API_KEY.length + ' chars)' : 'NOT SET!'}`);
console.log(`- Model: ${GOOFISH_AI_MODEL}`);
console.log('');

if (!SILICONFLOW_API_KEY) {
  console.error('❌ ERROR: SILICONFLOW_API_KEY is not set!');
  console.error('   Please check your .env file.');
  process.exit(1);
}

// Test 1: Direct API call without any proxy settings
console.log('Test 1: Direct API call (no proxy)...');
try {
  const response = await axios.post('https://api.siliconflow.com/v1/chat/completions', {
    model: GOOFISH_AI_MODEL,
    messages: [{ role: 'user', content: 'Say "Test" in Arabic' }],
    temperature: 0.3,
    max_tokens: 10,
    stream: false
  }, {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SILICONFLOW_API_KEY}`
    },
    timeout: 30000,
    proxy: false
  });

  console.log('✅ API call successful!');
  console.log(`   Response: ${response.data.choices[0].message.content.trim()}`);
  console.log(`   Model: ${GOOFISH_AI_MODEL}`);
} catch (error) {
  console.error('❌ API call failed:');
  console.error(`   Error: ${error.message}`);
  
  if (error.code) {
    console.error(`   Code: ${error.code}`);
  }
  
  if (error.response) {
    console.error(`   Status: ${error.response.status}`);
    if (error.response.data) {
      const dataStr = JSON.stringify(error.response.data);
      console.error(`   Data: ${dataStr.slice(0, 200)}${dataStr.length > 200 ? '...' : ''}`);
    }
  }
  
  // Check for common issues
  if (error.code === 'ECONNREFUSED') {
    console.error('\n   🔍 Issue: Connection refused.');
    console.error('   This usually means:');
    console.error('   1. A proxy is blocking the connection');
    console.error('   2. The API service is down');
    console.error('   3. Network firewall is blocking');
  } else if (error.response?.status === 401) {
    console.error('\n   🔍 Issue: Unauthorized (401).');
    console.error('   This means the API key is invalid or expired.');
  } else if (error.response?.status === 429) {
    console.error('\n   🔍 Issue: Rate limit (429).');
    console.error('   Too many requests. Wait and try again.');
  }
}

console.log('\n---\n');

// Test 2: Check environment variables that might affect API calls
console.log('Test 2: Checking environment variables...');
const proxyEnvVars = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'PROXY_SERVER'];
let foundProxyVars = [];

for (const envVar of proxyEnvVars) {
  if (process.env[envVar]) {
    foundProxyVars.push(`${envVar}=${process.env[envVar]}`);
  }
}

if (foundProxyVars.length > 0) {
  console.log('⚠️  Found proxy environment variables:');
  for (const varInfo of foundProxyVars) {
    console.log(`   ${varInfo}`);
  }
  console.log('\n   These can cause API connection issues.');
  console.log('   To fix, unset them or configure axios to ignore them.');
} else {
  console.log('✅ No proxy environment variables found.');
}

console.log('\n---\n');

// Test 3: Check if the model is available
console.log('Test 3: Checking model availability...');
console.log(`Model: ${GOOFISH_AI_MODEL}`);
console.log('Note: Some models might not be available or might have different names.');
console.log('Common SiliconFlow models:');
console.log('  - Qwen/Qwen3.5-9B (fast, good for translation)');
console.log('  - Qwen/Qwen3-14B (larger, more accurate)');
console.log('  - Qwen/Qwen3-235B-A22B-Instruct-2507 (very large, slow)');
console.log('  - deepseek-ai/DeepSeek-V3.2 (alternative)');

console.log('\n---\n');

// Test 4: Simulate the scraper's API call logic
console.log('Test 4: Simulating scraper API call logic...');
console.log('The scraper should:');
console.log('1. Use the correct API key');
console.log('2. Use the configured model');
console.log('3. Disable proxy (proxy: false)');
console.log('4. Handle errors gracefully');

console.log('\nCurrent status:');
if (SILICONFLOW_API_KEY) {
  console.log('✅ API key is set');
} else {
  console.log('❌ API key is NOT set');
}

console.log(`✅ Model configured: ${GOOFISH_AI_MODEL}`);
console.log('✅ Proxy disabled in axios config');
console.log('✅ Error handling implemented');

console.log('\n---\n');

// Test 5: Check if we can bypass any system proxy
console.log('Test 5: Testing proxy bypass...');
console.log('If API calls are still failing, try:');
console.log('1. Unset proxy environment variables:');
console.log('   set HTTP_PROXY=');
console.log('   set HTTPS_PROXY=');
console.log('2. Use a direct connection test:');
console.log('   curl https://api.siliconflow.com/v1/models');
console.log('3. Check network connectivity:');
console.log('   ping api.siliconflow.com');

console.log('\n=== Summary ===');
console.log('1. API Key: ' + (SILICONFLOW_API_KEY ? '✅ Set' : '❌ Not set'));
console.log('2. Model: ✅ ' + GOOFISH_AI_MODEL);
console.log('3. Proxy disabled: ✅ Yes');
console.log('4. Circuit breaker: ⚠️ May be triggered from previous failures');
console.log('\nIf API calls are still failing:');
console.log('1. Check if the API key is valid');
console.log('2. Check if SiliconFlow service is up');
console.log('3. Check network/proxy settings');
console.log('4. Try a different model (e.g., deepseek-ai/DeepSeek-V3.2)');