
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const axios = require('axios');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const { AutoProcessor, CLIPVisionModelWithProjection, CLIPTextModelWithProjection, RawImage, AutoTokenizer } = require('@xenova/transformers');

console.log('Starting TinyCLIP (Xenova) embedding of all products...');
const MODEL_ID = 'Xenova/clip-vit-base-patch32';
const PROGRESS_FILE = path.join(__dirname, 'tinyclip_progress.json');

let processorPromise = null;
let visionModelPromise = null;
let textModelPromise = null;
let tokenizerPromise = null;

// Progress tracking functions
async function saveProgress(lastProductId) {
  try {
    await fs.writeFile(PROGRESS_FILE, JSON.stringify({ lastProcessedId: lastProductId }));
  } catch (err) {
    console.error('⚠️ Failed to save progress:', err.message);
  }
}

async function loadProgress() {
  try {
    const data = await fs.readFile(PROGRESS_FILE, 'utf8');
    const progress = JSON.parse(data);
    return progress.lastProcessedId || null;
  } catch (err) {
    if (err.code === 'ENOENT') {
      return null; // File doesn't exist yet, start fresh
    }
    console.error('⚠️ Failed to load progress:', err.message);
    return null;
  }
}

const getProcessor = async () => {
  if (!processorPromise) {
    processorPromise = AutoProcessor.from_pretrained(MODEL_ID);
  }
  return processorPromise;
};
const getVisionModel = async () => {
  if (!visionModelPromise) {
    visionModelPromise = CLIPVisionModelWithProjection.from_pretrained(MODEL_ID, { quantized: true });
  }
  return visionModelPromise;
};
const getTextModel = async () => {
  if (!textModelPromise) {
    textModelPromise = CLIPTextModelWithProjection.from_pretrained(MODEL_ID, { quantized: true });
  }
  return textModelPromise;
};
const getTokenizer = async () => {
  if (!tokenizerPromise) {
    tokenizerPromise = AutoTokenizer.from_pretrained(MODEL_ID);
  }
  return tokenizerPromise;
};

const normalizeL2 = (vector) => {
  let sumSq = 0;
  for (const v of vector) {
    const n = Number(v);
    sumSq += n * n;
  }
  const norm = Math.sqrt(sumSq);
  if (!Number.isFinite(norm) || norm === 0) return vector.map(() => 0);
  return vector.map((v) => Number(v) / norm);
};

const toNumberArray = (tensorLike) => {
  const data = tensorLike?.data ?? tensorLike;
  if (data && typeof data.length === 'number') return Array.from(data).map((n) => Number(n));
  throw new Error('Unable to read embedding tensor data');
};

async function readRawImageFromBuffer(buffer) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clip-'));
  const tempFilePath = path.join(tempDir, 'input.jpg');
  try {
    await fs.writeFile(tempFilePath, buffer);
    return await RawImage.read(tempFilePath);
  } finally {
    try { await fs.unlink(tempFilePath); } catch {}
    try { await fs.rmdir(tempDir); } catch {}
  }
}

function normalizeImageForProcessor(image) {
  const normalized = image.channels === 4 ? image.rgb() : image;
  const data = normalized.data instanceof Uint8ClampedArray
    ? normalized.data
    : new Uint8ClampedArray(normalized.data);
  return new RawImage(data, normalized.width, normalized.height, 3);
}

async function generateImageEmbedding(imageUrl) {
  try {
    console.log('  → Loading image:', imageUrl);
    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    const rawImage = await readRawImageFromBuffer(response.data);
    const normalizedImage = normalizeImageForProcessor(rawImage);

    const processor = await getProcessor();
    const model = await getVisionModel();

    const { pixel_values } = await processor(normalizedImage);
    const output = await model({ pixel_values });
    const imageEmbeds = output?.image_embeds;

    const embedding = toNumberArray(imageEmbeds);
    return normalizeL2(embedding);
  } catch (err) {
    console.error('  ❌ Image embedding failed:', err.message);
    return null;
  }
}

async function generateTextEmbedding(text) {
  try {
    console.log('  → Processing text:', text.slice(0, 50) + '...');
    const tokenizer = await getTokenizer();
    const model = await getTextModel();

    const textInputs = await tokenizer([text], {
      padding: true,
      truncation: true,
      return_tensors: 'pt'
    });

    const output = await model(textInputs);
    const textEmbeds = output?.text_embeds;

    const embedding = toNumberArray(textEmbeds);
    return normalizeL2(embedding);
  } catch (err) {
    console.error('  ❌ Text embedding failed:', err.message);
    return null;
  }
}

async function embedProduct(product) {
  try {
    console.log(`\nProcessing product ${product.id}: ${product.name}`);

    // Generate image and text embeddings in PARALLEL for speed
    const [imageEmbedding, textEmbedding] = await Promise.all([
      product.image ? generateImageEmbedding(product.image) : Promise.resolve(null),
      (async () => {
        let combinedText = '';
        if (product.name) combinedText += product.name;
        combinedText = combinedText.trim();
        return combinedText ? generateTextEmbedding(combinedText) : null;
      })()
    ]);

    if (imageEmbedding || textEmbedding) {
      const imageVectorStr = imageEmbedding ? `[${imageEmbedding.join(',')}]` : null;
      const textVectorStr = textEmbedding ? `[${textEmbedding.join(',')}]` : null;

      console.log('  → Updating product in database...');
      const updates = [];
      const params = [];
      let paramIndex = 1;

      // Only update fields that have new values - never overwrite existing with NULL
      if (imageVectorStr) {
        updates.push(`"imageEmbedding" = $${paramIndex}::vector`);
        params.push(imageVectorStr);
        paramIndex++;
      }

      if (textVectorStr) {
        updates.push(`"textEmbedding" = $${paramIndex}::vector`);
        params.push(textVectorStr);
        paramIndex++;
      }

      // Skip update entirely if no new embeddings were generated
      if (updates.length === 0) {
        console.log('  → No new embeddings generated, preserving existing values');
        return true; // Not a failure - existing data is intact
      }

      params.push(product.id);

      await prisma.$executeRawUnsafe(`
        UPDATE "Product"
        SET
          ${updates.join(', ')}
        WHERE "id" = $${paramIndex}
      `, ...params);

      console.log(`✅ Product ${product.id} embedded successfully!`);
      return true;
    }

    return false;
  } catch (error) {
    console.error(`❌ Failed to embed product ${product.id}:`, error.message);
    return false;
  }
}

async function main() {
  try {
    console.log('Loading models...');
    await getProcessor();
    await getVisionModel();
    await getTextModel();
    await getTokenizer();
    console.log('✅ Models loaded!');

    // Load progress
    const lastProcessedId = await loadProgress();
    if (lastProcessedId !== null) {
      console.log(`📂 Resuming from product ID: ${lastProcessedId}`);
    } else {
      console.log('📂 Starting fresh (no saved progress found)');
    }

    const totalProducts = await prisma.product.count();
    const processedSoFar = lastProcessedId 
      ? await prisma.product.count({ where: { id: { lte: lastProcessedId } } }) 
      : 0;
    console.log(`Total products in database: ${totalProducts}`);
    console.log(`Already processed: ${processedSoFar}`);

    const batchSize = 50;
    let processed = processedSoFar;
    let successful = 0;
    let failed = 0;
    let lastId = lastProcessedId;

    while (true) {
      // Get next batch of products, starting after last processed ID
      const products = await prisma.product.findMany({
        where: lastId ? { id: { gt: lastId } } : {},
        take: batchSize,
        select: {
          id: true,
          name: true,
          description: true,
          specs: true,
          image: true
        },
        orderBy: { id: 'asc' }
      });

      if (products.length === 0) {
        break; // No more products to process
      }

      const currentBatchNum = Math.floor(processed / batchSize) + 1;
      const totalBatches = Math.ceil(totalProducts / batchSize);
      console.log(`\n=== Processing batch ${currentBatchNum}/${totalBatches} ===`);

      for (const product of products) {
        processed++;
        const success = await embedProduct(product);
        if (success) {
          successful++;
        } else {
          failed++;
        }
        
        lastId = product.id;
        await saveProgress(lastId); // Save progress after each product

        console.log(`Progress: ${processed}/${totalProducts} (${Math.round(processed / totalProducts * 100)}%)`);
      }
    }

    console.log('\n✅ All products processed!');
    console.log('Summary:');
    console.log(`  Total processed in this run: ${processed - processedSoFar}`);
    console.log(`  Successful: ${successful}`);
    console.log(`  Failed: ${failed}`);

  } catch (error) {
    console.error('❌ Critical error:', error.message);
    console.error(error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
