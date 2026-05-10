const axios = require('axios');

async function testSiliconFlow() {
  const apiKey = 'sk-crnipdimfvvgrbbxtvmbrshaqtjdmujbvkpuoifcdxkcalwh';
  const model = 'Qwen/Qwen3-14B';
  
  console.log(`Testing SiliconFlow API with model: ${model}`);
  console.log('API Key:', apiKey.slice(0, 8) + '...' + apiKey.slice(-4));
  
  const startedAt = Date.now();
  try {
    const response = await axios.post(
      'https://api.siliconflow.com/v1/chat/completions',
      {
        model: model,
        messages: [
          {
            role: 'system',
            content: 'You are a Chinese to Arabic translator. Translate the given Chinese text to Arabic. Return Arabic only.'
          },
          {
            role: 'user',
            content: '小米充电宝 20000毫安 45W 快充'
          }
        ],
        temperature: 0.1,
        max_tokens: 200
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        timeout: 90000
      }
    );
    
    const elapsed = Date.now() - startedAt;
    const content = response.data?.choices?.[0]?.message?.content;
    
    console.log('\n✅ SUCCESS! Response received in', elapsed, 'ms');
    console.log('Model used:', response.data?.model || model);
    console.log('Translation:', content);
    console.log('\nUsage:', JSON.stringify(response.data?.usage, null, 2));
    
  } catch (error) {
    const elapsed = Date.now() - startedAt;
    console.log('\n❌ FAILED after', elapsed, 'ms');
    
    if (error.response) {
      console.log('HTTP Status:', error.response.status);
      console.log('Error data:', JSON.stringify(error.response.data, null, 2));
    } else if (error.code === 'ECONNABORTED') {
      console.log('Error: Request timed out after 90s');
    } else {
      console.log('Error:', error.message);
    }
  }
}

testSiliconFlow();
