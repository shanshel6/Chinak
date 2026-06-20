/**
 * Run this script ONCE during development to download CLIP models
 * into public/models/clip/ so they get bundled with the app.
 * 
 * Run: node scripts/download-clip-models.cjs
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const MODEL_ID = 'Xenova/clip-vit-base-patch32';
const OUTPUT_DIR = path.join(__dirname, '..', 'public', 'models', 'clip');

// Files needed for the text model to work locally
const FILES = [
  'config.json',
  'preprocessor_config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'vocab.json',
  'merges.txt',
  'special_tokens_map.json',
  'onnx/text_model_quantized.onnx',
];

function downloadFile(url, destPath, retries = 3) {
  return new Promise((resolve, reject) => {
    const dir = path.dirname(destPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const attempt = (urlToUse, triesLeft) => {
      const file = fs.createWriteStream(destPath);
      const req = https.get(urlToUse, (response) => {
        // Follow redirects (301, 302, 307, 308)
        if (response.statusCode >= 301 && response.statusCode <= 308 && response.statusCode !== 304) {
          let redirectUrl = response.headers.location;
          file.close();
          try { fs.unlinkSync(destPath); } catch (e) {}
          if (!redirectUrl) {
            if (triesLeft > 0) {
              console.log(`   ⚠️ Redirect with no location, retrying... (${triesLeft} left)`);
              setTimeout(() => attempt(urlToUse, triesLeft - 1), 2000);
            } else {
              reject(new Error('Redirect with no location'));
            }
            return;
          }
          
          // Handle relative redirect
          if (redirectUrl.startsWith('/')) {
            const urlObj = new URL(urlToUse);
            redirectUrl = `${urlObj.protocol}//${urlObj.host}${redirectUrl}`;
          }
          
          console.log(`   ↪️ Redirecting...`);
          attempt(redirectUrl, triesLeft);
        } else if (response.statusCode === 200) {
          response.pipe(file);
          file.on('finish', () => { file.close(); resolve(); });
        } else {
          file.close();
          try { fs.unlinkSync(destPath); } catch (e) {}
          if (triesLeft > 0) {
            console.log(`   ⚠️ HTTP ${response.statusCode}, retrying... (${triesLeft} left)`);
            setTimeout(() => attempt(urlToUse, triesLeft - 1), 2000);
          } else {
            reject(new Error(`HTTP ${response.statusCode}`));
          }
        }
      });
      req.setTimeout(60000, () => {
        req.destroy();
        file.close();
        try { fs.unlinkSync(destPath); } catch (e) {}
        if (triesLeft > 0) {
          console.log(`   ⚠️ Timeout, retrying... (${triesLeft} left)`);
          setTimeout(() => attempt(urlToUse, triesLeft - 1), 2000);
        } else {
          reject(new Error('Timeout'));
        }
      });
      req.on('error', (err) => {
        file.close();
        try { fs.unlinkSync(destPath); } catch (e) {}
        if (triesLeft > 0) {
          console.log(`   ⚠️ ${err.message}, retrying... (${triesLeft} left)`);
          setTimeout(() => attempt(urlToUse, triesLeft - 1), 2000);
        } else {
          reject(err);
        }
      });
    };
    attempt(url, retries);
  });
}

async function main() {
  console.log('📦 Downloading CLIP models for app bundling...\n');
  console.log(`Output: ${OUTPUT_DIR}\n`);

  let success = 0;
  let failed = 0;

  for (const file of FILES) {
    const url = `https://huggingface.co/${MODEL_ID}/resolve/main/${file}`;
    const destPath = path.join(OUTPUT_DIR, file);
    
    // Skip if exists
    if (fs.existsSync(destPath) && fs.statSync(destPath).size > 1000) {
      const mb = (fs.statSync(destPath).size / 1024 / 1024).toFixed(2);
      console.log(`⏭️  ${file} (already exists, ${mb} MB)`);
      success++;
      continue;
    }

    process.stdout.write(`📥 ${file}...`);
    
    try {
      const start = Date.now();
      await downloadFile(url, destPath);
      const stats = fs.statSync(destPath);
      console.log(` ✅ ${(stats.size / 1024 / 1024).toFixed(2)} MB (${Date.now() - start}ms)`);
      success++;
    } catch (error) {
      console.log(` ❌ ${error.message}`);
      failed++;
    }
  }

  console.log('\n' + '='.repeat(50));
  console.log(`Done: ${success}/${FILES.length} files`);
  if (failed > 0) console.log(`Failed: ${failed} files`);

  // Calculate total size
  let total = 0;
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    fs.readdirSync(dir).forEach(f => {
      const full = path.join(dir, f);
      if (fs.statSync(full).isDirectory()) walk(full);
      else total += fs.statSync(full).size;
    });
  };
  walk(OUTPUT_DIR);
  console.log(`Total size: ${(total / 1024 / 1024).toFixed(2)} MB`);
  console.log('='.repeat(50));
}

main().catch(console.error);