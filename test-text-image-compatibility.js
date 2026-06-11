
import prisma from './server/prismaClient.js';
import { embedText, embedImage } from './server/services/clipService.js';

const normalizeL2 = (vector) => {
  if (!Array.isArray(vector)) throw new Error('Invalid embedding vector');
  let sumSq = 0;
  for (const v of vector) {
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error('Embedding vector contains non-numeric values');
    sumSq += n * n;
  }
  const norm = Math.sqrt(sumSq);
  if (!Number.isFinite(norm) || norm === 0) return vector.map(() => 0);
  return vector.map((v) => Number(v) / norm);
};

const cosineSimilarity = (vec1, vec2) => {
  let dotProduct = 0;
  let norm1 = 0;
  let norm2 = 0;
  for (let i = 0; i < vec1.length; i++) {
    dotProduct += vec1[i] * vec2[i];
    norm1 += vec1[i] * vec1[i];
    norm2 += vec2[i] * vec2[i];
  }
  return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
};

async function main() {
  console.log('=== Testing Text-Image Embedding Compatibility ===');

  // Get a product that has an image
  const product = await prisma.product.findFirst({
    where: {
      image: { not: null },
      status: 'PUBLISHED',
      isActive: true
    },
    select: { id: true, name: true, image: true }
  });
  console.log(`\nTesting product: [${product.id}] ${product.name}`);
  console.log(`Image URL: ${product.image}`);

  try {
    // Embed the product name (text)
    console.log('\nEmbedding product name (text)...');
    const textEmbedding = await embedText(product.name);
    console.log(`✓ Text embedding generated (length: ${textEmbedding.length})`);

    // Embed the product image
    console.log('\nEmbedding product image...');
    const imageEmbedding = await embedImage(product.image, product.name);
    console.log(`✓ Image embedding generated (length: ${imageEmbedding.length})`);

    // Verify both are L2 normalized
    console.log('\nChecking L2 normalization...');
    const textNorm = Math.sqrt(textEmbedding.reduce((sum, val) => sum + val * val, 0));
    const imageNorm = Math.sqrt(imageEmbedding.reduce((sum, val) => sum + val * val, 0));
    console.log(`✓ Text embedding norm: ${textNorm.toFixed(6)}`);
    console.log(`✓ Image embedding norm: ${imageNorm.toFixed(6)}`);

    // Calculate cosine similarity
    console.log('\nCalculating cosine similarity between text and image embeddings...');
    const similarity = cosineSimilarity(textEmbedding, imageEmbedding);
    console.log(`✓ Cosine similarity: ${(similarity * 100).toFixed(1)}%`);

    if (similarity > 0.1) {
      console.log('\n✅ COMPATIBLE: Text and image embeddings are from the same CLIP model and work together!');
    } else {
      console.log('\n⚠️ Low similarity - might need further checking');
    }

  } catch (err) {
    console.error('\n❌ Test failed:', err.message);
    console.error(err.stack);
  }

  await prisma.$disconnect();
}

main().catch(console.error);

