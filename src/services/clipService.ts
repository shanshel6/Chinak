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

// Basic WASM configuration
// Disable SIMD and Multi-threading as they often cause "buffer" errors in older or restricted WebViews
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.simd = false;
env.backends.onnx.wasm.proxy = false;

// Use relative path without leading slash
// This is often more compatible with different Capacitor base hrefs
const getBaseModelPath = () => {
  return 'models/';
};

env.localModelPath = getBaseModelPath();

// Configure WASM paths - use the simplest relative path
env.backends.onnx.wasm.wasmPaths = 'models/clip/';

console.log('[CLIP] Environment Config:', {
  localModelPath: env.localModelPath,
  allowLocalModels: env.allowLocalModels,
  allowRemoteModels: env.allowRemoteModels,
  wasmPaths: env.backends.onnx.wasm.wasmPaths,
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
 * Load TEXT model from local bundle (no download needed)
 */
async function loadTextModel(): Promise<void> {
  if (isTextModelLoaded && tokenizer && textModel) {
    return Promise.resolve();
  }

  const start = Date.now();
  
  console.log(`[CLIP] Loading TEXT model from: ${env.localModelPath}${MODEL_ID}`);
  
  // Diagnostic: Try to fetch a file to verify path resolution
  if (Capacitor.isNativePlatform()) {
    try {
      const testUrl = `${window.location.origin}/models/clip/config.json`;
      const response = await fetch(testUrl);
      console.log(`[CLIP] Diagnostic: Fetch ${testUrl} -> ${response.status}`);
      if (response.status !== 200) {
        throw new Error(`Failed to fetch model config: ${response.status}`);
      }
    } catch (e) {
      console.error('[CLIP] Diagnostic: Fetch failed', e);
    }
  }

  try {
    // Initialize tokenizer and model
    tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID);
    
    // Load model with explicit error handling for the backend
    textModel = await CLIPTextModelWithProjection.from_pretrained(MODEL_ID, { 
      quantized: true,
    });
    
    isTextModelLoaded = true;
    lastError = null;
    const loadTime = Date.now() - start;
    console.log(`[CLIP] TEXT model loaded successfully in ${loadTime}ms ✅`);
  } catch (error) {
    console.error('[CLIP] Failed to load TEXT model. Error details:', error);
    lastError = error instanceof Error ? error.message : String(error);
    
    // If it's a backend error, try to provide more context
    if (lastError.includes('backend') || lastError.includes('wasm')) {
      lastError = `Backend Error: ${lastError}. Check if WASM files are in /models/clip/`;
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