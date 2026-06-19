/**
 * Client-side CLIP service for generating embeddings on the user's device
 * 
 * Strategy:
 * - TEXT model: DOWNLOADS on first app open (shows welcome page with progress)
 * - VISION model: SKIPPED for now (customer will handle later)
 * 
 * User sees welcome page while text model downloads!
 */

import { AutoTokenizer, CLIPTextModelWithProjection, env } from '@xenova/transformers';

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
env.allowLocalModels = false; // Don't look for local models
env.allowRemoteModels = true; // Always download from HuggingFace
env.backends.onnx.wasm.numThreads = 1;
env.useBrowserCache = true; // Cache downloaded models

// Singleton instances (lazy loaded)
let tokenizer: any = null;
let textModel: any = null;

// Loading states
let isTextModelLoaded = false;
let isVisionModelLoaded = false;
let textModelDownloading = false;
let textModelDownloadProgress = 0;
let textModelDownloadPromise: Promise<void> | null = null;

// Model configuration
const MODEL_ID = 'Xenova/clip-vit-base-patch32';

/**
 * Track progress from transformers.js model downloads
 * The callback receives objects like { status: 'download', progress: 0.5 } or { status: 'initiate' }
 */
function onDownloadProgress(progressInfo: any, basePercent: number, scale: number) {
  if (progressInfo.status === 'download' && progressInfo.progress !== undefined) {
    const percent = basePercent + Math.round(progressInfo.progress * scale);
    textModelDownloadProgress = Math.min(percent, basePercent + scale);
    console.log(`[CLIP] Text model download: ${textModelDownloadProgress}%`);
  } else if (progressInfo.status === 'done') {
    textModelDownloadProgress = basePercent + scale;
    console.log(`[CLIP] Text model download: ${textModelDownloadProgress}%`);
  }
}

/**
 * Normalize vector (L2 normalization)
 */
const normalizeVector = (vector: number[]): number[] => {
  const norm = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
  if (norm === 0) return vector;
  return vector.map(val => val / norm);
};

/**
 * Sleep helper
 */
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Load TEXT model from HuggingFace (always downloads on first app open)
 * Automatically retries up to 3 times with exponential backoff
 */
async function loadTextModel(): Promise<void> {
  if (isTextModelLoaded && tokenizer && textModel) {
    return Promise.resolve();
  }

  if (textModelDownloading && textModelDownloadPromise) {
    // Already downloading, return existing promise
    return textModelDownloadPromise;
  }

  textModelDownloading = true;
  const start = Date.now();
  
  console.log('[CLIP] Starting TEXT model download from HuggingFace...');
  await debugLog('text_model_download_start', { modelId: MODEL_ID });

  const maxRetries = 3;
  
  textModelDownloadPromise = new Promise<void>(async (resolve, reject) => {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`[CLIP] Downloading TEXT model... (attempt ${attempt}/${maxRetries})`);
        
        [tokenizer, textModel] = await Promise.all([
          AutoTokenizer.from_pretrained(MODEL_ID, { 
            quantized: true,
            progress_callback: (p: any) => onDownloadProgress(p, 0, 50) // tokenizer = 0-50%
          }),
          CLIPTextModelWithProjection.from_pretrained(MODEL_ID, { 
            quantized: true,
            progress_callback: (p: any) => onDownloadProgress(p, 50, 50) // model = 50-100%
          })
        ]);
        
        isTextModelLoaded = true;
        textModelDownloading = false;
        const loadTime = Date.now() - start;
        console.log(`[CLIP] TEXT model downloaded in ${loadTime}ms ✅`);
        await debugLog('text_model_download_success', { 
          modelId: MODEL_ID, 
          loadTime,
          progress: 100
        });
        resolve();
        return; // Success - exit function
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`[CLIP] Failed to download TEXT model (attempt ${attempt}/${maxRetries}):`, errorMsg);
        
        if (attempt < maxRetries) {
          // Exponential backoff: 1s, 2s, 4s
          const delayMs = 1000 * Math.pow(2, attempt - 1);
          console.log(`[CLIP] Retrying in ${delayMs}ms...`);
          await debugLog('text_model_download_retry', { 
            attempt, 
            maxRetries, 
            delayMs,
            error: errorMsg
          });
          await sleep(delayMs);
        } else {
          // All retries exhausted - reject
          textModelDownloading = false;
          console.error(`[CLIP] All ${maxRetries} attempts failed for TEXT model:`, error);
          const errorStack = error instanceof Error ? error.stack : undefined;
          await debugLog('text_model_download_failure', { 
            modelId: MODEL_ID, 
            error: errorMsg,
            stack: errorStack,
            attempts: maxRetries
          });
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      }
    }
  });

  return textModelDownloadPromise;
}

/**
 * Load VISION model in BACKGROUND (SKIPPED for now - customer will handle later)
 */
async function loadVisionModelInBackground(): Promise<void> {
  // Vision model loading is skipped for now
  console.log('[CLIP] Vision model loading SKIPPED (customer will handle later)');
  isVisionModelLoaded = true; // Mark as loaded since we're skipping it
  return Promise.resolve();
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
    const errorMsg = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    await debugLog('clip_service_init_failure', { 
      error: errorMsg,
      stack: errorStack
    });
    throw error instanceof Error ? error : new Error(String(error));
  }
}

/**
 * Generate IMAGE embedding from base64 image
 * NOTE: Vision model is SKIPPED for now - customer will handle later
 */
export async function embedImage(_base64: string): Promise<number[]> {
  // Ensure text model is loaded first
  await loadTextModel();

  console.log('[CLIP] Vision model is SKIPPED - cannot generate image embeddings');
  console.log('[CLIP] Customer will implement image embedding later');
  
  // Return a placeholder/error since vision model isn't available
  throw new Error('Image embedding is not available yet. Vision model loading is skipped - customer will handle implementation later.');
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
 * NOTE: Vision model is SKIPPED for now - customer will handle later
 */
export async function embedImageCrop(_base64: string, _box: number[]): Promise<number[]> {
  await loadTextModel();
  
  console.log('[CLIP] Vision model is SKIPPED - cannot generate crop embeddings');
  console.log('[CLIP] Customer will implement crop embedding later');
  
  // Return a placeholder/error since vision model isn't available
  throw new Error('Crop embedding is not available yet. Vision model loading is skipped - customer will handle implementation later.');
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
    isDownloading: textModelDownloading,
    downloadProgress: textModelDownloadProgress
  };
}

/**
 * Get text model download progress (0-100)
 */
export function getTextModelProgress(): number {
  return textModelDownloadProgress;
}

/**
 * Check if text model is still downloading
 */
export function isTextModelDownloading(): boolean {
  return textModelDownloading && !isTextModelLoaded;
}
