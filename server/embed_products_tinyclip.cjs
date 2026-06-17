
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const axios = require('axios');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const { AutoProcessor, CLIPVisionModelWithProjection, CLIPTextModelWithProjection, RawImage, AutoTokenizer } = require('@xenova/transformers');

console.log('Starting TinyCLIP (Xenova) embedding of all products...');
const MODEL_ID = 'Xenova/clip-vit-base-patch32';

let processorPromise = null;
let visionModelPromise = null;
let textModelPromise = null;
let tokenizerPromise = null;

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

    let imageEmbedding = null;
    if (product.image) {
      imageEmbedding = await generateImageEmbedding(product.image);
    }

    let textEmbedding = null;
      let combinedText = '';
      if (product.name) combinedText += product.name;
      combinedText = combinedText.trim();

    if (combinedText) {
      textEmbedding = await generateTextEmbedding(combinedText);
    }

    if (imageEmbedding || textEmbedding) {
      const imageVectorStr = imageEmbedding ? `[${imageEmbedding.join(',')}]` : null;
      const textVectorStr = textEmbedding ? `[${textEmbedding.join(',')}]` : null;

      console.log('  → Updating product in database...');
      const updates = [];
      const params = [];
      let paramIndex = 1;

      if (imageVectorStr) {
        updates.push(`"imageEmbedding" = $${paramIndex}::vector`);
        params.push(imageVectorStr);
        paramIndex++;
      } else {
        updates.push(`"imageEmbedding" = NULL`);
      }

      if (textVectorStr) {
        updates.push(`"textEmbedding" = $${paramIndex}::vector`);
        params.push(textVectorStr);
        paramIndex++;
      } else {
        updates.push(`"textEmbedding" = NULL`);
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

    const totalProducts = await prisma.product.count();
    console.log(`Total products in database: ${totalProducts}`);

    const batchSize = 10;
    let processed = 0;
    let successful = 0;
    let failed = 0;

    for (let skip = 0; skip < totalProducts; skip += batchSize) {
      console.log(`\n=== Processing batch ${Math.floor(skip / batchSize) + 1}/${Math.ceil(totalProducts / batchSize)} ===`);

      const products = await prisma.product.findMany({
        skip,
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

      for (const product of products) {
        processed++;
        const success = await embedProduct(product);
        if (success) {
          successful++;
        } else {
          failed++;
        }
      }

      console.log(`Progress: ${processed}/${totalProducts} (${Math.round(processed / totalProducts * 100)}%)`);
    }

    console.log('\n✅ All products processed!');
    console.log('Summary:');
    console.log(`  Total processed: ${processed}`);
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
