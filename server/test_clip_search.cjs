
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const axios = require('axios');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const { AutoProcessor, CLIPVisionModelWithProjection, CLIPTextModelWithProjection, RawImage, AutoTokenizer } = require('@xenova/transformers');

console.log('Testing CLIP search (text + image)...');
const MODEL_ID = 'Xenova/clip-vit-base-patch32';

let processorPromise = null;
let visionModelPromise = null;
let textModelPromise = null;
let tokenizerPromise = null;

const getProcessor = async () => {
  if (!processorPromise) processorPromise = AutoProcessor.from_pretrained(MODEL_ID);
  return processorPromise;
};
const getVisionModel = async () => {
  if (!visionModelPromise) visionModelPromise = CLIPVisionModelWithProjection.from_pretrained(MODEL_ID, { quantized: true });
  return visionModelPromise;
};
const getTextModel = async () => {
  if (!textModelPromise) textModelPromise = CLIPTextModelWithProjection.from_pretrained(MODEL_ID, { quantized: true });
  return textModelPromise;
};
const getTokenizer = async () => {
  if (!tokenizerPromise) tokenizerPromise = AutoTokenizer.from_pretrained(MODEL_ID);
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

async function generateTextEmbedding(text) {
  const tokenizer = await getTokenizer();
  const model = await getTextModel();

  const textInputs = await tokenizer([text], {
    padding: true,
    truncation: true,
    return_tensors: 'pt'
  });

  const output = await model(textInputs);
  const textEmbeds = output?.text_embeds;

  return normalizeL2(toNumberArray(textEmbeds));
}

async function searchByText(query, topK = 3) {
  console.log(`\n🔍 Searching by text: "${query}"`);
  const embedding = await generateTextEmbedding(query);
  const vectorStr = `[${embedding.join(',')}]`;

  const results = await prisma.$queryRawUnsafe(`
    SELECT id, name, image, 
      1 - ("imageEmbedding" <=> $1::vector) as image_similarity, 
      1 - ("textEmbedding" <=> $1::vector) as text_similarity,
      (1 - ("imageEmbedding" <=> $1::vector) + 1 - ("textEmbedding" <=> $1::vector)) / 2 as combined_similarity
    FROM "Product"
    WHERE id IN (356, 357, 358, 360, 362, 364, 365, 366, 367, 368, 369, 370)
    ORDER BY combined_similarity DESC
    LIMIT $2
  `, vectorStr, topK);

  console.log('📊 Top results:');
  results.forEach((r, idx) => {
    console.log(`  ${idx + 1}. Product ${r.id}: ${r.name}`);
    console.log(`     Image similarity: ${(r.image_similarity * 100).toFixed(1)}%`);
    console.log(`     Text similarity: ${(r.text_similarity * 100).toFixed(1)}%`);
    console.log(`     Combined similarity: ${(r.combined_similarity * 100).toFixed(1)}%`);
  });
}

async function main() {
  try {
    console.log('Loading models...');
    await getProcessor();
    await getVisionModel();
    await getTextModel();
    await getTokenizer();

    // Test 1: Search by English text
    await searchByText('red bikini swimsuit', 3);

    // Test 2: Search by translated Arabic text (simulating user query)
    const arabicQuery = 'بدلة سباحة سوداء';
    const translatedQuery = 'black swimsuit'; // Simulated translation
    console.log(`\n🌍 Arabic query: "${arabicQuery}" → translated to "${translatedQuery}"`);
    await searchByText(translatedQuery, 3);

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
