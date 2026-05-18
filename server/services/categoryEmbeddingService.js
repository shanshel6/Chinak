import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pipeline } from '@xenova/transformers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverRoot = path.resolve(__dirname, '..');

const VECTORS_FILE = path.join(serverRoot, 'data', 'category-vectors.json');

let embedder = null;
let categoryVectors = null;

const cosineSimilarity = (a, b) => {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
};

export const loadEmbeddingModel = async () => {
  if (embedder) return embedder;
  console.log('[Embedding] Loading model: Xenova/paraphrase-multilingual-MiniLM-L12-v2');
  embedder = await pipeline('feature-extraction', 'Xenova/paraphrase-multilingual-MiniLM-L12-v2');
  console.log('[Embedding] Model loaded');
  return embedder;
};

export const embedText = async (text) => {
  if (!embedder) await loadEmbeddingModel();
  if (!text || !text.trim()) return null;
  const output = await embedder(text.trim(), { pooling: 'mean', normalize: true });
  return Array.from(output.data);
};

export const embedCategories = async (categories) => {
  if (!embedder) await loadEmbeddingModel();
  const vectors = [];
  console.log(`[Embedding] Embedding ${categories.length} categories...`);
  for (let i = 0; i < categories.length; i++) {
    const cat = categories[i];
    const searchText = [cat.nameAr, cat.pathAr, cat.nameEn, cat.pathEn, ...(cat.aliases || [])]
      .filter(Boolean)
      .join(' ');
    const vector = await embedText(searchText);
    if (vector) {
      vectors.push({ id: cat.id, slug: cat.slug || cat.id, vector });
    }
    if ((i + 1) % 50 === 0 || i === categories.length - 1) {
      console.log(`[Embedding] Progress: ${i + 1}/${categories.length}`);
    }
  }
  return vectors;
};

export const saveCategoryVectors = (vectors) => {
  const dir = path.dirname(VECTORS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(VECTORS_FILE, JSON.stringify(vectors, null, 2));
  console.log(`[Embedding] Saved ${vectors.length} vectors to ${VECTORS_FILE}`);
};

export const loadCategoryVectors = () => {
  if (categoryVectors) return categoryVectors;
  if (!fs.existsSync(VECTORS_FILE)) {
    console.log('[Embedding] No cached vectors found');
    return null;
  }
  try {
    categoryVectors = JSON.parse(fs.readFileSync(VECTORS_FILE, 'utf8'));
    console.log(`[Embedding] Loaded ${categoryVectors.length} cached vectors`);
    return categoryVectors;
  } catch (e) {
    console.warn('[Embedding] Failed to load cached vectors:', e.message);
    return null;
  }
};

export const searchByEmbedding = async (query, topK = 20) => {
  const vectors = loadCategoryVectors();
  if (!vectors || vectors.length === 0) return [];
  const queryVec = await embedText(query);
  if (!queryVec) return [];
  const scored = vectors.map((entry) => ({
    id: entry.id,
    slug: entry.slug,
    score: cosineSimilarity(queryVec, entry.vector)
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
};

export const hasCachedVectors = () => {
  return fs.existsSync(VECTORS_FILE);
};
