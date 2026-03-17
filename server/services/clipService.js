import { AutoProcessor, CLIPVisionModelWithProjection, RawImage, env } from '@xenova/transformers';
import { Agent, ProxyAgent, setGlobalDispatcher } from 'undici';
import axios from 'axios';
import dns from 'node:dns';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// Force IPv4 first to avoid IPv6 timeouts with AliCDN
dns.setDefaultResultOrder('ipv4first');

// Configure Proxy for Hugging Face if needed
if (!process.env.HTTPS_PROXY && !process.env.https_proxy && process.env.NODE_ENV !== 'production') {
   process.env.HTTPS_PROXY = 'http://127.0.0.1:7890';
   process.env.NO_PROXY = 'localhost,127.0.0.1,alicdn.com,img.alicdn.com,taobao.com';
   console.log('[CLIP Service] Setting HTTPS_PROXY to http://127.0.0.1:7890');
}

// Create a Proxy Agent for global fetch (used by transformers.js)
// This ensures model downloads go through the proxy if configured
const proxyAgent = process.env.HTTPS_PROXY ? new ProxyAgent({
  uri: process.env.HTTPS_PROXY,
  connect: {
    rejectUnauthorized: false,
    timeout: 30000,
  }
}) : undefined;

if (proxyAgent) {
  setGlobalDispatcher(proxyAgent);
}

// Create a custom undici Agent for direct connections (if needed)
// But since we set global dispatcher, we might not need this unless we override per request
const directAgent = new Agent({
  connect: {
    rejectUnauthorized: false, 
    timeout: 30000, 
  },
  bodyTimeout: 30000, 
});

const MODEL_ID = process.env.CLIP_MODEL_ID || 'Xenova/clip-vit-base-patch32';
const QUANTIZED = String(process.env.CLIP_QUANTIZED || 'true').toLowerCase() === 'true';

if (process.env.TRANSFORMERS_CACHE_DIR) {
  env.cacheDir = process.env.TRANSFORMERS_CACHE_DIR;
}

let processorPromise = null;
let visionModelPromise = null;

const getProcessor = async () => {
  if (!processorPromise) {
    processorPromise = AutoProcessor.from_pretrained(MODEL_ID);
  }
  return processorPromise;
};

const getVisionModel = async () => {
  if (!visionModelPromise) {
    visionModelPromise = CLIPVisionModelWithProjection.from_pretrained(MODEL_ID, { quantized: QUANTIZED });
  }
  return visionModelPromise;
};

const normalizeL2 = (vector) => {
  if (!Array.isArray(vector)) throw new Error('Invalid embedding vector');
  let sumSq = 0;
  for (const v of vector) {
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error('Embedding vector contains non-numeric values');
    sumSq += n * n;
  }
  const norm = Math.sqrt(sumSq);
  if (!Number.isFinite(norm) || norm === 0) return vector.map(() => 0);
  return vector.map((v) => Number(v) / norm);
};

const toNumberArray = (tensorLike) => {
  const data = tensorLike?.data ?? tensorLike;
  if (data && typeof data.length === 'number') return Array.from(data).map((n) => Number(n));
  throw new Error('Unable to read embedding tensor data');
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function readRawImageFromBuffer(buffer) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clip-'));
  const tempFilePath = path.join(tempDir, 'input.jpg');
  try {
    await fs.writeFile(tempFilePath, buffer);
    return await RawImage.read(tempFilePath);
  } finally {
    try {
      await fs.unlink(tempFilePath);
    } catch {}
    try {
      await fs.rmdir(tempDir);
    } catch {}
  }
}

async function fetchWithRetry(url, options = {}, retries = 3) {
  // Use axios first
  try {
      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        headers: options.headers,
        timeout: 30000,
        validateStatus: (status) => status < 400
      });
      return {
          ok: true,
          status: response.status,
          statusText: response.statusText,
          arrayBuffer: async () => response.data
      };
  } catch (axiosErr) {
      const status = axiosErr?.response?.status;
      const statusText = axiosErr?.response?.statusText;
      if (Number.isFinite(status) && status >= 400 && status < 500 && status !== 408 && status !== 429) {
        throw new Error(`fetch failed: ${status} ${statusText || ''}`.trim());
      }
      console.warn(`[CLIP Service] Axios failed for ${url}: ${axiosErr.message}. Falling back to fetch...`);
  }

  // Fallback to fetch
  let lastError;
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, options);
      if (!response.ok) {
        throw new Error(`fetch failed: ${response.status} ${response.statusText}`);
      }
      return response;
    } catch (err) {
      lastError = err;
      const message = String(err?.message || '');
      const match = message.match(/fetch failed:\s*(\d{3})/i);
      if (match) {
        const status = Number.parseInt(match[1], 10);
        if (status >= 400 && status < 500 && status !== 408 && status !== 429) {
          throw err;
        }
      }
      const delay = 1000 * Math.pow(2, i);
      console.warn(`[CLIP Service] Fetch failed for ${url}. Retrying in ${delay}ms...`);
      await sleep(delay);
    }
  }
  throw lastError;
}

export async function embedImage(input) {
  try {
    const processor = await getProcessor();
    const model = await getVisionModel();

    // If it's a URL, use fromURL. If it's base64 or buffer, use read.
    const isUrl = typeof input === 'string' && input.startsWith('http');
    let image;
    
    if (isUrl) {
      // Clean URL: remove _.webp suffix if present to get original JPEG/PNG
      // This helps avoiding WebP format which Jimp doesn't support, and Sharp is broken on Windows/Node24
      let cleanInput = input;
      if (cleanInput.endsWith('_.webp')) {
        cleanInput = cleanInput.slice(0, -6);
      }
      
      // Manual fetch with User-Agent
      const response = await fetchWithRetry(cleanInput, {
        dispatcher: directAgent, // Use direct connection for AliCDN (bypass proxy)
        method: 'GET', // Explicitly set method
        headers: {
          // Use a simple User-Agent and NO Referer, as this proved most reliable in testing (10-15ms vs 100ms+)
          // and consistently returned the full image size.
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'image/jpeg,image/png,image/*;q=0.8', 
          'Connection': 'keep-alive' // Explicitly keep connection alive
        }
      });
      
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      
      image = await readRawImageFromBuffer(buffer);
    } else {
      // Input is likely a Buffer (from base64 upload) or a local file path
      try {
        if (Buffer.isBuffer(input)) {
            image = await readRawImageFromBuffer(input);
        } else {
            image = await RawImage.read(input);
        }
      } catch (err) {
          console.error('[CLIP Service] Failed to process local image/buffer:', err.message);
          throw new Error(`Local image processing failed: ${err.message}`);
      }
    }

    const { pixel_values } = await processor(image);
    const output = await model({ pixel_values });
    const imageEmbeds = output?.image_embeds;
    if (!imageEmbeds) throw new Error('CLIP model did not return image_embeds');

    const embedding = toNumberArray(imageEmbeds);
    if (!embedding || embedding.length !== 512) {
      throw new Error(`Unexpected CLIP embedding length ${embedding?.length} (expected 512)`);
    }
    return normalizeL2(embedding);
  } catch (error) {
    // We actually want to see ALL errors during manual testing so we know what's wrong
    console.error('[CLIP Service] Error generating embedding:', error?.message || error);
    
    // If it's a Buffer, we don't want to return 0s because it's a live user search
    if (Buffer.isBuffer(input) || (typeof input === 'string' && input.startsWith('data:'))) {
        throw error; // Let the API endpoint catch and return 500
    }
    
    // Return empty vector for ANY error so the batch script doesn't crash or hang
    return new Array(512).fill(0);
  }
}
