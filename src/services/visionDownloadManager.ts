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
  // Promise for a download actually running in THIS app session. A persisted
  // status of 'downloading' can be stale (app killed mid-download), so we must
  // track the real in-process run separately to avoid a "stuck downloading"
  // deadlock where startDownload() refuses to start because of stale state.
  private activeDownload: Promise<void> | null = null;

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
            // Validate file size before trusting it as "complete".
            //
            // The big ONNX model MUST be essentially complete: a truncated
            // download (e.g. a network error mid-transfer) still leaves a large
            // partial file, but loading it fails with "protobuf parsing failed /
            // Can't create a session". approxBytes for the model is the real
            // Content-Length, so require >= 99.5% of it. Config files are tiny
            // and their approxBytes is only a rough estimate, so just require a
            // small non-trivial minimum.
            const isModel = file.name.endsWith('.onnx');
            const minBytes = isModel
              ? Math.floor(file.approxBytes * 0.995)
              : (MIN_FILE_SIZES[file.name] ?? 100);
            if (info < minBytes) {
              console.warn(`[VisionDL] File ${file.name} incomplete (${info} bytes, need >= ${minBytes}), deleting and re-downloading`);
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
   * Begin (or resume) the background download.
   * Safe to call multiple times — if a download is already running this
   * returns the existing promise.
   */
  startDownload(): Promise<void> {
    safeLog('startDownload called, current status:', this.state.status);
    // Only short-circuit if a download is genuinely running in THIS session.
    if (this.activeDownload) {
      safeLog('Download already in progress (in-process), returning existing promise');
      return this.activeDownload;
    }
    if (this.state.status === 'ready') {
      safeLog('Download already complete, returning');
      return Promise.resolve();
    }
    // A persisted 'downloading' status may be stale (app was killed mid-run),
    // so we do NOT treat it as an active download — start a fresh run.
    safeLog('Starting new download');
    this.activeDownload = this.runDownload().finally(() => {
      this.activeDownload = null;
    });
    return this.activeDownload;
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

    // Don't start if a download is genuinely running in this session
    if (this.activeDownload) {
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

    // ---- PRIMARY: native download straight to disk -------------------------
    // Filesystem.downloadFile uses the OS HTTP stack (not the WebView), which
    // avoids the `fetch()`/XHR "status 0 / Failed to fetch" failures we hit on
    // Android, and streams the ~89MB model to disk without buffering it in JS.
    // HuggingFace is the real source for customers; the local dev server
    // (10.0.2.2) only works when a dev server is running, so we try it last.
    {
      const destPath = `models/clip/${file.name}`;
      const minSize = MIN_FILE_SIZES[file.name] || 1024;
      const isModel = file.name.endsWith('.onnx');
      const nativeUrls = isAndroid ? [remoteUrl, localUrl] : [remoteUrl];
      for (const u of nativeUrls) {
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            safeLog(`[native] downloading ${file.name} from ${new URL(u).origin} (attempt ${attempt}/3)`);
            this.state.currentFile = file.name;
            this.notify();
            try { await Filesystem.deleteFile({ path: destPath, directory: Directory.Data }); } catch { /* no stale file */ }
            // Filesystem.downloadFile has no built-in timeout, so a stalled
            // network can hang it forever ("loading forever"). Race it against
            // a timeout so a stall throws and we retry / fall back instead.
            const dlTimeoutMs = isModel ? 240000 : 30000;
            await Promise.race([
              Filesystem.downloadFile({
                url: u,
                path: destPath,
                directory: Directory.Data,
                recursive: true,
                headers: {
                  'User-Agent':
                    'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
                },
              }),
              new Promise((_resolve, reject) =>
                setTimeout(() => reject(new Error(`native download timed out after ${dlTimeoutMs}ms`)), dlTimeoutMs),
              ),
            ]);
            const stat = await Filesystem.stat({ path: destPath, directory: Directory.Data });
            const big = stat.size || 0;
            const okSize = isModel ? big >= Math.floor(file.approxBytes * 0.995) : big >= minSize;
            if (!okSize) throw new Error(`downloaded ${file.name} too small (${big} bytes)`);

            this.state.completedFiles[file.name] = true;
            this.state.bytesDownloaded = Object.entries(this.state.completedFiles).reduce(
              (acc, [name, done]) => acc + (done ? VISION_FILES.find((f) => f.name === name)?.approxBytes || 0 : 0),
              0,
            );
            this.state.currentFile = null;
            this.notify();
            safeLog(`✅ [native] ${file.name} downloaded (${big} bytes) from ${new URL(u).origin}`);
            return;
          } catch (e: any) {
            console.warn(`[VisionDL][native] ${file.name} from ${u} failed: ${e?.message || e}`);
            try { await Filesystem.deleteFile({ path: destPath, directory: Directory.Data }); } catch { /* ignore */ }
            if (attempt < 3) await new Promise((r) => setTimeout(r, 1500 * attempt));
          }
        }
      }
      safeLog(`[native] all download attempts failed for ${file.name}`);
    }

    // The native OS HTTP download (Filesystem.downloadFile) is the only path
    // that works in production. The old in-WebView fetch()/XHR fallback could
    // never succeed: the Hugging Face CDN only sends CORS headers for the
    // huggingface.co origin, not our app origin. If every native attempt
    // failed, give up so the caller marks the file failed and retries later.
    throw new Error(`Failed to download ${file.name}: all native download attempts failed`);
  }
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
