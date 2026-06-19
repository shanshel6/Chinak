/**
 * Download CLIP model files for bundling with the app
 * This script downloads all necessary ONNX model files
 * 
 * Run: node download-clip-model.cjs
 */

const fs = require('fs').promises;
const path = require('path');

const MODEL_ID = 'Xenova/clip-vit-base-patch32';

// Files needed for @xenova/transformers CLIP model
const FILES = [
  // Config files
  'config.json',
  'preprocessor_config.json',
  
  // Tokenizer files  
  'tokenizer.json',
  'tokenizer_config.json',
  'vocab.json',
  'merges.txt',
  
  // ONNX model files (these are the big ones)
  'onnx/model.onnx',
  'onnx/model_q8.onnx',
  'onnx/model_fp16.onnx',
  
  // Vision model
  'onnx/vision_model.onnx',
  'onnx/vision_model-quantized.onnx',
  
  // Text model
  'onnx/text_model.onnx',
  'onnx/text_model-quantized.onnx',
];

async function downloadFile(url, destPath) {
  const https = require('https');
  const http = require('http');
  
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    
    const request = url.startsWith('https') ? https.get : http.get;
    
    request(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        // Handle redirect
        const redirectUrl = response.headers.location;
        request(redirectUrl, (redirectResponse) => {
          redirectResponse.pipe(file);
          file.on('finish', () => {
            file.close();
            resolve();
          });
        }).on('error', reject);
      } else {
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve();
        });
      }
    }).on('error', (err) => {
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

async function main() {
  const outputDir = path.join(__dirname, 'public', 'models', 'clip');
  
  console.log('📦 Downloading CLIP model files...\n');
  console.log(`Model: ${MODEL_ID}`);
  console.log(`Output: ${outputDir}\n`);
  
  // Create directories
  await fs.mkdir(outputDir, { recursive: true });
  await fs.mkdir(path.join(outputDir, 'onnx'), { recursive: true });
  
  let success = 0;
  let failed = 0;
  
  for (const file of FILES) {
    const url = `https://huggingface.co/${MODEL_ID}/resolve/main/${file}`;
    const destPath = path.join(outputDir, file);
    
    console.log(`📥 ${file}...`);
    
    try {
      await downloadFile(url, destPath);
      const stats = await fs.stat(destPath);
      console.log(`   ✅ ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
      success++;
    } catch (error) {
      console.log(`   ❌ Failed: ${error.message}`);
      failed++;
    }
  }
  
  console.log('\n' + '='.repeat(50));
  console.log(`Downloaded: ${success}/${FILES.length} files`);
  if (failed > 0) {
    console.log(`Failed: ${failed} files`);
  }
  console.log('='.repeat(50));
}

main().catch(console.error);
