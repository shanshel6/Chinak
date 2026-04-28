import { embedText, embedImage } from './server/services/clipService.js';
import { canonicalCategories } from './server/services/categoryCanonicalService.js';

function cosineSimilarity(vecA, vecB) {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function run() {
  console.log('Embedding text...');
  const textVec = await embedText('a photo of a men tshirts');
  console.log('Text vec length:', textVec.length);

  // just a dummy array for image vec
  const imgVec = new Array(512).fill(0.01);
  const sim = cosineSimilarity(textVec, imgVec);
  console.log('Sim:', sim);
}

run().catch(console.error);
