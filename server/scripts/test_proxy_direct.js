import { HttpsProxyAgent } from 'https-proxy-agent';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });

const proxyUrl = "http://127.0.0.1:7890";
const agent = new HttpsProxyAgent(proxyUrl);

async function testProxy() {
  try {
    console.log(`Testing proxy ${proxyUrl}...`);
    const response = await fetch('https://generativelanguage.googleapis.com/v1/models?key=' + process.env.GEMINI_API_KEY, {
      agent: agent
    });
    console.log('Status:', response.status);
    const data = await response.json();
    console.log('Success:', !!data.models);
  } catch (err) {
    console.error('Proxy test failed:', err.message);
  }
}

testProxy();
