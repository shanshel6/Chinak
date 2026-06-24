/**
 * Vision model download manager
 *
 * Downloads the CLIP VISION model files in the background to a permanent
 * location on the user's device. Resumable: if the app is killed mid-download,
 * the next launch will pick up where it left off.
 *
 * Why this exists:
 *  - The TEXT model is small (~250 MB) and bundled with the app.
 *  - The VISION model is large (~350 MB quantized) and we do NOT want to
 *    ship it inside the APK because Google Play has a 150 MB cap on APKs
 *    and a 500 MB cap on AABs. We download it on first use instead.
 *
 * Strategy:
 *  1. List all VISION files and their expected sizes.
 *  2. For each file, check if it already exists at the destination path.
 *  3. If missing or partial, download with a streaming `fetch` that
 *     appends bytes to the existing file (HTTP Range when the server
 *     supports it, otherwise full re-download).
 *  4. Persist the list of completed files to Capacitor Preferences so
 *     we never re-download a finished file.
 *  5. Save the final files under a path readable by the transformers
 *     library (we then point `env.localModelPath` at it).
 */

import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Preferences } from '@capacitor/preferences';

/**
 * Safe logging for Android WebView - explicitly converts objects to strings
 * to avoid [object Object] serialization issues across the native bridge.
 * Includes tag in the message content for Logcat filtering.
 */
export function safeLog(...args: any[]): void {
  // Always convert all arguments to strings to avoid [object Object] issues
  const stringArgs = args.map(arg => {
    if (typeof arg === 'object' && arg !== null) {
      try {
        return JSON.stringify(arg, (_key, value) => {
          if (typeof value === 'bigint') {
            return Number(value);
          }
          return value;
        });
      } catch {
        return String(arg);
      }
    }
    return String(arg);
  });
  
  // Include tag as part of the message content for Logcat filtering
  console.log('[VisionDL]', ...stringArgs);
}

/**
 * Safe logging for CLIP service with [CLIP] tag
 */
export function safeClipLog(...args: any[]): void {
  // Always convert all arguments to strings to avoid [object Object] issues
  const stringArgs = args.map(arg => {
    if (typeof arg === 'object' && arg !== null) {
      try {
        return JSON.stringify(arg, (_key, value) => {
          if (typeof value === 'bigint') {
            return Number(value);
          }
          return value;
        });
      } catch {
        return String(arg);
      }
    }
    return String(arg);
  });
  
  // Include [CLIP] tag as part of the message content
  console.log('[CLIP]', ...stringArgs);
}

const STORAGE_KEY = 'vision_model_state_v1';
const BASE_DOWNLOAD_URL = 'https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/main/';

// Local server fallback for Android emulator and corporate networks
// The Android WebView often cannot reach huggingface.co directly, so we
// host the model files on the user's own Node.js server. The emulator
// can reach the host machine via http://10.0.2.2:5001 (special IP).
// To set this up, run: node server/scripts/download-vision-models.mjs
const LOCAL_SERVER_URL = 'http://10.0.2.2:5001/api/vision-models/';

/**
 * XMLHttpRequest fallback for fetch().
 * In some Android WebView configurations, fetch() fails with a generic
 * "Failed to fetch" error even when the network is available. XHR
 * often works in these cases.
 */
function fetchWithXHR(
  url: string,
  signal: AbortSignal,
  timeoutMs: number,
  headers: Record<string, string> = {},
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let timedOut = false;
    
    const timer = setTimeout(() => {
      timedOut = true;
      xhr.abort();
      reject(new Error(`XHR timeout after ${timeoutMs}ms`));
    }, timeoutMs);
    
    xhr.onload = () => {
      clearTimeout(timer);
      if (timedOut) return;
      
      // Build a Response-like object from the XHR
      const response = new Response(xhr.response, {
        status: xhr.status,
        statusText: xhr.statusText,
        headers: new Headers(),
      });
      resolve(response);
    };
    
    xhr.onerror = () => {
      clearTimeout(timer);
      if (timedOut) return;
      reject(new Error(`XHR network error: status ${xhr.status}`));
    };
    
    xhr.onabort = () => {
      clearTimeout(timer);
      if (timedOut) return;
      reject(new DOMException('Aborted', 'AbortError'));
    };
    
    if (signal) {
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        xhr.abort();
        reject(new DOMException('Aborted', 'AbortError'));
      });
    }
    
    xhr.open('GET', url, true);
    xhr.responseType = 'arraybuffer';
    Object.entries(headers).forEach(([key, value]) => {
      xhr.setRequestHeader(key, value);
    });
    // NOTE: Do NOT set User-Agent header here. It is an "unsafe header"
    // and most WebViews will block the request if you try to set it.
    // CDNs like Hugging Face will see the default WebView User-Agent.
    xhr.send();
  });
}

// List of vision files we need. Sizes are in bytes (approximate; we
// just use them for progress reporting — the real size comes from
// Content-Length / the size of the on-disk file).
interface VisionFileSpec {
  /** Filename as it lives on disk and on HuggingFace */
  name: string;
  /** Remote path relative to BASE_DOWNLOAD_URL (may differ from local name if in subfolder) */
  remotePath: string;
  /** Display label for the UI */
  label: string;
  /** Approximate size in bytes for progress bar only */
  approxBytes: number;
}

const VISION_FILES: VisionFileSpec[] = [
  { name: 'preprocessor_config.json', remotePath: 'preprocessor_config.json', label: 'Preprocess config', approxBytes: 600 },
  { name: 'config.json', remotePath: 'config.json', label: 'Config', approxBytes: 4_500 },
  { name: 'onnx/vision_model_quantized.onnx', remotePath: 'onnx/vision_model_quantized.onnx', label: 'Vision model', approxBytes: 89_117_001 },
];

// Minimum file sizes for validation (config files can be small)
const MIN_FILE_SIZES: Record<string, number> = {
  'onnx/vision_model_quantized.onnx': 1024, // At least 1KB for the main model
  'preprocessor_config.json': 100,     // Config files can be very small
  'config.json': 100,
};

export type VisionStatus =
  | 'not_started'
  | 'downloading'
  | 'paused'
  | 'ready'
  | 'error';

export interface VisionState {
  status: VisionStatus;
  /** Bytes downloaded so far (sum across all files) */
  bytesDownloaded: number;
  /** Total bytes to download */
  totalBytes: number;
  /** File currently being downloaded, or null */
  currentFile: string | null;
  /** Per-file completed map (persisted) */
  completedFiles: Record<string, boolean>;
  /** Last error, if any */
  error: string | null;
  /** When the download started (ms) */
  startedAt: number | null;
  /** When the download finished (ms) */
  finishedAt: number | null;
  /** Files that failed to download and need retry */
  failedFiles: Record<string, {
    /** Number of retry attempts made */
    retryCount: number;
    /** Timestamp of last failure (ms) */
    lastFailedAt: number;
    /** Error message from last failure */
    lastError: string;
    /** Next retry timestamp (ms) - calculated with exponential backoff */
    nextRetryAt: number;
  }>;
  /** Whether background retry is enabled */
  backgroundRetryEnabled: boolean;
  /** Maximum number of retry attempts per file */
  maxRetryAttempts: number;
  /** Base retry delay in milliseconds */
  baseRetryDelayMs: number;
  /** Maximum retry delay in milliseconds */
  maxRetryDelayMs: number;
}

const INITIAL_STATE: VisionState = {
  status: 'not_started',
  bytesDownloaded: 0,
  totalBytes: 0,
  currentFile: null,
  completedFiles: {},
  error: null,
  startedAt: null,
  finishedAt: null,
  failedFiles: {},
  backgroundRetryEnabled: true,
  maxRetryAttempts: 10,
  baseRetryDelayMs: 1000,
  maxRetryDelayMs: 300000, // 5 minutes
};

type Listener = (state: VisionState) => void;

class VisionDownloadManager {
  private state: VisionState = { ...INITIAL_STATE };
  private listeners: Set<Listener> = new Set();
  private abortController: AbortController | null = null;
  private saveInFlight: Promise<void> = Promise.resolve();
  private hydrated = false;
  private hydratedPromise: Promise<void> | null = null;
  private retryTimeoutId: number | null = null;

  /**
   * Read state from disk + Preferences.
   * Computes current bytesDownloaded by summing the size of every
   * completed file in the VISION directory.
   */
  async hydrate(): Promise<void> {
    if (this.hydrated) return;
    if (this.hydratedPromise) return this.hydratedPromise;
    this.hydratedPromise = (async () => {
      try {
        safeLog('Hydrating state from Preferences...');
        const { value } = await Preferences.get({ key: STORAGE_KEY });
        if (value) {
          try {
            const parsed = JSON.parse(value);
            this.state = { ...INITIAL_STATE, ...parsed };
            safeLog(`Loaded state: ${this.state.status}`);
          } catch {
            this.state = { ...INITIAL_STATE };
            safeLog('No saved state, using initial');
          }
        } else {
          this.state = { ...INITIAL_STATE };
          safeLog('No saved state, using initial');
        }

        // MIGRATION: Clear old completedFiles that used the misspelled filename
        // "preprocess_config.json" → now "preprocessor_config.json"
        // If the old file existed, delete it so the correct one gets downloaded fresh.
        const oldKeys = Object.keys(this.state.completedFiles);
        for (const oldKey of oldKeys) {
          const stillValid = VISION_FILES.some((f) => f.name === oldKey);
          if (!stillValid) {
            delete this.state.completedFiles[oldKey];
            // Also delete the stale file from disk
            if (Capacitor.isNativePlatform()) {
              try {
                await Filesystem.deleteFile({
                  path: `models/clip/${oldKey}`,
                  directory: Directory.Data,
                });
              } catch {
                // ignore
              }
            }
          }
        }

        // MIGRATION: Clear old failedFiles that are no longer valid
        const oldFailedKeys = Object.keys(this.state.failedFiles || {});
        for (const oldKey of oldFailedKeys) {
          const stillValid = VISION_FILES.some((f) => f.name === oldKey);
          if (!stillValid) {
            delete this.state.failedFiles[oldKey];
          }
        }

        this.state.totalBytes = VISION_FILES.reduce((a, f) => a + f.approxBytes, 0);

        // Verify which "completed" files actually exist on disk
        // AND validate their size — delete corrupted partial files
        const verified: Record<string, boolean> = {};
        let verifiedBytes = 0;
        for (const file of VISION_FILES) {
          const info = await this.fileSizeInfo(file.name);
          safeLog(`File ${file.name} size info:`, info);
          if (info !== null && info > 0) {
            // Validate: file must be at least 80% of expected size
            // This catches corrupted/stale partial files from failed downloads
            if (info < file.approxBytes * 0.8) {
              console.warn(`[VisionDL] File ${file.name} is too small (${info} bytes, expected ~${file.approxBytes}), deleting and re-downloading`);
              try {
                await Filesystem.deleteFile({
                  path: `models/clip/${file.name}`,
                  directory: Directory.Data,
                });
              } catch { /* ignore */ }
              continue;
            }
            verified[file.name] = true;
            verifiedBytes += file.approxBytes;
          }
        }
        this.state.completedFiles = verified;
        this.state.bytesDownloaded = verifiedBytes;

        safeLog(`Verified files: ${Object.keys(verified).length}/${VISION_FILES.length}`);
        safeLog(`Current status: ${this.state.status}`);

        // If everything is downloaded, mark ready
        if (Object.keys(verified).length === VISION_FILES.length) {
          this.state.status = 'ready';
          this.state.currentFile = null;
          if (!this.state.finishedAt) this.state.finishedAt = Date.now();
          safeLog('All files verified, marking as ready');
        } else if (this.state.status === 'ready') {
          // Edge case: state says ready but some files are missing
          this.state.status = 'paused';
          safeLog('State was ready but files missing, changing to paused');
        }

        this.notify();
      } catch (e) {
        console.warn('[VisionDL] hydrate failed:', e);
      } finally {
        this.hydrated = true;
      }
    })();
    return this.hydratedPromise;
  }

  getState(): VisionState {
    return { ...this.state };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    const snapshot = this.getState();
    this.listeners.forEach((l) => {
      try {
        l(snapshot);
      } catch (e) {
        console.warn('[VisionDL] listener error:', e);
      }
    });
  }

  private async persist(): Promise<void> {
    // Serialize writes to avoid corrupting Preferences
    this.saveInFlight = this.saveInFlight.then(async () => {
      try {
        const stateStr = JSON.stringify(this.state);
        await Preferences.set({
          key: STORAGE_KEY,
          value: stateStr,
        });
        safeLog(`State persisted: ${this.state.status}`);
      } catch (e) {
        console.warn('[VisionDL] persist failed:', e);
      }
    });
    return this.saveInFlight;
  }

  /**
   * Get the size of a file in the vision directory, or null if it doesn't exist.
   */
  private async fileSizeInfo(name: string): Promise<number | null> {
    if (Capacitor.isNativePlatform()) {
      try {
        const path = `models/clip/${name}`;
        const res = await Filesystem.stat({ path, directory: Directory.Data });
        if (res && typeof res.size === 'number' && res.size > 0) {
          return res.size;
        }
        return null;
      } catch {
        return null;
      }
    } else {
      // Web fallback: we can't write to filesystem; rely on Preferences
      return !!this.state.completedFiles?.[name] ? 1 : null;
    }
  }

  /**
   * Calculate exponential backoff delay for retry attempts
   */
  private calculateRetryDelay(retryCount: number): number {
    const delay = this.state.baseRetryDelayMs * Math.pow(2, retryCount);
    return Math.min(delay, this.state.maxRetryDelayMs);
  }

  /**
   * Mark a file as failed and schedule retry
   */
  private markFileAsFailed(fileName: string, error: Error): void {
    const now = Date.now();
    const retryCount = this.state.failedFiles[fileName]?.retryCount || 0;
    const nextRetryDelay = this.calculateRetryDelay(retryCount);
    
    this.state.failedFiles[fileName] = {
      retryCount: retryCount + 1,
      lastFailedAt: now,
      lastError: error.message,
      nextRetryAt: now + nextRetryDelay,
    };

    safeLog(`File ${fileName} marked as failed (attempt ${retryCount + 1}/${this.state.maxRetryAttempts})`, {
      error: error.message,
      nextRetryInMs: nextRetryDelay,
      nextRetryAt: new Date(now + nextRetryDelay).toISOString(),
    });
  }

  /**
   * Remove a file from failed files list (when successfully downloaded)
   */
  private removeFileFromFailed(fileName: string): void {
    if (this.state.failedFiles[fileName]) {
      delete this.state.failedFiles[fileName];
      safeLog(`File ${fileName} removed from failed files list`);
    }
  }

  /**
   * Check if a file should be retried now
   */
  private shouldRetryFile(fileName: string): boolean {
    const failedFile = this.state.failedFiles[fileName];
    if (!failedFile) return false;
    
    const now = Date.now();
    const shouldRetry = now >= failedFile.nextRetryAt && 
                       failedFile.retryCount < this.state.maxRetryAttempts;
    
    if (shouldRetry) {
      safeLog(`File ${fileName} ready for retry (attempt ${failedFile.retryCount + 1}/${this.state.maxRetryAttempts})`);
    }
    
    return shouldRetry;
  }

  /**
   * Get list of files that need retry now
   */
  private getFilesNeedingRetry(): string[] {
    return Object.keys(this.state.failedFiles).filter(fileName => 
      this.shouldRetryFile(fileName)
    );
  }

  /**
   * Check if any files need retry
   */
  private hasFilesNeedingRetry(): boolean {
    return this.getFilesNeedingRetry().length > 0;
  }

  /**
   * Returns the local path that the transformers library should read from.
   * For native: a `http://localhost` URL served by Capacitor's local server
   *             doesn't work for files we wrote ourselves, so we point at the
   *             `Directory.Data` path which the transformers library can read
   *             through `file://` on Android WebView.
   * For web: returns a virtual `idb://` style path handled by the transformers
   *          IndexedDB cache.
   */
  async getLocalModelPath(): Promise<string> {
    if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') {
      // Make sure the directory structure exists
      try {
        await Filesystem.mkdir({
          path: 'models/clip/onnx',
          directory: Directory.Data,
          recursive: true,
        });
      } catch {
        // Directory probably already exists
      }
      // The transformers library resolves files as `<localModelPath>/<FILE_NAME>`.
      // On Android the file:// scheme works inside the WebView.
      // We construct a base path that the library can use to fetch the file.
      // We override `localModelPath` with a per-file path, so this is unused.
      return '';
    }
    // Web: use the default transformers cache
    return '/models/';
  }

  /**
   * Begin (or resume) the background download.
   * Safe to call multiple times — if a download is already running this
   * returns the existing promise.
   */
  startDownload(): Promise<void> {
    safeLog('startDownload called, current status:', this.state.status);
    if (this.state.status === 'downloading') {
      safeLog('Download already in progress, returning');
      return Promise.resolve();
    }
    if (this.state.status === 'ready') {
      safeLog('Download already complete, returning');
      return Promise.resolve();
    }
    safeLog('Starting new download');
    return this.runDownload();
  }

  /**
   * Schedule background retry for failed files
   */
  private scheduleBackgroundRetry(): void {
    if (!this.state.backgroundRetryEnabled) {
      safeLog('Background retry disabled, not scheduling retry');
      return;
    }

    const filesNeedingRetry = this.getFilesNeedingRetry();
    if (filesNeedingRetry.length === 0) {
      safeLog('No files need retry at this time');
      return;
    }

    // Find the earliest retry time
    const now = Date.now();
    let earliestRetryTime = Infinity;
    
    for (const fileName of filesNeedingRetry) {
      const failedFile = this.state.failedFiles[fileName];
      if (failedFile && failedFile.nextRetryAt < earliestRetryTime) {
        earliestRetryTime = failedFile.nextRetryAt;
      }
    }

    if (earliestRetryTime === Infinity) {
      safeLog('No valid retry times found');
      return;
    }

    const delayMs = Math.max(0, earliestRetryTime - now);
    
    safeLog(`Scheduling background retry in ${delayMs}ms for ${filesNeedingRetry.length} file(s):`, filesNeedingRetry);

    // Clear any existing timeout
    if (this.retryTimeoutId) {
      clearTimeout(this.retryTimeoutId);
    }

    this.retryTimeoutId = setTimeout(() => {
      safeLog('Background retry timer fired, checking network and retrying...');
      this.retryFailedFilesInBackground();
    }, delayMs);
  }

  /**
   * Retry failed files in background
   */
  private async retryFailedFilesInBackground(): Promise<void> {
    if (!this.state.backgroundRetryEnabled) {
      safeLog('Background retry disabled, skipping');
      return;
    }

    const filesToRetry = this.getFilesNeedingRetry();
    if (filesToRetry.length === 0) {
      safeLog('No files need retry at this time');
      return;
    }

    safeLog(`Starting background retry for ${filesToRetry.length} file(s):`, filesToRetry);

    // Don't start if already downloading
    if (this.state.status === 'downloading') {
      safeLog('Download already in progress, skipping background retry');
      return;
    }

    // Start download which will handle retry logic
    this.startDownload().catch(e => {
      console.warn('[VisionDL] Background retry failed:', e);
    });
  }

  /**
   * Convenience helper used at app boot. Hydrates state from disk and
   * kicks off the download in the background if it has never finished.
   * Also checks for failed files that need retry.
   * Never throws. Safe to call before any React component is mounted.
   */
  async ensureDownloadStarted(): Promise<void> {
    safeLog('🚀 ensureDownloadStarted called');
    try {
      await this.hydrate();
      const s = this.getState();
      safeLog('  Current status:', s.status);
      safeLog('  Completed files:', Object.keys(s.completedFiles).length);
      safeLog('  Failed files:', Object.keys(s.failedFiles).length);
      safeLog('  Bytes downloaded:', s.bytesDownloaded, '/', s.totalBytes);
      
      // Check if there are failed files that need retry
      const hasFailedFiles = Object.keys(s.failedFiles).length > 0;
      const hasFilesNeedingRetry = this.hasFilesNeedingRetry();
      
      if (hasFailedFiles) {
        safeLog(`  Found ${Object.keys(s.failedFiles).length} failed file(s)`);
        if (hasFilesNeedingRetry) {
          safeLog(`  ${this.getFilesNeedingRetry().length} file(s) ready for retry`);
        }
      }
      
      if (s.status === 'not_started' || s.status === 'paused' || s.status === 'error') {
        safeLog('  Starting/Resuming download...');
        this.startDownload().catch((e) => {
          console.warn('[VisionDL] ❌ auto-start failed:', e);
        });
      } else if (s.status === 'ready') {
        safeLog('  Download already complete, nothing to do.');
      } else if (s.status === 'downloading') {
        safeLog('  Download already in progress.');
      }
      
      // Schedule background retry if needed
      if (hasFilesNeedingRetry && s.status !== 'downloading') {
        safeLog('  Scheduling background retry for failed files');
        this.scheduleBackgroundRetry();
      }
    } catch (e) {
      console.warn('[VisionDL] ❌ ensureDownloadStarted failed:', e);
    }
  }

  /**
   * True when the vision model is either currently downloading or
   * paused mid-download. Used by the UI to decide whether to show the
   * "search by text instead" affordance.
   */
  isVisionBusy(): boolean {
    return this.state.status === 'downloading'
      || this.state.status === 'not_started'
      || this.state.status === 'paused';
  }

  pause(): void {
    if (this.state.status === 'downloading') {
      this.state.status = 'paused';
      if (this.abortController) {
        this.abortController.abort();
        this.abortController = null;
      }
      
      // Clear any pending retry timeout when manually paused
      if (this.retryTimeoutId) {
        clearTimeout(this.retryTimeoutId);
        this.retryTimeoutId = null;
      }
      
      this.notify();
      this.persist();
    }
  }

  /**
   * Delete all downloaded vision files and reset state.
   */
  async reset(): Promise<void> {
    this.pause();
    
    // Clear any pending retry timeout
    if (this.retryTimeoutId) {
      clearTimeout(this.retryTimeoutId);
      this.retryTimeoutId = null;
    }
    
    if (Capacitor.isNativePlatform()) {
      for (const file of VISION_FILES) {
        try {
          await Filesystem.deleteFile({
            path: `models/clip/${file.name}`,
            directory: Directory.Data,
          });
        } catch {
          // File probably didn't exist
        }
      }
      try {
        await Filesystem.rmdir({ path: 'models/clip', directory: Directory.Data, recursive: true });
      } catch {
        // ignore
      }
    }
    this.state = { ...INITIAL_STATE };
    this.state.totalBytes = VISION_FILES.reduce((a, f) => a + f.approxBytes, 0);
    this.notify();
    await this.persist();
  }

  private async runDownload(): Promise<void> {
    this.state.status = 'downloading';
    this.state.error = null;
    if (!this.state.startedAt) this.state.startedAt = Date.now();
    this.notify();
    await this.persist();

    // Ensure directory exists
    if (Capacitor.isNativePlatform()) {
      try {
        await Filesystem.mkdir({
          path: 'models/clip/onnx',
          directory: Directory.Data,
          recursive: true,
        });
      } catch {
        // already exists
      }
    }

    // Get files to download: incomplete files + files needing retry
    const filesToDownload = VISION_FILES.filter(file => {
      if (this.state.completedFiles[file.name]) {
        return false;
      }
      return true;
    });

    // Sort files: retry files first, then others
    filesToDownload.sort((a, b) => {
      const aNeedsRetry = this.state.failedFiles[a.name] ? 1 : 0;
      const bNeedsRetry = this.state.failedFiles[b.name] ? 1 : 0;
      return bNeedsRetry - aNeedsRetry;
    });

    for (const file of filesToDownload) {
      if (this.state.status !== 'downloading') {
        // Paused or aborted
        return;
      }
      
      this.state.currentFile = file.name;
      this.notify();

      try {
        await this.downloadFile(file);
        this.state.completedFiles[file.name] = true;
        this.removeFileFromFailed(file.name);
        await this.persist();
      } catch (e: any) {
        const status = this.state.status as VisionStatus;
        if (e?.name === 'AbortError' || status === 'paused' || status === 'not_started') {
          // User paused; keep partial file for next resume
          return;
        }
        
        // Mark file as failed for background retry
        this.markFileAsFailed(file.name, e);
        
        // Update error state but don't stop the download process
        this.state.error = e?.message || String(e);
        this.state.currentFile = null;
        this.notify();
        await this.persist();
        
        // Continue with next file instead of returning
        continue;
      }
    }

    // Check if all files are completed
    const allCompleted = VISION_FILES.every(file => this.state.completedFiles[file.name]);
    
    if (allCompleted) {
      // All files done
      this.state.status = 'ready';
      this.state.currentFile = null;
      this.state.finishedAt = Date.now();
      this.state.bytesDownloaded = this.state.totalBytes;
      this.state.error = null;
      safeLog('✅ All vision model files downloaded successfully');
    } else if (this.hasFilesNeedingRetry()) {
      // Some files failed but can be retried
      this.state.status = 'paused';
      this.state.currentFile = null;
      safeLog('⚠️ Some files failed, will retry in background');
      
      // Schedule background retry
      this.scheduleBackgroundRetry();
    } else {
      // All retry attempts exhausted
      this.state.status = 'error';
      this.state.currentFile = null;
      safeLog('❌ Download failed with no more retry attempts');
    }
    
    this.notify();
    await this.persist();
  }

  private async downloadFile(file: VisionFileSpec): Promise<void> {
    safeLog(`downloadFile called for: ${file.name}`);
    
    // On Android, try the local server first (emulator → host via 10.0.2.2)
    // because huggingface.co is often unreachable from the Android WebView.
    // If the local server doesn't have the file, fall back to Hugging Face.
    const isAndroid = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
    safeLog(`Platform: ${Capacitor.getPlatform()}, isAndroid: ${isAndroid}`);
    
    // For the local server, we use just the basename because that's how
    // the download-vision-models.mjs script saves them.
    const fileName = file.name.split('/').pop();
    const localUrl = LOCAL_SERVER_URL + fileName;
    const remoteUrl = BASE_DOWNLOAD_URL + file.remotePath;
    
    safeLog(`Local URL: ${localUrl}`);
    safeLog(`Remote URL: ${remoteUrl}`);
    
    this.abortController = new AbortController();

    if (!Capacitor.isNativePlatform()) {
      // Web: just mark as completed
      safeLog(`Web platform, marking ${file.name} as completed`);
      this.state.completedFiles[file.name] = true;
      this.state.bytesDownloaded += file.approxBytes;
      this.notify();
      return;
    }

    // Retry loop for transient fetch failures
    const MAX_RETRIES = 3;
    const CONNECT_TIMEOUT_MS = 60_000;
    const READ_STALL_TIMEOUT_MS = 60_000;
    const FLUSH_CHUNK_BYTES = 1024 * 1024;
    let lastError: Error | null = null;
    let response: Response | null = null;
    let existingBytes = await this.fileSizeInfo(file.name) ?? 0;
    safeLog(`Existing bytes for ${file.name}: ${existingBytes}`);
    
    const canResume = file.name.endsWith('.onnx') && existingBytes > 0;
    let requestHeaders: Record<string, string> = {};
    if (canResume) {
      requestHeaders = { Range: `bytes=${existingBytes}-` };
      safeLog(`Resuming ${file.name} from byte ${existingBytes}`);
    } else if (existingBytes > 0) {
      safeLog(`File ${file.name} exists but not resumable, deleting`);
      try {
        await Filesystem.deleteFile({
          path: `models/clip/${file.name}`,
          directory: Directory.Data,
        });
      } catch {
        // ignore
      }
      existingBytes = 0;
    }

    // Build list of URLs to try (local first on Android, then remote)
    const urlsToTry = isAndroid ? [localUrl, remoteUrl] : [remoteUrl];
    safeLog(`URLs to try:`, urlsToTry);
    
    for (const url of urlsToTry) {
      safeLog(`Trying URL: ${url}`);
      
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          safeLog(`Attempt ${attempt}/${MAX_RETRIES} for ${url}`);
          const connectTimeout = setTimeout(() => {
            console.warn(`[VisionDL] Connect timeout after ${CONNECT_TIMEOUT_MS}ms for ${url}`);
            if (this.abortController) this.abortController.abort();
          }, CONNECT_TIMEOUT_MS);

          try {
            // NOTE: Do NOT set custom headers like User-Agent here for the
            // local server, as it can trigger CORS preflight failures (status 0).
            safeLog(`Fetching ${url} with headers:`, requestHeaders);
            response = await fetch(url, {
              signal: this.abortController.signal,
              method: 'GET',
              headers: requestHeaders,
            });
            
            safeLog(`Fetch response status: ${response.status} ${response.statusText}`);
            safeLog(`Response headers:`, Object.fromEntries(response.headers.entries()));
            
            if (!response.ok) {
              throw new Error(`HTTP ${response.status}`);
            }
          } catch (fetchErr) {
            // Try XHR fallback
            console.warn(`[VisionDL] fetch() failed for ${url}, trying XMLHttpRequest fallback...`);
            try {
              response = await fetchWithXHR(url, this.abortController.signal, 5 * 60 * 1000, requestHeaders);
              if (response.ok) {
                safeLog(`✅ XHR fallback succeeded for ${file.name}`);
              }
            } catch (xhrErr) {
              const xhrMsg = xhrErr instanceof Error ? xhrErr.message : String(xhrErr);
              console.warn(`[VisionDL] XHR fallback also failed for ${url}: ${xhrMsg}`);
              throw fetchErr;
            }
          } finally {
            clearTimeout(connectTimeout);
          }

          if (requestHeaders.Range && response.status === 200) {
            console.warn(`[VisionDL] Server ignored range request for ${file.name}; restarting from zero`);
            try {
              await Filesystem.deleteFile({
                path: `models/clip/${file.name}`,
                directory: Directory.Data,
              });
            } catch {
              // ignore
            }
            existingBytes = 0;
            requestHeaders = {};
            response = null;
            continue;
          }

          if (response.ok) {
            safeLog(`✅ ${file.name} download started from ${new URL(url).origin} (HTTP ${response.status})`);
            safeLog(`Content-Length header: ${response.headers.get('Content-Length')}`);
            break; // success - exit retry loop
          }

          lastError = new Error(`HTTP ${response.status} for ${file.name}`);
          console.warn(`[VisionDL] Attempt ${attempt}/${MAX_RETRIES} failed: ${lastError.message}`);
          if (attempt < MAX_RETRIES) {
            safeLog(`Waiting ${2000 * attempt}ms before retry`);
            await new Promise((r) => setTimeout(r, 2000 * attempt));
          }
        } catch (e: any) {
          lastError = e instanceof Error ? e : new Error(String(e));
          const errMsg = lastError.message;
          console.warn(`[VisionDL] Attempt ${attempt}/${MAX_RETRIES} failed for ${url}: ${errMsg}`);
          
          if (e?.name === 'AbortError') {
            safeLog(`AbortError, attempt ${attempt}`);
            if (attempt < MAX_RETRIES) {
              this.abortController = new AbortController();
              await new Promise((r) => setTimeout(r, 2000 * attempt));
              continue;
            }
          } else if (attempt < MAX_RETRIES) {
            safeLog(`Non-AbortError, waiting ${2000 * attempt}ms before retry`);
            await new Promise((r) => setTimeout(r, 2000 * attempt));
          }
        }
      }
      
      // If we got a successful response, stop trying other URLs
      if (response && response.ok) {
        safeLog(`Successfully got response from ${url}`);
        break;
      }
      
      // Otherwise, log and try the next URL
      console.warn(`[VisionDL] All attempts for ${url} failed, trying next URL...`);
    }

    if (!response || !response.ok) {
      throw lastError || new Error(`Failed to fetch ${file.name} after ${MAX_RETRIES} attempts`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body for ' + file.name);
    }

    let downloadedBytes = existingBytes;
    let pendingChunks: Uint8Array[] = [];
    let pendingBytes = 0;
    let fileInitialized = existingBytes > 0;

    const flushPendingBytes = async () => {
      if (pendingBytes === 0) return;

      const chunk = new Uint8Array(pendingBytes);
      let offset = 0;
      for (const part of pendingChunks) {
        chunk.set(part, offset);
        offset += part.length;
      }

      const data = bytesToBase64(chunk);
      if (!fileInitialized) {
        await Filesystem.writeFile({
          path: `models/clip/${file.name}`,
          directory: Directory.Data,
          data,
          recursive: true,
        });
        fileInitialized = true;
      } else {
        await Filesystem.appendFile({
          path: `models/clip/${file.name}`,
          directory: Directory.Data,
          data,
        });
      }

      pendingChunks = [];
      pendingBytes = 0;
    };

    safeLog(`Starting to read response body for ${file.name}`);
    let chunkCount = 0;
    while (true) {
      safeLog(`Reading chunk ${chunkCount + 1} for ${file.name}`);
      const { done, value } = await readWithTimeout(
        reader.read(),
        READ_STALL_TIMEOUT_MS,
        () => {
          console.warn(`[VisionDL] Read timeout for ${file.name}, aborting`);
          this.abortController?.abort();
        },
      );
      if (done) {
        safeLog(`Read stream done for ${file.name}`);
        break;
      }
      if (value) {
        chunkCount++;
        pendingChunks.push(value);
        pendingBytes += value.length;
        downloadedBytes += value.length;

        if (chunkCount % 10 === 0) {
          safeLog(`${file.name}: downloaded ${downloadedBytes} bytes (${chunkCount} chunks)`);
        }

        if (pendingBytes >= FLUSH_CHUNK_BYTES) {
          safeLog(`Flushing ${pendingBytes} bytes to disk for ${file.name}`);
          await flushPendingBytes();
        }

        // Update progress
        this.state.bytesDownloaded = Object.entries(this.state.completedFiles).reduce(
          (acc, [name, done]) => acc + (done ? VISION_FILES.find((f) => f.name === name)?.approxBytes || 0 : 0),
          0
        ) + downloadedBytes;
        this.notify();
      }
    }

    safeLog(`Finished reading ${file.name}, flushing remaining ${pendingBytes} bytes`);
    await flushPendingBytes();
    safeLog(`File ${file.name} download complete, total bytes: ${downloadedBytes}`);

    // Verify the file size makes sense (use file-specific minimums)
    try {
      const stat = await Filesystem.stat({
        path: `models/clip/${file.name}`,
        directory: Directory.Data,
      });
      const minSize = MIN_FILE_SIZES[file.name] || 1024;
      if (!stat.size || stat.size < minSize) {
        throw new Error(`Downloaded file ${file.name} is too small (${stat.size} bytes, expected at least ${minSize})`);
      }
    } catch (e) {
      throw e;
    }
  }
}

// --- Base64 helpers -----------------------------------------------------

async function readWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout: () => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      try {
        onTimeout();
      } catch {
        // ignore timeout cleanup errors
      }
      reject(new Error(`Download stalled for ${timeoutMs}ms`));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

function bytesToBase64(bytes: Uint8Array): string {
  // Chunked conversion to avoid call-stack overflow on large arrays
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const sub = bytes.subarray(i, i + CHUNK);
    binary += String.fromCharCode.apply(null, Array.from(sub) as number[]);
  }
  // eslint-disable-next-line no-undef
  return btoa(binary);
}

// --- Singleton ---------------------------------------------------------

export const visionDownloadManager = new VisionDownloadManager();

// --- React hook --------------------------------------------------------

import { useEffect, useState } from 'react';

export function useVisionDownloadState(): VisionState {
  const [state, setState] = useState<VisionState>(() => visionDownloadManager.getState());

  useEffect(() => {
    let mounted = true;
    visionDownloadManager.hydrate().then(() => {
      if (mounted) setState(visionDownloadManager.getState());
    });
    const unsubscribe = visionDownloadManager.subscribe((s) => {
      if (mounted) setState(s);
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  return state;
}
