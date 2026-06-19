/**
 * Download CLIP text model for bundling with the app - FIXED VERSION
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const MODEL_ID = 'Xenova/clip-vit-base-patch32';
const OUTPUT_DIR = path.join(__dirname, 'public', 'models', 'clip');

const FILES = [
  'config.json',
  'preprocessor_config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'vocab.json',
  'merges.txt',
  'special_tokens_map.json',
  'onnx/text_model_int8.onnx',
  'onnx/config.json',
];

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    // Create directory synchronously
    const dir = path.dirname(destPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    const file = fs.createWriteStream(destPath);
    
    const request = https.get(url, (response) => {
      // Handle redirects
      if (response.statusCode === 302 || response.statusCode === 301) {
        // Follow the redirect
        const redirectUrl = response.headers.location;
        console.log(`   ↪️ Redirecting to: ${redirectUrl}`);
        https.get(redirectUrl, (redirectResponse) => {
          redirectResponse.pipe(file);
          file.on('finish', () => {
            file.close();
            resolve();
          });
        }).on('error', reject);
      } else if (response.statusCode === 200) {
        // Direct download
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve();
        });
      } else {
        reject(new Error(`HTTP ${response.statusCode}`));
      }
    }).on('error', (err) => {
      try { fs.unlinkSync(destPath); } catch (e) {}
      reject(err);
    });
    
    // Set timeout
    request.setTimeout(30000, () => {
      request.destroy();
      reject(new Error('Timeout'));
    });
  });
}

async function main() {
  console.log('📦 Downloading CLIP TEXT model (fixed version)...\n');
  console.log(`Output: ${OUTPUT_DIR}\n`);
  
  let success = 0;
  let failed = 0;
  
  for (const file of FILES) {
    const url = `https://huggingface.co/${MODEL_ID}/resolve/main/${file}`;
    const destPath = path.join(OUTPUT_DIR, file);
    
    console.log(`📥 ${file}...`);
    
    try {
      const start = Date.now();
      await downloadFile(url, destPath);
      const stats = fs.statSync(destPath);
      
      // Check if file contains actual JSON or is a redirect
      const content = fs.readFileSync(destPath, 'utf8');
      if (content.includes('Temporary Redirect') || content.includes('Redirecting')) {
        console.log(`   ❌ File contains redirect, not actual content`);
        fs.unlinkSync(destPath);
        failed++;
      } else {
        console.log(`   ✅ ${(stats.size / 1024 / 1024).toFixed(2)} MB (${Date.now() - start}ms)`);
        success++;
      }
    } catch (error) {
      console.log(`   ❌ ${error.message}`);
      failed++;
    }
  }
  
  console.log('\n' + '='.repeat(50));
  console.log(`Downloaded: ${success}/${FILES.length}`);
  if (failed > 0) {
    console.log(`Failed: ${failed}`);
  }
  
  // Calculate total
  let total = 0;
  try {
    const walk = (dir) => {
      const files = fs.readdirSync(dir);
      files.forEach(f => {
        const full = path.join(dir, f);
        if (fs.statSync(full).isDirectory()) {
          walk(full);
        } else {
          total += fs.statSync(full).size;
        }
      });
    };
    walk(OUTPUT_DIR);
    console.log(`Total size: ${(total / 1024 / 1024).toFixed(2)} MB`);
  } catch (e) {
    // ignore
  }
  console.log('='.repeat(50));
}

main().catch(console.error);