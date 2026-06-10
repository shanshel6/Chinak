import axios from 'axios';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../.env') });

async function listModels() {
  const apiKey = process.env.SILICONFLOW_API_KEY;
  
  try {
    const response = await axios.get('https://api.siliconflow.com/v1/models', {
      headers: { 'Authorization': `Bearer ${apiKey}` },
      proxy: false
    });

    const qwenModels = response.data.data
      .filter(m => m.id.toLowerCase().includes('qwen'))
      .map(m => m.id)
      .sort();
    
    console.log('Qwen Models:', qwenModels);
  } catch (error) {
    console.error('Error:', error.message);
  }
}

listModels();
