import axios from 'axios';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../.env') });

async function test() {
  const apiKey = process.env.SILICONFLOW_API_KEY;
  const model = 'Qwen/Qwen3.5-9B';
  
  console.log(`Testing model: ${model}`);
  console.log(`API Key: ${apiKey ? 'Set' : 'Not set'}`);
  
  try {
    const response = await axios.post('https://api.siliconflow.com/v1/chat/completions', {
      model: model,
      messages: [
        { role: 'user', content: 'Say "Hello, I am working!"' }
      ],
      temperature: 0.7,
      max_tokens: 50
    }, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      proxy: false
    });

    console.log('Response status:', response.status);
    console.log('Response content:', JSON.stringify(response.data.choices[0].message.content));
    console.log('Usage:', response.data.usage);
  } catch (error) {
    console.error('Error:', error.message);
    if (error.response) {
      console.error('Error response:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

test();
