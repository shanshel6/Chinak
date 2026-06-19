/**
 * Download CLIP model using @xenova/transformers library
 * This should handle all the redirects and caching properly
 */

import { AutoProcessor, AutoTokenizer, CLIPTextModelWithProjection, env } from '@xenova/transformers';

const MODEL_ID = 'Xenova/clip-vit-base-patch32';
const OUTPUT_DIR = './public/models/clip';

async function downloadModel() {
  console.log('📦 Downloading CLIP model using transformers library...\n');
  console.log(`Model: ${MODEL_ID}`);
  console.log(`Output: ${OUTPUT_DIR}\n`);
  
  // Configure environment
  env.allowLocalModels = true;
  env.allowRemoteModels = true;
  env.useBrowserCache = false;
  env.localModelPath = OUTPUT_DIR;
  
  console.log('Step 1: Downloading processor...');
  const processor = await AutoProcessor.from_pretrained(MODEL_ID, { quantized: true });
  console.log('✅ Processor downloaded');
  
  console.log('Step 2: Downloading tokenizer...');
  const tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID, { quantized: true });
  console.log('✅ Tokenizer downloaded');
  
  console.log('Step 3: Downloading text model...');
  const textModel = await CLIPTextModelWithProjection.from_pretrained(MODEL_ID, { quantized: true });
  console.log('✅ Text model downloaded');
  
  console.log('\n' + '='.repeat(50));
  console.log('✅ Model download complete!');
  console.log('Files should be cached at:', OUTPUT_DIR);
  console.log('='.repeat(50));
  
  return { processor, tokenizer, textModel };
}

// Handle CommonJS/ESM differences
if (import.meta.url === `file://${process.argv[1]}`) {
  downloadModel().catch(console.error);
}