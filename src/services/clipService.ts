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
// Use relative path - works better with Capacitor iOS bundle
const LOCAL_TEXT_PATH = 'models/clip';

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

  console.log('[CLIP] Loading TEXT model from local bundle at:', LOCAL_TEXT_PATH);
  const start = Date.now();

  // Try loading from local bundle first
  try {
    console.log('[CLIP] Attempting to load from local bundle...');
    [processor, tokenizer, textModel] = await Promise.all([
      AutoProcessor.from_pretrained(LOCAL_TEXT_PATH, { quantized: true }),
      AutoTokenizer.from_pretrained(LOCAL_TEXT_PATH, { quantized: true }),
      CLIPTextModelWithProjection.from_pretrained(LOCAL_TEXT_PATH, { quantized: true })
    ]);
    
    isTextModelLoaded = true;
    console.log(`[CLIP] TEXT model loaded from bundle in ${Date.now() - start}ms ✅`);
  } catch (error) {
    console.error('[CLIP] Failed to load TEXT model from bundle:', error);
    console.log('[CLIP] Bundle load failed, trying to download from HuggingFace...');
    
    // Try downloading from HuggingFace as fallback
    try {
      console.log('[CLIP] Downloading TEXT model from HuggingFace...');
      [processor, tokenizer, textModel] = await Promise.all([
        AutoProcessor.from_pretrained(MODEL_ID, { quantized: true }),
        AutoTokenizer.from_pretrained(MODEL_ID, { quantized: true }),
        CLIPTextModelWithProjection.from_pretrained(MODEL_ID, { quantized: true })
      ]);
      isTextModelLoaded = true;
      console.log(`[CLIP] TEXT model downloaded from HuggingFace in ${Date.now() - start}ms ✅`);
    } catch (fallbackError) {
      console.error('[CLIP] Failed to load TEXT model:', fallbackError);
      throw fallbackError;
    }
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
      try {
        visionModel = await CLIPVisionModelWithProjection.from_pretrained(LOCAL_TEXT_PATH, { quantized: true });
        isVisionModelLoaded = true;
        console.log(`[CLIP] VISION model loaded from bundle in ${Date.now() - start}ms ✅`);
        resolve();
        return;
      } catch (localError) {
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
  
  try {
    // Step 1: Load TEXT model immediately (it's bundled!)
    await loadTextModel();
    
    // Step 2: Load VISION model in background (non-blocking)
    // User can search immediately while vision model downloads!
    loadVisionModelInBackground(); // Don't await - let it download in background
    
    console.log('[CLIP] Service ready for TEXT search! (Vision model downloading in background...)');
  } catch (error) {
    console.error('[CLIP] Initialization failed:', error);
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
