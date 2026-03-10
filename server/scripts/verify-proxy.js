import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load .env
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.join(__dirname, '..', '.env');
dotenv.config({ path: envPath });

const proxyHost = process.env.PDD_PROXY_HOST;
const proxyPort = process.env.PDD_PROXY_PORT;
const proxyUser = process.env.PDD_PROXY_USER;
const proxyPass = process.env.PDD_PROXY_PASS;

const proxyUrl = `http://${proxyUser}:${proxyPass}@${proxyHost}:${proxyPort}`;

console.log(`Testing Proxy: ${proxyHost}:${proxyPort} (User: ${proxyUser})`);

const agent = new HttpsProxyAgent(proxyUrl);

async function testProxy() {
    try {
        console.log('1. Testing connection to httpbin.org/ip...');
        const response = await axios.get('https://httpbin.org/ip', {
            httpsAgent: agent,
            timeout: 30000 // Increased timeout
        });
        console.log('✅ Success! Proxy IP:', response.data.origin);
    } catch (error) {
        console.error('❌ Failed to connect to httpbin.org:', error.message);
        if (error.code === 'ETIMEDOUT') console.error('   -> The proxy timed out. It might be slow or offline.');
        if (error.response) console.error('   -> Status:', error.response.status);
    }

    try {
        console.log('\n2. Testing connection to mobile.pinduoduo.com...');
        const pddResponse = await axios.get('https://mobile.pinduoduo.com', {
            httpsAgent: agent,
            timeout: 30000, // Increased timeout
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });
        console.log('✅ Success! Pinduoduo Status:', pddResponse.status);
    } catch (error) {
        console.error('❌ Failed to connect to Pinduoduo:', error.message);
        if (error.code === 'ETIMEDOUT') console.error('   -> Connection timed out.');
    }
}

testProxy();
