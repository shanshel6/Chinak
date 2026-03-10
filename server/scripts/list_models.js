import dns from 'dns';
dns.setDefaultResultOrder('ipv4first');

import { GoogleGenerativeAI } from '@google/generative-ai';
import { ProxyAgent, setGlobalDispatcher } from 'undici';
import dotenv from 'dotenv';
dotenv.config({ path: 'server/.env' });

const proxyUrl = 'http://127.0.0.1:7890';
const proxyAgent = new ProxyAgent(proxyUrl);
setGlobalDispatcher(proxyAgent);

async function listModels() {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  try {
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models?key=' + process.env.GEMINI_API_KEY);
    const data = await response.json();
    console.log('Available models:', JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Failed to list models:', error);
  }
}

listModels();
