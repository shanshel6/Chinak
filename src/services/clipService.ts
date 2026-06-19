/**
 * Client-side CLIP service for generating embeddings on the user's device
 * 
 * Strategy:
 * - TEXT model: BUNDLED with app (instant, ~61MB)
 * - VISION model: DOWNLOADS in background when app opens (non-blocking)
 * 
 * User can search immediately using text model while vision model downloads!
 */

import { AutoProcessor, CLIPVisionModelWithProjection, AutoTokenizer, CLIPTextModelWithProjection, RawImage, env } from '@xenova/transformers';

// Debug instrumentation
const DEBUG_SERVER_URL = 'http://localhost:3000';
async function debugLog(event: string, data: any = {}) {
  try {
    const logEntry = {
      sessionId: 'clip-model-loading-failure',
      event,
      data,
      timestamp: new Date().toISOString(),
      source: 'clipService'
    };
    
    // Don't await - fire and forget to avoid blocking
    fetch(`${DEBUG_SERVER_URL}/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(logEntry)
    }).catch(() => {
      // Ignore errors - debug logging shouldn't break the app
    });
  } catch (error) {
    // Silently fail - debug logging shouldn't break the app
    console.warn('[DEBUG] Failed to send log:', error);
  }
}

// Configure environment
env.allowLocalModels = true;
env.allowRemoteModels = true;
env.backends.onnx.wasm.numThreads = 1;

// Singleton instances (lazy loaded)
let processor: any = null;
let visionModel: any = null;
let tokenizer: any = null;
let textModel: any = null;

// Loading states
let isTextModelLoaded = false;
let isVisionModelLoaded = false;
let isVisionModelLoading = false;
let visionModelLoadPromise: Promise<void> | null = null;
let visionModelDownloadProgress = 0;

// Subscribe to model download progress
env.useBrowserCache = false;
(env as any).onModelDownloaded = (progress: any) => {
  if (progress.progress !== undefined) {
    visionModelDownloadProgress = Math.round(progress.progress);
    console.log(`[CLIP] Vision model download: ${visionModelDownloadProgress}%`);
  }
};

// Model configuration
const MODEL_ID = 'Xenova/clip-vit-base-patch32';
// Try multiple path formats for iOS compatibility
const LOCAL_TEXT_PATHS = [
  '/models/clip',      // Absolute path (works if served from root)
  './models/clip',     // Relative to current directory
  'models/clip',       // Original relative path
];

/**
 * Normalize vector (L2 normalization)
 */
const normalizeVector = (vector: number[]): number[] => {
  const norm = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
  if (norm === 0) return vector;
  return vector.map(val => val / norm);
};

/**
 * Load TEXT model from local bundle (BUNDLED with app - instant)
 */
async function loadTextModel(): Promise<void> {
  if (isTextModelLoaded && tokenizer && textModel) {
    return Promise.resolve();
  }

  const start = Date.now();
  
  // Debug: Start model loading
  await debugLog('text_model_load_start', { paths: LOCAL_TEXT_PATHS });

  // Try loading from local bundle with multiple path formats
  let lastError: Error | null = null;
  
  for (const path of LOCAL_TEXT_PATHS) {
    console.log('[CLIP] Attempting to load TEXT model from:', path);
    await debugLog('text_model_local_attempt', { path });
    
    try {
      [processor, tokenizer, textModel] = await Promise.all([
        AutoProcessor.from_pretrained(path, { quantized: true }),
        AutoTokenizer.from_pretrained(path, { quantized: true }),
        CLIPTextModelWithProjection.from_pretrained(path, { quantized: true })
      ]);
      
      isTextModelLoaded = true;
      const loadTime = Date.now() - start;
      console.log(`[CLIP] TEXT model loaded from ${path} in ${loadTime}ms ✅`);
      await debugLog('text_model_load_success', { 
        path, 
        loadTime,
        source: 'local_bundle'
      });
      return; // Success!
    } catch (error) {
      console.error(`[CLIP] Failed to load TEXT model from ${path}:`, error);
      await debugLog('text_model_local_failure', { 
        path, 
        error: error.message
      });
      lastError = error;
      // Continue to try next path
    }
  }
  
  // All local paths failed, try downloading from HuggingFace as fallback
  console.log('[CLIP] All local paths failed, trying to download from HuggingFace...');
  await debugLog('text_model_fallback_attempt', { modelId: MODEL_ID });
  
  try {
    console.log('[CLIP] Downloading TEXT model from HuggingFace...');
    [processor, tokenizer, textModel] = await Promise.all([
      AutoProcessor.from_pretrained(MODEL_ID, { quantized: true }),
      AutoTokenizer.from_pretrained(MODEL_ID, { quantized: true }),
      CLIPTextModelWithProjection.from_pretrained(MODEL_ID, { quantized: true })
    ]);
    isTextModelLoaded = true;
    const loadTime = Date.now() - start;
    console.log(`[CLIP] TEXT model downloaded from HuggingFace in ${loadTime}ms ✅`);
    await debugLog('text_model_load_success', { 
      modelId: MODEL_ID, 
      loadTime,
      source: 'huggingface'
    });
  } catch (fallbackError) {
    console.error('[CLIP] Failed to load TEXT model:', fallbackError);
    await debugLog('text_model_load_failure', { 
      modelId: MODEL_ID, 
      error: fallbackError.message,
      stack: fallbackError.stack
    });
    throw lastError || fallbackError;
  }
}

/**
 * Load VISION model in BACKGROUND (downloads while user uses app)
 * This is non-blocking - user can search immediately!
 */
async function loadVisionModelInBackground(): Promise<void> {
  if (isVisionModelLoaded) {
    return Promise.resolve();
  }

  if (isVisionModelLoading && visionModelLoadPromise) {
    // Already loading, return existing promise
    return visionModelLoadPromise;
  }

  isVisionModelLoading = true;
  
  visionModelLoadPromise = new Promise<void>(async (resolve) => {
    console.log('[CLIP] Loading VISION model in background... ⏳');
    console.log('[CLIP] You can search while vision model downloads!');
    const start = Date.now();

    try {
      // Try local bundle first (though we don't bundle vision model currently)
      // Try each path format
      let localLoadSuccess = false;
      for (const path of LOCAL_TEXT_PATHS) {
        try {
          visionModel = await CLIPVisionModelWithProjection.from_pretrained(path, { quantized: true });
          isVisionModelLoaded = true;
          console.log(`[CLIP] VISION model loaded from ${path} in ${Date.now() - start}ms ✅`);
          resolve();
          localLoadSuccess = true;
          return;
        } catch (localError) {
          // Try next path
        }
      }
      
      if (!localLoadSuccess) {
        console.log('[CLIP] No local vision model, downloading from HuggingFace...');
      }

      // Download from HuggingFace
      visionModel = await CLIPVisionModelWithProjection.from_pretrained(MODEL_ID, { quantized: true });
      isVisionModelLoaded = true;
      console.log(`[CLIP] VISION model downloaded in ${Date.now() - start}ms ✅`);
      resolve();
    } catch (error) {
      console.error('[CLIP] Failed to load VISION model:', error);
      // Don't reject - text model still works!
      console.warn('[CLIP] VISION model failed but TEXT search still works!');
      resolve(); // Don't block, text model is ready
    } finally {
      isVisionModelLoading = false;
    }
  });

  return visionModelLoadPromise;
}

/**
 * Initialize CLIP service
 * Call this when app starts - loads text model immediately, vision model in background
 */
export async function initializeClipService(): Promise<void> {
  console.log('[CLIP] Initializing CLIP service...');
  await debugLog('clip_service_init_start');
  
  try {
    // Step 1: Load TEXT model immediately (it's bundled!)
    await debugLog('clip_service_load_text_start');
    await loadTextModel();
    await debugLog('clip_service_load_text_complete');
    
    // Step 2: Load VISION model in background (non-blocking)
    // User can search immediately while vision model downloads!
    await debugLog('clip_service_load_vision_background_start');
    loadVisionModelInBackground(); // Don't await - let it download in background
    await debugLog('clip_service_load_vision_background_triggered');
    
    console.log('[CLIP] Service ready for TEXT search! (Vision model downloading in background...)');
    await debugLog('clip_service_init_success');
  } catch (error) {
    console.error('[CLIP] Initialization failed:', error);
    await debugLog('clip_service_init_failure', { 
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

/**
 * Convert base64 image to RawImage
 */
const base64ToRawImage = async (base64: string): Promise<any> => {
  const img = new Image();
  img.src = base64;
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Failed to load image'));
  });

  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas context not available');
  }
  ctx.drawImage(img, 0, 0);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { data, width, height } = imageData;

  const rgbData = new Uint8ClampedArray(width * height * 3);
  for (let i = 0; i < height; i++) {
    for (let j = 0; j < width; j++) {
      const idx = (i * width + j) * 4;
      const rgbIdx = (i * width + j) * 3;
      rgbData[rgbIdx] = data[idx];
      rgbData[rgbIdx + 1] = data[idx + 1];
      rgbData[rgbIdx + 2] = data[idx + 2];
    }
  }

  return new RawImage(rgbData, width, height, 3);
};

/**
 * Generate IMAGE embedding from base64 image
 * Will wait for vision model to load if still downloading
 */
export async function embedImage(base64: string): Promise<number[]> {
  // Ensure text model is loaded first
  await loadTextModel();

  // Wait for vision model if still downloading
  if (!isVisionModelLoaded) {
    console.log('[CLIP] Waiting for vision model to load...');
    await visionModelLoadPromise;
  }

  console.log('[CLIP] Generating image embedding...');
  const start = Date.now();

  try {
    const rawImage = await base64ToRawImage(base64);
    const inputs = await processor(rawImage);
    const outputs = await visionModel(inputs);
    const embedding = Array.from(outputs.image_embeds.data) as number[];
    const normalized = normalizeVector(embedding);

    console.log(`[CLIP] Image embedding generated in ${Date.now() - start}ms`);
    return normalized;
  } catch (error) {
    console.error('[CLIP] Failed to generate image embedding:', error);
    throw error;
  }
}

/**
 * Generate TEXT embedding from English text
 * Uses BUNDLED text model - works immediately!
 */
export async function embedText(text: string): Promise<number[]> {
  // Ensure text model is loaded
  await loadTextModel();

  console.log('[CLIP] Generating text embedding for:', text);
  const start = Date.now();

  try {
    const inputs = await tokenizer(text, { padding: true, truncation: true });
    const outputs = await textModel(inputs);
    const embedding = Array.from(outputs.text_embeds.data) as number[];
    const normalized = normalizeVector(embedding);

    console.log(`[CLIP] Text embedding generated in ${Date.now() - start}ms`);
    return normalized;
  } catch (error) {
    console.error('[CLIP] Failed to generate text embedding:', error);
    throw error;
  }
}

/**
 * Crop image from bounding box and generate embedding
 */
export async function embedImageCrop(base64: string, box: number[]): Promise<number[]> {
  await loadTextModel();
  
  if (!isVisionModelLoaded) {
    console.log('[CLIP] Waiting for vision model to load...');
    await visionModelLoadPromise;
  }

  const [xmin, ymin, xmax, ymax] = box;
  console.log('[CLIP] Generating crop embedding...');
  const start = Date.now();

  try {
    const rawImage = await base64ToRawImage(base64);

    const cropWidth = Math.max(1, Math.floor(xmax - xmin));
    const cropHeight = Math.max(1, Math.floor(ymax - ymin));
    const cropX = Math.max(0, Math.floor(xmin));
    const cropY = Math.max(0, Math.floor(ymin));

    const safeWidth = Math.min(cropWidth, rawImage.width - cropX);
    const safeHeight = Math.min(cropHeight, rawImage.height - cropY);

    if (safeWidth <= 0 || safeHeight <= 0) {
      throw new Error('Invalid crop dimensions');
    }

    const croppedData = new Uint8ClampedArray(safeWidth * safeHeight * 3);
    for (let y = 0; y < safeHeight; y++) {
      for (let x = 0; x < safeWidth; x++) {
        const srcIdx = ((cropY + y) * rawImage.width + (cropX + x)) * 3;
        const destIdx = (y * safeWidth + x) * 3;
        croppedData[destIdx] = rawImage.data[srcIdx];
        croppedData[destIdx + 1] = rawImage.data[srcIdx + 1];
        croppedData[destIdx + 2] = rawImage.data[srcIdx + 2];
      }
    }

    const croppedImage = new RawImage(croppedData, safeWidth, safeHeight, 3);
    const inputs = await processor(croppedImage);
    const outputs = await visionModel(inputs);
    const embedding = Array.from(outputs.image_embeds.data) as number[];
    const normalized = normalizeVector(embedding);

    console.log(`[CLIP] Crop embedding generated in ${Date.now() - start}ms`);
    return normalized;
  } catch (error) {
    console.error('[CLIP] Failed to generate crop embedding:', error);
    throw error;
  }
}

/**
 * Preload models (call early in app lifecycle)
 * This is the main entry point - call this when app starts!
 */
export async function warmupClipService(): Promise<void> {
  try {
    await initializeClipService();
  } catch (error) {
    console.warn('[CLIP] Warmup failed:', error);
  }
}

/**
 * Check if CLIP service is ready for text search (immediate)
 */
export function isClipReady(): boolean {
  return isTextModelLoaded;
}

/**
 * Check if CLIP service is ready for image search (may need to wait)
 */
export function isVisionModelReady(): boolean {
  return isVisionModelLoaded;
}

/**
 * Get loading status for UI display
 */
export function getClipStatus(): { textReady: boolean; visionReady: boolean; isDownloading: boolean; downloadProgress: number } {
  return {
    textReady: isTextModelLoaded,
    visionReady: isVisionModelLoaded,
    isDownloading: isVisionModelLoading,
    downloadProgress: visionModelDownloadProgress
  };
}

/**
 * Get vision model download progress (0-100)
 */
export function getVisionModelProgress(): number {
  return visionModelDownloadProgress;
}

/**
 * Check if vision model is still downloading
 */
export function isVisionModelDownloading(): boolean {
  return isVisionModelLoading && !isVisionModelLoaded;
}
