const axios = require('axios');

const API_KEY = 'sk-mwpajtvsmzpttyzbetmkkgaeydvrgymxfmwavasaacjgztgu';
const MODEL = 'Qwen/Qwen3-8B';

async function testModel() {
  try {
    console.log(`Testing SiliconFlow API with model: ${MODEL}`);
    console.log(`API Key: ${API_KEY.substring(0, 20)}...`);
    
    const response = await axios.post(
      'https://api.siliconflow.cn/v1/chat/completions',
      {
        model: MODEL,
        messages: [
          {
            role: 'user',
            content: 'Translate this to Arabic: Hello world'
          }
        ],
        max_tokens: 50
      },
      {
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );
    
    console.log('✅ API call successful!');
    console.log('Status:', response.status);
    console.log('Response:', JSON.stringify(response.data, null, 2));
    
    if (response.data.choices && response.data.choices[0]) {
      console.log('Translation:', response.data.choices[0].message.content);
    }
  } catch (error) {
    console.error('❌ API call failed!');
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', error.response.data);
    } else {
      console.error('Error:', error.message);
    }
  }
}

testModel();
