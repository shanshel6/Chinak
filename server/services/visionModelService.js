import fs from 'fs';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_URL = 'https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/main/';
const OUTPUT_DIR = path.join(__dirname, '..', 'public', 'vision-models');

const FILES = [
  { remote: 'onnx/vision_model_quantized.onnx', local: 'vision_model_quantized.onnx' },
  { remote: 'preprocessor_config.json', local: 'preprocessor_config.json' },
  { remote: 'config.json', local: 'config.json' },
];

/**
 * Download a single file with redirect support
 */
function downloadFile(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) {
      reject(new Error('Too many redirects'));
      return;
    }

    const file = fs.createWriteStream(dest);
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    }, (response) => {
      // Follow redirects
      if (response.statusCode === 301 || response.statusCode === 302 || response.statusCode === 307) {
        response.destroy();
        const newUrl = response.headers.location;
        downloadFile(newUrl, dest, redirects + 1).then(resolve).catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode} for ${url}`));
        return;
      }

      const totalBytes = parseInt(response.headers['content-length'] || '0', 10);
      let downloadedBytes = 0;
      let lastLog = Date.now();

      response.on('data', (chunk) => {
        downloadedBytes += chunk.length;
        if (Date.now() - lastLog > 5000) {
          const pct = totalBytes > 0 ? (downloadedBytes / totalBytes * 100).toFixed(1) : '?';
          const mb = (downloadedBytes / 1024 / 1024).toFixed(2);
          const totalMb = (totalBytes / 1024 / 1024).toFixed(2);
          console.log(`[VisionModelDL] ${path.basename(dest)}: ${mb}MB / ${totalMb}MB (${pct}%)`);
          lastLog = Date.now();
        }
      });

      response.pipe(file);

      file.on('finish', () => {
        file.close();
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

/**
 * Ensure all vision model files are downloaded to the server's public directory.
 */
export async function ensureVisionModels() {
  console.log('[VisionModel] Checking local model cache...');
  
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  for (const file of FILES) {
    const dest = path.join(OUTPUT_DIR, file.local);
    
    // Skip if file already exists and is not empty
    if (fs.existsSync(dest) && fs.statSync(dest).size > 1000) { // Small files are likely config, models are large
      continue;
    }

    console.log(`[VisionModel] Downloading missing file: ${file.local}`);
    try {
      await downloadFile(BASE_URL + file.remote, dest);
      console.log(`[VisionModel] ✅ Successfully downloaded: ${file.local}`);
    } catch (e) {
      console.error(`[VisionModel] ❌ Failed to download ${file.local}:`, e.message);
      // Don't crash the server, but the Android app will fail to download this file
    }
  }
}
