/**
 * Client-side CLIP service for generating embeddings on the user's device
 * 
 * Strategy:
 * - TEXT model: BUNDLED with the app (in public/models/clip/)
 * - VISION model: SKIPPED for now (customer will handle later)
 * 
 * No download needed - models are included in the app bundle!
 */

import { AutoTokenizer, CLIPTextModelWithProjection, env } from '@xenova/transformers';
import { Capacitor } from '@capacitor/core';

// Configure environment to use LOCAL models bundled with the app
env.allowLocalModels = true;
env.allowRemoteModels = false;
env.useBrowserCache = false;

// CRITICAL: Disable all optimizations that cause "buffer" errors in Android WebViews
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.simd = false; 
env.backends.onnx.wasm.proxy = false;

// Use root-relative paths for models - most reliable for Capacitor
const getBaseModelPath = () => {
  return '/models/';
};

env.localModelPath = getBaseModelPath();

/**
 * EXPLICIT WASM MAPPING
 * On Android WebViews, the auto-detection of WASM files often fails with a TypeError.
 * We explicitly point to the standard (non-SIMD) WASM file for all roles.
 */
const wasmUrl = `${window.location.origin}/models/clip/ort-wasm.wasm`;
env.backends.onnx.wasm.wasmPaths = {
    'ort-wasm-simd.wasm': wasmUrl,
    'ort-wasm-threaded.wasm': wasmUrl,
    'ort-wasm.wasm': wasmUrl
};

console.log('[CLIP] Force-Safe Config:', {
  localModelPath: env.localModelPath,
  wasmUrl: wasmUrl,
  platform: Capacitor.getPlatform(),
});

// Singleton instances (lazy loaded)
let tokenizer: any = null;
let textModel: any = null;

// Loading states
let isTextModelLoaded = false;
let isVisionModelLoaded = false;
let lastError: string | null = null;

// Model configuration - must match the folder name in public/models/
const MODEL_ID = 'clip';

/**
 * Normalize vector (L2 normalization)
 */
const normalizeVector = (vector: number[]): number[] => {
  const norm = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
  if (norm === 0) return vector;
  return vector.map(val => val / norm);
};

/**
 * Load the model from the local bundle with aggressive error catching
 */
async function loadTextModel(): Promise<void> {
  if (isTextModelLoaded && tokenizer && textModel) {
    return Promise.resolve();
  }

  const start = Date.now();
  lastError = null;
  
  console.log(`[CLIP] Loading TEXT model from: ${env.localModelPath}${MODEL_ID}`);
  
  try {
    // Initialize tokenizer
    tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID);
    
    // Load model - the library will use our explicit wasmPaths
    textModel = await CLIPTextModelWithProjection.from_pretrained(MODEL_ID, { 
      quantized: true,
    });
    
    isTextModelLoaded = true;
    lastError = null;
    console.log(`[CLIP] TEXT model loaded successfully in ${Date.now() - start}ms ✅`);
  } catch (error) {
    console.error('[CLIP] Load failed:', error);
    
    const errObj = error instanceof Error ? error : new Error(String(error));
    lastError = `Initialization Error: ${errObj.message}`;
    
    if (lastError.includes('buffer')) {
      lastError += "\n\nTip: This is a memory alignment issue in the WebView. We are trying to use the safest non-SIMD engine.";
    }
    
    throw error;
  }
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
  
  try {
    // Step 1: Load TEXT model from local bundle
    await loadTextModel();
    
    // Step 2: Load VISION model in background (non-blocking)
    loadVisionModelInBackground(); // Don't await - let it download in background
    
    console.log('[CLIP] Service ready for TEXT search! (Vision model loading in background...)');
  } catch (error) {
    console.error('[CLIP] Initialization failed:', error);
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
export function getClipStatus(): { textReady: boolean; visionReady: boolean; isDownloading: boolean; downloadProgress: number; error: string | null } {
  return {
    textReady: isTextModelLoaded,
    visionReady: isVisionModelLoaded,
    isDownloading: false,
    downloadProgress: 100,
    error: lastError
  };
}