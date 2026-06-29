/**
 * Client-side CLIP service for generating embeddings on the user's device
 *
 * Strategy:
 * - TEXT model: BUNDLED with the app (in public/models/clip/)
 * - VISION model: Downloaded ON-DEMAND in the background, with resume.
 *                 The download happens as soon as the app starts; if the
 *                 user kills the app mid-download, the next launch picks
 *                 up where it left off.
 */

import { AutoProcessor, AutoTokenizer, CLIPTextModelWithProjection, CLIPVisionModelWithProjection, RawImage, env } from '@xenova/transformers';
import { visionDownloadManager, useVisionDownloadState, safeClipLog } from './visionDownloadManager';
import type { VisionState } from './visionDownloadManager';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';

// Configure environment to use LOCAL models bundled with the app
env.allowLocalModels = true;
env.allowRemoteModels = false;
env.useBrowserCache = false;

// CRITICAL: Disable all optimizations that cause "buffer" errors in Android WebViews
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.simd = false; 
env.backends.onnx.wasm.proxy = false;

/**
 * Get the correct base URL for the model assets.
 */
const getModelsBaseUrl = (): string => {
  if (Capacitor.isNativePlatform()) {
    // On Android this is http://localhost, on iOS it's capacitor://localhost
    return `${window.location.origin}/models/clip/`;
  }
  return `${window.location.origin}/models/clip/`;
};

env.localModelPath = `${window.location.origin}/models/`;

/**
 * EXPLICIT WASM MAPPING
 * On Android WebViews, the auto-detection of WASM files often fails with a TypeError.
 * We explicitly point to the standard (non-SIMD) WASM file for all roles.
 * 
 * CRITICAL FIX: The WASM files MUST match the onnxruntime-web version (1.14.0) that
 * @xenova/transformers@2.17.2 uses. Using mismatched WASM files causes the
 * "Cannot read properties of undefined (reading 'buffer')" error because the
 * internal memory layout differs between versions.
 */
const wasmBaseUrl = getModelsBaseUrl();
const wasmUrl = `${wasmBaseUrl}ort-wasm.wasm`;

// Only the non-SIMD, single-threaded runtime is ever loaded (simd=false,
// numThreads=1 above), so we ship and map only ort-wasm.wasm. The SIMD/threaded
// variants were ~28 MB of dead weight in the app bundle.
env.backends.onnx.wasm.wasmPaths = {
    'ort-wasm.wasm': wasmUrl,
};

/**
 * Get the proper Capacitor URL base for downloaded vision assets.
 * This uses `convertFileSrc` to produce a `_capacitor_file_/` URL that
 * the native Capacitor server knows how to serve from the app's
 * private Data directory.
 * 
 * This is CRITICAL because the native server intercepts `http://localhost/...`
 * requests at the system level — JavaScript fetch shims cannot intercept them.
 * The `_capacitor_file_/` path is the ONLY way to make the native server
 * serve files from the app's data directory.
 */
async function getVisionModelBaseUrl(): Promise<string> {
  if (!Capacitor.isNativePlatform()) {
    return `${window.location.origin}/models/`;
  }
  
  try {
    // Point at the parent `models` directory because transformers resolves
    // files as `<localModelPath>/<MODEL_ID>/...`.
    // Our vision files are in `models/clip/`, and MODEL_ID is 'clip',
    // so we need localModelPath to point to the parent 'models/' directory.
    const { uri: dirUri } = await Filesystem.getUri({
      path: 'models',
      directory: Directory.Data,
    });
    
    // Convert to a URL the native server can serve
    // This produces something like: http://localhost/_capacitor_file_/data/user/0/com.chinak.app/files/models/
    const convertedUrl = Capacitor.convertFileSrc(dirUri);
    
    // Ensure it ends with a trailing slash
    const baseUrl = convertedUrl.endsWith('/') ? convertedUrl : convertedUrl + '/';
    
    safeClipLog(`Vision model base URL: ${baseUrl}`);
    return baseUrl;
  } catch (e) {
    console.error('[CLIP] Failed to get vision model base URL:', e);
    return `${window.location.origin}/models/`;
  }
}

safeClipLog(`Force-Safe Config: ${JSON.stringify({
    localModelPath: env.localModelPath,
    wasmPaths: env.backends.onnx.wasm.wasmPaths,
    platform: Capacitor.getPlatform(),
    numThreads: env.backends.onnx.wasm.numThreads,
    simd: env.backends.onnx.wasm.simd,
    proxy: env.backends.onnx.wasm.proxy,
})}`);

// Singleton instances (lazy loaded)
let tokenizer: any = null;
let textModel: any = null;

// Loading states
let isTextModelLoaded = false;
let lastError: string | null = null;
let lastSuccessDetails: string | null = null;

// Model configuration - must match the folder name in public/models/
const MODEL_ID = 'clip';

/**
 * Check if required model and WASM files are reachable from the app.
 * Returns a list of file statuses for diagnostic UI display.
 */
export async function checkModelFilesExist(): Promise<{
    allPresent: boolean;
    files: Array<{ name: string; url: string; ok: boolean; size?: number; contentType?: string; error?: string }>;
}> {
    const baseUrl = getModelsBaseUrl();
    const filesToCheck = [
        { name: 'tokenizer.json', url: `${baseUrl}tokenizer.json` },
        { name: 'config.json', url: `${baseUrl}config.json` },
        { name: 'vocab.json', url: `${baseUrl}vocab.json` },
        { name: 'merges.txt', url: `${baseUrl}merges.txt` },
        { name: 'tokenizer_config.json', url: `${baseUrl}tokenizer_config.json` },
        { name: 'special_tokens_map.json', url: `${baseUrl}special_tokens_map.json` },
        { name: 'preprocessor_config.json', url: `${baseUrl}preprocessor_config.json` },
        { name: 'text_model_quantized.onnx', url: `${baseUrl}onnx/text_model_quantized.onnx` },
        { name: 'ort-wasm.wasm', url: `${baseUrl}ort-wasm.wasm` },
    ];

    const results = await Promise.all(
        filesToCheck.map(async (f) => {
            try {
                // Add a timeout for the fetch to avoid hanging in restricted networks
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 5000);

                // Use HEAD first; fall back to GET range if HEAD not allowed.
                let res = await fetch(f.url, { 
                  method: 'HEAD',
                  signal: controller.signal
                });
                
                clearTimeout(timeoutId);

                if (!res.ok && res.status === 405) {
                    const retryController = new AbortController();
                    const retryTimeoutId = setTimeout(() => retryController.abort(), 5000);
                    res = await fetch(f.url, { 
                      method: 'GET', 
                      headers: { Range: 'bytes=0-0' },
                      signal: retryController.signal
                    });
                    clearTimeout(retryTimeoutId);
                }
                if (res.ok || res.status === 206) {
                    const size = Number(res.headers.get('Content-Length') || 0) || undefined;
                    const contentType = res.headers.get('Content-Type') || undefined;
                    safeClipLog(`[FileCheck] ✅ ${f.name} (${size ?? '?'} bytes, ${contentType ?? 'unknown ct'})`);
                    return { ...f, ok: true, size, contentType };
                }
                console.warn(`[CLIP][FileCheck] ❌ ${f.name} HTTP ${res.status}`);
                return { ...f, ok: false, error: `HTTP ${res.status}` };
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                console.warn(`[CLIP][FileCheck] ❌ ${f.name} ${msg}`);
                return { ...f, ok: false, error: msg };
            }
        })
    );

    const allPresent = results.every((r) => r.ok);
    safeClipLog(`[FileCheck] ${allPresent ? '✅ All files present' : '❌ Some files missing'} (${results.filter(r => r.ok).length}/${results.length})`);
    return { allPresent, files: results };
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
 * Load the model from the local bundle with aggressive error catching
 */
async function loadTextModel(): Promise<void> {
  if (isTextModelLoaded && tokenizer && textModel) {
    return Promise.resolve();
  }

  const start = Date.now();
  lastError = null;
  
  safeClipLog(`Loading TEXT model from: ${env.localModelPath}${MODEL_ID}`);
  safeClipLog(`Platform: ${Capacitor.getPlatform()}, Native: ${Capacitor.isNativePlatform()}`);
  safeClipLog(`window.location.origin: ${window.location.origin}`);
  safeClipLog(`env.localModelPath: ${env.localModelPath}`);
  safeClipLog(`WASM paths: ${JSON.stringify(env.backends.onnx.wasm.wasmPaths)}`);
  
  try {
    // Initialize tokenizer - this loads tokenizer.json, vocab.json, merges.txt, etc.
    safeClipLog(`Step 1/2: Loading AutoTokenizer from "${MODEL_ID}"...`);
    tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID, {
      quantized: true,
    });
    safeClipLog(`✅ Tokenizer loaded`);
    
    // Load model - this loads text_model_quantized.onnx
    safeClipLog(`Step 2/2: Loading CLIPTextModelWithProjection...`);
    textModel = await CLIPTextModelWithProjection.from_pretrained(MODEL_ID, { 
      quantized: true,
    });
    safeClipLog(`✅ Text model loaded`);
    
    isTextModelLoaded = true;
    lastError = null;
    lastSuccessDetails = `Tokenizer + CLIP text model ready (${Date.now() - start}ms). Backend: WASM (simd=${env.backends.onnx.wasm.simd}, threads=${env.backends.onnx.wasm.numThreads})`;
    safeClipLog(`TEXT model loaded successfully in ${Date.now() - start}ms ✅`);
    safeClipLog(`${lastSuccessDetails}`);
  } catch (error) {
    console.error('[CLIP] Load failed:', error);

    const errObj = error instanceof Error ? error : new Error(String(error));
    lastError = `Initialization Error: ${errObj.message}`;
    lastSuccessDetails = null;

    if (lastError.includes('buffer')) {
      lastError += "\n\nTip: This is a memory alignment issue in the WebView. We are trying to use the safest non-SIMD engine.";
    }
    if (lastError.toLowerCase().includes('fetch') || lastError.toLowerCase().includes('network')) {
      lastError += "\n\nTip: The model files couldn't be loaded. Check that the app has access to http://localhost/models/clip/";
    }

    throw error;
  }
}

let visionModel: any = null;
let isVisionModelLoaded = false;

/**
 * Load VISION model in BACKGROUND
 *
 * The vision model (~150 MB quantized) is too large to bundle in the APK
 * (Google Play caps AABs at 500 MB but downloading at install time is
 * still slow). Instead, we:
 *   1. Start downloading vision files in the background as soon as the
 *      app launches.
 *   2. Track progress in Capacitor Preferences so the download resumes
 *      even if the user kills the app mid-download.
 *   3. Once all files are present, load them into a `CLIPVisionModelWithProjection`.
 *   4. Expose `embedImage` / `embedImageCrop` to the rest of the app.
 */
let visionLoadPromise: Promise<void> | null = null;
async function loadVisionModelInBackground(): Promise<void> {
  if (isVisionModelLoaded && visionModel) {
    return;
  }
  if (visionLoadPromise) {
    return visionLoadPromise;
  }

  visionLoadPromise = (async () => {
    try {
      safeClipLog('[CLIP Vision] Hydrating download state...');
      await visionDownloadManager.hydrate();

      const state = visionDownloadManager.getState();
      if (state.status !== 'ready') {
        safeClipLog('[CLIP Vision] Starting/resuming background download...');
        // Don't await this; we want the user to be able to use the app
        // (and text search) while the vision model downloads.
        visionDownloadManager.startDownload().catch((e) => {
          console.warn('[CLIP Vision] Background download failed:', e);
        });

        // Poll until ready without imposing a hard timeout. On slower mobile
        // networks the download can legitimately take longer than 30 minutes,
        // and the user can keep using text search while it runs.
        while (visionDownloadManager.getState().status !== 'ready') {
          const currentState = visionDownloadManager.getState();
          if (currentState.status === 'error') {
            throw new Error(currentState.error || 'Vision model download failed');
          }
          await new Promise((r) => setTimeout(r, 1000));
        }
      }

      safeClipLog('[CLIP Vision] Files present, loading model into runtime...');

      // CRITICAL: For the vision model on Android, we need to use a special
      // URL scheme that the native Capacitor server can serve. The native
      // server intercepts `http://localhost/models/...` and tries to find
      // them in the bundled assets, which fails for downloaded files.
      //
      // `Capacitor.convertFileSrc()` returns a `_capacitor_file_/` URL that
      // the native server knows how to serve from the app's data directory.
      // We temporarily override `env.localModelPath` for the vision model load.
      const originalLocalModelPath = env.localModelPath;
      if (Capacitor.isNativePlatform()) {
        const visionBaseUrl = await getVisionModelBaseUrl();
        env.localModelPath = visionBaseUrl;
        safeClipLog(`[CLIP Vision] Using Capacitor file URL for vision model: ${visionBaseUrl}`);
      }

      const start = Date.now();
      visionModel = await CLIPVisionModelWithProjection.from_pretrained(MODEL_ID, {
        quantized: true,
      });
      
      // Restore the original localModelPath so the text model (if reloaded)
      // still works from the bundled assets.
      env.localModelPath = originalLocalModelPath;
      
      isVisionModelLoaded = true;
      safeClipLog(`[CLIP Vision] ✅ Vision model loaded in ${Date.now() - start} ms`);
    } catch (e) {
      console.error('[CLIP Vision] load failed:', e);
      // Reset so the next call tries again
      visionLoadPromise = null;
      throw e;
    }
  })();

  return visionLoadPromise;
}

/**
 * Initialize CLIP service
 * Call this when app starts - loads text model immediately, vision model in background
 */
export async function initializeClipService(): Promise<void> {
  safeClipLog('Initializing CLIP service...');

  try {
    // Step 1: Load TEXT model from local bundle
    await loadTextModel();

    // Step 2: Start the VISION model background download (non-blocking).
    // The actual loading into runtime happens later, once the download
    // is done. This call returns a promise that resolves when vision is
    // ready, but we don't await it here.
    loadVisionModelInBackground().catch((e) => {
      console.warn('[CLIP] Vision background load failed:', e);
    });

    safeClipLog('Service ready for TEXT search! (Vision downloading in background...)');
  } catch (error) {
    console.error('[CLIP] Initialization failed:', error);
    throw error instanceof Error ? error : new Error(String(error));
  }
}

/**
 * Generate IMAGE embedding from base64 image
 *
 * Waits for the vision model to finish downloading and load (the user
 * can see progress in the UI). Throws a clear error if the download
 * has not been started, has failed, or is in progress and the caller
 * wants to act immediately.
 */
export async function embedImage(base64: string): Promise<number[]> {
  // Ensure text model is loaded first
  await loadTextModel();

  // If vision is not yet ready, surface a clear status
  const state = visionDownloadManager.getState();
  if (state.status === 'not_started' || state.status === 'paused') {
    visionDownloadManager.startDownload().catch(() => {});
    throw new Error('VISION_DOWNLOADING');
  }
  if (state.status === 'downloading') {
    throw new Error('VISION_DOWNLOADING');
  }
  if (state.status === 'error') {
    throw new Error('VISION_DOWNLOAD_FAILED: ' + (state.error || 'unknown'));
  }

  // Wait for runtime load to complete
  await loadVisionModelInBackground();

  if (!visionModel) {
    throw new Error('Vision model not loaded');
  }

  safeClipLog('Generating image embedding...');
  const start = Date.now();

  try {
    const image = await RawImage.fromURL(base64);
    const { pixel_values } = await imageProcessor(image);
    const outputs = await visionModel({ pixel_values });
    const embedding = Array.from(outputs.image_embeds.data) as number[];
    const normalized = normalizeVector(embedding);
    safeClipLog(`Image embedding generated in ${Date.now() - start}ms`);
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

  safeClipLog('========== embedText called ==========');
  safeClipLog(`Input text: ${JSON.stringify(text)}`);
  safeClipLog(`Input text length: ${text.length}`);
  safeClipLog(`Input text bytes: ${new TextEncoder().encode(text).length}`);
  const inputHash = text.split('').reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0);
  safeClipLog(`Input text hash: ${inputHash}`);
  const start = Date.now();

  try {
    const inputs = await tokenizer(text, { padding: true, truncation: true });
    const tokenIds = Array.from(inputs.input_ids.data).map((x: any) => typeof x === 'bigint' ? Number(x) : x);
    safeClipLog(`Tokenized input ids (first 10): ${JSON.stringify(tokenIds.slice(0, 10))}`);
    const outputs = await textModel(inputs);
    const embedding = Array.from(outputs.text_embeds.data) as number[];
    const normalized = normalizeVector(embedding);
    
    // Log a hash of the embedding to verify it's unique
    const embHash = normalized.slice(0, 5).map(n => n.toFixed(6)).join(',');
    const embHashFull = normalized.reduce((h, n) => ((h << 5) - h + n) | 0, 0);
    safeClipLog(`Text embedding generated in ${Date.now() - start} ms`);
    safeClipLog(`Embedding first 5 values: ${embHash}`);
    safeClipLog(`Embedding full hash: ${embHashFull}`);
    safeClipLog('========================================');
    
    return normalized;
  } catch (error) {
    console.error('[CLIP] Failed to generate text embedding:', error);
    throw error;
  }
}

/**
 * Returns the current vision model status for the UI.
 */
export function getVisionStatus(): VisionState {
  return visionDownloadManager.getState();
}

/**
 * Re-export the React hook for the UI to subscribe to download state.
 */
export { useVisionDownloadState };

/**
 * Crop image from bounding box and generate embedding.
 *
 * @param base64 Original full image as a data URL.
 * @param box [xmin, ymin, xmax, ymax] in the original image's pixel space.
 */
export async function embedImageCrop(base64: string, box: number[]): Promise<number[]> {
  await loadTextModel();
  const state = visionDownloadManager.getState();
  if (state.status === 'not_started' || state.status === 'paused') {
    visionDownloadManager.startDownload().catch(() => {});
    throw new Error('VISION_DOWNLOADING');
  }
  if (state.status === 'downloading') {
    throw new Error('VISION_DOWNLOADING');
  }
  if (state.status === 'error') {
    throw new Error('VISION_DOWNLOAD_FAILED: ' + (state.error || 'unknown'));
  }
  await loadVisionModelInBackground();
  if (!visionModel) throw new Error('Vision model not loaded');

  // Crop the image client-side using a canvas
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.crossOrigin = 'anonymous';
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = base64;
  });

  const [xmin, ymin, xmax, ymax] = box;
  const w = Math.max(1, Math.round(xmax - xmin));
  const h = Math.max(1, Math.round(ymax - ymin));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not available');
  ctx.drawImage(img, xmin, ymin, w, h, 0, 0, w, h);
  const cropped = canvas.toDataURL('image/jpeg', 0.95);

  return embedImage(cropped);
}

/**
 * Image processor for the vision model.
 *
 * The transformers library's `CLIPProcessor` does the same preprocessing
 * (resize, center-crop, normalize). We use RawImage + a small processor
 * to keep the bundle small.
 */
let processorInstance: any = null;
async function imageProcessor(image: any) {
  if (!processorInstance) {
    processorInstance = await AutoProcessor.from_pretrained(MODEL_ID);
  }
  return processorInstance(image);
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
export function getClipStatus(): {
    textReady: boolean;
    visionReady: boolean;
    isDownloading: boolean;
    downloadProgress: number;
    error: string | null;
    successDetails: string | null;
} {
    const vs = visionDownloadManager.getState();
    return {
        textReady: isTextModelLoaded,
        visionReady: isVisionModelLoaded,
        isDownloading: vs.status === 'downloading',
        downloadProgress: vs.totalBytes > 0 ? Math.round((vs.bytesDownloaded / vs.totalBytes) * 100) : 0,
        error: lastError,
        successDetails: lastSuccessDetails,
    };
}
