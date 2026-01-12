import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

import { HfInference } from '@huggingface/inference';
import { HttpsProxyAgent } from 'https-proxy-agent';
import nodeFetch from 'node-fetch';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });

import { fetch as undiciFetch, ProxyAgent, setGlobalDispatcher } from 'undici';
const agent = new ProxyAgent('http://127.0.0.1:7890');
setGlobalDispatcher(agent);

async function testHF() {
  console.log('Testing Hugging Face with Proxy (setGlobalDispatcher)...');
  console.log('API Key:', process.env.HUGGINGFACE_API_KEY ? 'Found' : 'Missing');
  
  const hf = new HfInference(process.env.HUGGINGFACE_API_KEY);

  try {
    console.log('1. Testing Embedding...');
    const emb = await hf.featureExtraction({
      model: 'sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2',
      inputs: 'Hello world',
    });
    console.log('Embedding Success! Length:', emb.length);

    console.log('2. Testing Text Generation (Mistral)...');
    const gen = await hf.textGeneration({
      model: 'mistralai/Mistral-7B-Instruct-v0.2',
      inputs: '<s>[INST] Say hello [/INST]',
      parameters: { max_new_tokens: 10 }
    });
    console.log('Text Generation Success:', gen.generated_text);
  } catch (err) {
    console.error('HF Test Failed:', err.message);
    if (err.cause) console.error('Cause:', err.cause);
  }
}

testHF();
