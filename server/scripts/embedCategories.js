import { ProxyAgent, setGlobalDispatcher } from 'undici';
import { buildCategoryIndex } from '../services/categoryService.js';
import { loadEmbeddingModel, embedCategories, saveCategoryVectors, hasCachedVectors } from '../services/categoryEmbeddingService.js';

const main = async () => {
  console.log('=== Category Embedding Script ===\n');

  // Enable proxy by default for China (HuggingFace blocked)
  const useProxy = process.env.USE_AI_PROXY !== 'false';
  if (useProxy) {
    const proxyUrl = process.env.AI_PROXY_URL || 'http://127.0.0.1:7890';
    console.log(`[Embed] Using proxy: ${proxyUrl}`);
    setGlobalDispatcher(new ProxyAgent(proxyUrl));
  }

  if (hasCachedVectors()) {
    console.log('Vectors already cached. Delete server/data/category-vectors.json to force re-embed.');
    console.log('Run with --force to re-embed anyway.');
    if (!process.argv.includes('--force')) {
      process.exit(0);
    }
    console.log('--force detected, re-embedding...\n');
  }

  const { list } = buildCategoryIndex();
  console.log(`Found ${list.length} categories in seed file\n`);

  await loadEmbeddingModel();

  const vectors = await embedCategories(list);
  saveCategoryVectors(vectors);

  console.log('\nDone! Vectors saved to server/data/category-vectors.json');
  console.log('The search endpoint will use these automatically on next restart.');
};

main().catch((err) => {
  console.error('Embedding failed:', err);
  process.exit(1);
});
