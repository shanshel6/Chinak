import { AutoProcessor, CLIPVisionModelWithProjection, AutoModelForObjectDetection, AutoModelForZeroShotObjectDetection, RawImage, env } from '@xenova/transformers';
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
const OD_MODEL_ID = process.env.OD_MODEL_ID || 'Xenova/yolos-tiny';
const ZERO_SHOT_OD_MODEL_ID = 'Xenova/owlvit-base-patch32'; // Zero-Shot Object Detection Model
const QUANTIZED = String(process.env.CLIP_QUANTIZED || 'true').toLowerCase() === 'true';

const ensureCacheDir = () => {
  const cacheDir = process.env.TRANSFORMERS_CACHE_DIR;
  if (cacheDir && env.cacheDir !== cacheDir) {
    env.cacheDir = cacheDir;
  }
};

env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.proxy = false;

let processorPromise = null;
let visionModelPromise = null;
let odProcessorPromise = null;
let odModelPromise = null;
let zsProcessorPromise = null;
let zsModelPromise = null;

const getProcessor = async () => {
  ensureCacheDir();
  if (!processorPromise) {
    processorPromise = AutoProcessor.from_pretrained(MODEL_ID);
  }
  return processorPromise;
};

const getVisionModel = async () => {
  ensureCacheDir();
  if (!visionModelPromise) {
    visionModelPromise = CLIPVisionModelWithProjection.from_pretrained(MODEL_ID, { quantized: QUANTIZED });
  }
  return visionModelPromise;
};

const getODProcessor = async () => {
  ensureCacheDir();
  if (!odProcessorPromise) {
    odProcessorPromise = AutoProcessor.from_pretrained(OD_MODEL_ID);
  }
  return odProcessorPromise;
};

const getODModel = async () => {
  ensureCacheDir();
  if (!odModelPromise) {
    odModelPromise = AutoModelForObjectDetection.from_pretrained(OD_MODEL_ID, { quantized: QUANTIZED });
  }
  return odModelPromise;
};

const getZSProcessor = async () => {
  ensureCacheDir();
  if (!zsProcessorPromise) {
    zsProcessorPromise = AutoProcessor.from_pretrained(ZERO_SHOT_OD_MODEL_ID);
  }
  return zsProcessorPromise;
};

const getZSModel = async () => {
  ensureCacheDir();
  if (!zsModelPromise) {
    zsModelPromise = AutoModelForZeroShotObjectDetection.from_pretrained(ZERO_SHOT_OD_MODEL_ID, { quantized: QUANTIZED });
  }
  return zsModelPromise;
};

export async function warmupClipService() {
  if (String(process.env.CLIP_WARMUP || 'true').toLowerCase() === 'false') return;

  try {
    await getODProcessor();
  } catch {}

  try {
    await getODModel();
  } catch {}

  if (String(process.env.CLIP_WARMUP_VISION || 'false').toLowerCase() === 'true') {
    try {
      await getProcessor();
    } catch {}

    try {
      await getVisionModel();
    } catch {}
  }
}

function cropRawImage(rawImage, box) {
  const xmin = Math.max(0, Math.floor(box[0]));
  const ymin = Math.max(0, Math.floor(box[1]));
  const xmax = Math.min(rawImage.width, Math.floor(box[2]));
  const ymax = Math.min(rawImage.height, Math.floor(box[3]));
  
  const w = xmax - xmin;
  const h = ymax - ymin;
  
  if (w <= 0 || h <= 0) return rawImage;

  const channels = rawImage.channels || 3;
  const newData = new Uint8ClampedArray(w * h * channels);
  
  for (let i = 0; i < h; i++) {
    const srcRowStart = ((ymin + i) * rawImage.width + xmin) * channels;
    const destRowStart = (i * w) * channels;
    const rowLength = w * channels;
    
    // Copy row segment
    // Note: TypedArray.set is faster than loop
    const srcSub = rawImage.data.subarray(srcRowStart, srcRowStart + rowLength);
    newData.set(srcSub, destRowStart);
  }
  
  return new RawImage(newData, w, h, channels);
}

async function detectAndCropObject(image, productName = null) {
  try {
    let result = null;

    if (productName) {
      // Use Zero-Shot Object Detection (OWL-ViT) with product name
      console.log(`[CLIP Service] Using Zero-Shot Object Detection for "${productName}"...`);
      try {
        const processor = await getZSProcessor();
        const model = await getZSModel();
        
        // Clean product name for better detection (remove numbers, weird chars, keep main words)
        // e.g. "iPhone 13 Pro Max 256GB" -> "iPhone"
        // But OWL-ViT works better with simple object names.
        // Let's try using the first 2-3 words or known category synonyms if possible.
        // For now, use the full name but truncated to first few words to avoid noise.
        const textQueries = [productName.split(' ').slice(0, 4).join(' ')];

        const { pixel_values, pixel_mask, original_sizes } = await processor(image, textQueries);
        const outputs = await model({ pixel_values, pixel_mask });
        
        // Threshold can be lower for zero-shot
        const threshold = 0.1; 
        
        const postProcess = processor.post_process_object_detection 
      ? processor.post_process_object_detection.bind(processor)
      : (processor.feature_extractor?.post_process_object_detection 
          ? processor.feature_extractor.post_process_object_detection.bind(processor.feature_extractor)
          : null);

    if (!postProcess) throw new Error('post_process_object_detection not found on processor');

    const results = await postProcess(outputs, threshold, original_sizes);
        
        if (results && results.length > 0 && results[0].boxes.length > 0) {
          result = results[0];
          console.log(`[CLIP Service] Zero-Shot found ${result.boxes.length} candidates for "${textQueries[0]}"`);
        }
      } catch (zsError) {
        console.warn('[CLIP Service] Zero-Shot Detection failed:', zsError.message);
      }
    }

    // Fallback to General Object Detection (DETR) if no product name or zero-shot failed
    if (!result) {
      if (productName) {
        console.log('[CLIP Service] Zero-Shot failed/empty. Falling back to General Object Detection (DETR)...');
      }
      const processor = await getODProcessor();
      const model = await getODModel();

      const { pixel_values, pixel_mask, original_sizes } = await processor(image);
      const outputs = await model({ pixel_values, pixel_mask });
      
      const threshold = 0.9;
      
      const postProcess = processor.post_process_object_detection 
        ? processor.post_process_object_detection.bind(processor)
        : (processor.feature_extractor?.post_process_object_detection 
            ? processor.feature_extractor.post_process_object_detection.bind(processor.feature_extractor)
            : null);

      if (!postProcess) throw new Error('post_process_object_detection not found on processor');

      const results = await postProcess(outputs, threshold, original_sizes);
      
      if (results && results.length > 0) {
        result = results[0];
      }
    }
    
    if (!result || result.boxes.length === 0) {
      console.log('[CLIP Service] No objects detected. Using full image.');
      return image;
    }

    // Find the "best" box.
    // Strategy: Largest area is usually the main object
    let bestBox = null;
    let maxArea = 0;
    const imgArea = image.width * image.height;

    for (let i = 0; i < result.boxes.length; i++) {
      const box = result.boxes[i];
      
      const [xmin, ymin, xmax, ymax] = box;
      const area = (xmax - xmin) * (ymax - ymin);
      
      // Filter out tiny boxes (e.g. less than 5% of image)
      if (area < imgArea * 0.05) continue;

      if (area > maxArea) {
        maxArea = area;
        bestBox = box;
      }
    }

    if (bestBox) {
      console.log(`[CLIP Service] Auto-cropped object with area ${(maxArea/imgArea*100).toFixed(1)}%`);
      return cropRawImage(image, bestBox);
    }

    console.log('[CLIP Service] No significant object detected. Using full image.');
    return image;
  } catch (error) {
    console.warn('[CLIP Service] Object detection failed, using original image:', error.message);
    return image;
  }
}

/**
 * Analyze image and return object bounding boxes (without cropping)
 * Used for frontend interactive selection
 * @param {string|Buffer} input - Image URL or Buffer
 * @returns {Promise<Array<{box: number[], score: number, label: string}>>}
 */
export async function analyzeImageObjects(input) {
  try {
    const processor = await getODProcessor();
    const model = await getODModel();
    let image;

    // Load image (reusing logic from generateImageEmbedding)
    if (typeof input === 'string') {
      if (input.startsWith('http')) {
          const res = await fetchWithRetry(input);
          if (!res || !res.ok) throw new Error(`Failed to fetch image: ${res?.statusText}`);
          const buffer = await res.arrayBuffer();
          image = await readRawImageFromBuffer(buffer);
      } else if (input.startsWith('data:image')) {
          const base64Data = input.split(',')[1];
          const buffer = Buffer.from(base64Data, 'base64');
          image = await readRawImageFromBuffer(buffer);
      } else {
          image = await RawImage.read(input);
      }
    } else if (input instanceof Buffer) {
      image = await readRawImageFromBuffer(input);
    } else {
        if (Buffer.isBuffer(input)) {
            image = await readRawImageFromBuffer(input);
        } else {
            image = await RawImage.read(input);
        }
    }

    const { pixel_values, pixel_mask, original_sizes } = await processor(image);
    const outputs = await model({ pixel_values, pixel_mask });
    
    const threshold = 0.7; // Lower threshold to show more options to user
    
    const postProcess = processor.post_process_object_detection 
      ? processor.post_process_object_detection.bind(processor)
      : (processor.feature_extractor?.post_process_object_detection 
          ? processor.feature_extractor.post_process_object_detection.bind(processor.feature_extractor)
          : null);

    if (!postProcess) throw new Error('post_process_object_detection not found on processor');

    const results = await postProcess(outputs, threshold, original_sizes);
    
    if (!results || results.length === 0 || results[0].boxes.length === 0) {
      return [];
    }

    const result = results[0];
    const objects = [];
    const imgArea = image.width * image.height;

    for (let i = 0; i < result.boxes.length; i++) {
      const box = result.boxes[i]; // [xmin, ymin, xmax, ymax]
      const score = result.scores ? result.scores[i] : 0;
      const labelId = result.labels ? result.labels[i] : -1;
      const label = model.config.id2label ? model.config.id2label[labelId] : 'object';

      const [xmin, ymin, xmax, ymax] = box;
      const area = (xmax - xmin) * (ymax - ymin);
      
      // Filter out tiny noise (less than 1% of image)
      if (area < imgArea * 0.01) continue;

      objects.push({
        box: [xmin, ymin, xmax, ymax],
        score: Number(score),
        label: label
      });
    }

    // Sort by area (largest first)
    objects.sort((a, b) => {
        const areaA = (a.box[2] - a.box[0]) * (a.box[3] - a.box[1]);
        const areaB = (b.box[2] - b.box[0]) * (b.box[3] - b.box[1]);
        return areaB - areaA;
    });

    return objects;

  } catch (error) {
    console.error('[CLIP Service] Analyze objects failed:', error.message);
    throw error;
  }
}

/**
 * Generate CLIP embedding for a specific crop region
 */
export async function embedImageCrop(input, box) {
    try {
        const processor = await getProcessor();
        const visionModel = await getVisionModel();
        let image;
    
        // Load image
        if (typeof input === 'string') {
          if (input.startsWith('http')) {
              const res = await fetchWithRetry(input);
              const buffer = await res.arrayBuffer();
              image = await readRawImageFromBuffer(buffer);
          } else if (input.startsWith('data:image')) {
              const base64Data = input.split(',')[1];
              const buffer = Buffer.from(base64Data, 'base64');
              image = await readRawImageFromBuffer(buffer);
          } else {
              image = await RawImage.read(input);
          }
        } else if (input instanceof Buffer) {
          image = await readRawImageFromBuffer(input);
        } else {
            if (Buffer.isBuffer(input)) {
                image = await readRawImageFromBuffer(input);
            } else {
                image = await RawImage.read(input);
            }
        }

        // Crop manually
        const croppedImage = cropRawImage(image, box);
        
        const normalizedImage = normalizeImageForProcessor(croppedImage);
        const { pixel_values } = await processor(normalizedImage);
        const { image_embeds } = await visionModel({ pixel_values });
    
        return normalizeL2(toNumberArray(image_embeds[0]));
      } catch (error) {
        console.error('[CLIP Service] Crop embedding failed:', error.message);
        throw error;
      }
}

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

function normalizeImageForProcessor(image) {
  if (!image || typeof image.width !== 'number' || typeof image.height !== 'number' || !Number.isFinite(image.width) || !Number.isFinite(image.height)) {
    throw new Error('Invalid image dimensions');
  }
  if (!image.data || typeof image.data.length !== 'number') {
    throw new Error('Invalid image pixel buffer');
  }

  if (image.channels !== 3 && image.channels !== 4) {
    throw new Error(`Unsupported image channels: ${image.channels}`);
  }

  const normalized = image.channels === 4 ? image.rgb() : image;
  const data = normalized.data instanceof Uint8ClampedArray
    ? normalized.data
    : new Uint8ClampedArray(normalized.data);

  return new RawImage(data, normalized.width, normalized.height, 3);
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

/**
 * Helper to expose internal functions for testing
 */
export async function testCropObject(input) {
  try {
    const isUrl = typeof input === 'string' && input.startsWith('http');
    let image;
    
    if (isUrl) {
      let cleanInput = input;
      if (cleanInput.endsWith('_.webp')) cleanInput = cleanInput.slice(0, -6);
      
      const response = await fetchWithRetry(cleanInput, {
        dispatcher: directAgent,
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'image/jpeg,image/png,image/*;q=0.8', 
          'Connection': 'keep-alive'
        }
      });
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      image = await readRawImageFromBuffer(buffer);
    } else {
       image = await RawImage.read(input);
    }

    const croppedImage = await detectAndCropObject(image, null); // Pass null to test DETR
    return { original: image, cropped: croppedImage };
  } catch (err) {
    console.error('testCropObject error:', err);
    throw err;
  }
}

/**
 * Generate CLIP embedding for an image
 * @param {string|Buffer} input - Image URL, Base64 string, or Buffer
 * @param {string} [productName] - Optional product name for context-aware cropping (Smart Storage)
 * @returns {Promise<number[]>} - 512-dim embedding vector
 */
export async function embedImage(input, productName = null) {
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

    // Auto-Crop Object (Smart Image Search)
    // Pass productName only if provided (for storage/indexing context)
    const croppedImage = await detectAndCropObject(image, productName);
    const normalizedImage = normalizeImageForProcessor(croppedImage);
    const { pixel_values } = await processor(normalizedImage);
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
