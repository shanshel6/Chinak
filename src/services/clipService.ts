/**
 * Client-side CLIP service for generating embeddings on the user's device
 * Uses @xenova/transformers to run CLIP locally
 */

import { AutoProcessor, CLIPVisionModelWithProjection, AutoTokenizer, CLIPTextModelWithProjection, RawImage, env } from '@xenova/transformers';

// Configure environment to use WebAssembly backend
env.allowLocalModels = true;
env.allowRemoteModels = true;
env.backends.onnx.wasm.numThreads = 1;

// Singleton instances (lazy loaded)
let processor: any = null;
let visionModel: any = null;
let tokenizer: any = null;
let textModel: any = null;
let isLoading = false;
let loadPromise: Promise<void> | null = null;

// Model configuration - use the same model as backend for consistency
const MODEL_ID = 'Xenova/clip-vit-base-patch32';

/**
 * Normalize vector (L2 normalization)
 */
const normalizeVector = (vector: number[]): number[] => {
  const norm = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
  if (norm === 0) return vector;
  return vector.map(val => val / norm);
};

/**
 * Load CLIP models (called once)
 */
const loadModels = async (): Promise<void> => {
  if (processor && visionModel && tokenizer && textModel) {
    return Promise.resolve();
  }

  if (isLoading && loadPromise) {
    return loadPromise;
  }

  isLoading = true;
  loadPromise = new Promise<void>(async (resolve, reject) => {
    try {
      console.log('[CLIP Frontend] Loading models...');
      const start = Date.now();

      // Load all models in parallel
      [processor, visionModel, tokenizer, textModel] = await Promise.all([
        AutoProcessor.from_pretrained(MODEL_ID),
        CLIPVisionModelWithProjection.from_pretrained(MODEL_ID, { quantized: true }),
        AutoTokenizer.from_pretrained(MODEL_ID),
        CLIPTextModelWithProjection.from_pretrained(MODEL_ID, { quantized: true })
      ]);

      console.log(`[CLIP Frontend] Models loaded in ${Date.now() - start}ms`);
      resolve();
    } catch (error) {
      console.error('[CLIP Frontend] Failed to load models:', error);
      reject(error);
    } finally {
      isLoading = false;
    }
  });

  return loadPromise;
};

/**
 * Convert base64 image to RawImage
 */
const base64ToRawImage = async (base64: string): Promise<any> => {
  // Create an Image element
  const img = new Image();
  img.src = base64;
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Failed to load image'));
  });

  // Create canvas and draw image
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas context not available');
  }
  ctx.drawImage(img, 0, 0);

  // Get image data
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { data, width, height } = imageData;

  // Convert to RGB (remove alpha)
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
 * Generate image embedding from base64 image
 */
export async function embedImage(base64: string): Promise<number[]> {
  await loadModels();

  console.log('[CLIP Frontend] Generating image embedding...');
  const start = Date.now();

  try {
    const rawImage = await base64ToRawImage(base64);
    const inputs = await processor(rawImage);
    const outputs = await visionModel(inputs);
    const embedding = Array.from(outputs.image_embeds.data);
    const normalized = normalizeVector(embedding);

    console.log(`[CLIP Frontend] Image embedding generated in ${Date.now() - start}ms`);
    return normalized;
  } catch (error) {
    console.error('[CLIP Frontend] Failed to generate image embedding:', error);
    throw error;
  }
}

/**
 * Generate text embedding from English text
 */
export async function embedText(text: string): Promise<number[]> {
  await loadModels();

  console.log('[CLIP Frontend] Generating text embedding for:', text);
  const start = Date.now();

  try {
    const inputs = await tokenizer(text, { padding: true, truncation: true });
    const outputs = await textModel(inputs);
    const embedding = Array.from(outputs.text_embeds.data);
    const normalized = normalizeVector(embedding);

    console.log(`[CLIP Frontend] Text embedding generated in ${Date.now() - start}ms`);
    return normalized;
  } catch (error) {
    console.error('[CLIP Frontend] Failed to generate text embedding:', error);
    throw error;
  }
}

/**
 * Crop image from bounding box and generate embedding
 */
export async function embedImageCrop(base64: string, box: number[]): Promise<number[]> {
  await loadModels();

  const [xmin, ymin, xmax, ymax] = box;

  console.log('[CLIP Frontend] Generating crop embedding...');
  const start = Date.now();

  try {
    const rawImage = await base64ToRawImage(base64);

    // Calculate crop dimensions
    const cropWidth = Math.max(1, Math.floor(xmax - xmin));
    const cropHeight = Math.max(1, Math.floor(ymax - ymin));
    const cropX = Math.max(0, Math.floor(xmin));
    const cropY = Math.max(0, Math.floor(ymin));

    // Ensure crop is within image bounds
    const safeWidth = Math.min(cropWidth, rawImage.width - cropX);
    const safeHeight = Math.min(cropHeight, rawImage.height - cropY);

    if (safeWidth <= 0 || safeHeight <= 0) {
      throw new Error('Invalid crop dimensions');
    }

    // Crop manually
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
    const embedding = Array.from(outputs.image_embeds.data);
    const normalized = normalizeVector(embedding);

    console.log(`[CLIP Frontend] Crop embedding generated in ${Date.now() - start}ms`);
    return normalized;
  } catch (error) {
    console.error('[CLIP Frontend] Failed to generate crop embedding:', error);
    throw error;
  }
}

/**
 * Preload models (call early in app lifecycle)
 */
export async function warmupClipService(): Promise<void> {
  try {
    await loadModels();
  } catch (error) {
    console.warn('[CLIP Frontend] Warmup failed:', error);
  }
}

/**
 * Check if models are loaded
 */
export function isClipReady(): boolean {
  return processor !== null && visionModel !== null;
}
