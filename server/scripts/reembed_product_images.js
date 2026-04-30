import prisma from '../prismaClient.js';
import { ensureProductImageEmbeddings, MAX_PRODUCT_IMAGE_EMBEDDINGS } from '../services/productImageVectorService.js';
import { embedText } from '../services/clipService.js';
import { canonicalCategories } from '../services/categoryCanonicalService.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'url';

// SiliconFlow LLM for dynamic category generation
import axios from 'axios';

function callSiliconFlowLLM(messages, { model, temperature = 0.3, maxTokens = 200, timeoutMs = 45000 } = {}) {
  const apiKey = String(process.env.SILICONFLOW_API_KEY || '').trim();
  if (!apiKey) return Promise.resolve(null);
  const sfModel = model || process.env.SILICONFLOW_MODEL || 'Qwen/Qwen3-8B';
  return axios.post('https://api.siliconflow.com/v1/chat/completions', {
    model: sfModel,
    messages,
    temperature,
    max_tokens: maxTokens,
    stream: false
  }, {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    timeout: timeoutMs
  }).then(res => {
    const text = res.data?.choices?.[0]?.message?.content;
    return text ? String(text).trim() : null;
  });
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const categoriesSeedPath = path.join(__dirname, 'canonical-categories.seed.json');

// ── Persistent Goofish category ID mapping ──
// Load from the same file that goofish-pipeline.js saves to
const GOOFISH_CATEGORY_MAP_PATH = path.join(__dirname, 'goofish-category-mappings.json');

function loadGoofishCategoryMap() {
  try {
    if (fs.existsSync(GOOFISH_CATEGORY_MAP_PATH)) {
      const data = JSON.parse(fs.readFileSync(GOOFISH_CATEGORY_MAP_PATH, 'utf8'));
      return new Map(Object.entries(data));
    }
  } catch (err) {
    console.warn(`[CategoryMap] Failed to load: ${err.message}`);
  }
  return new Map();
}

function saveGoofishCategoryMap(map) {
  try {
    const obj = Object.fromEntries(map);
    fs.writeFileSync(GOOFISH_CATEGORY_MAP_PATH, JSON.stringify(obj, null, 2));
  } catch (err) {
    console.warn(`[CategoryMap] Failed to save: ${err.message}`);
  }
}

// Seed with persisted mappings (auto-discovered by pipeline) plus any hardcoded overrides
const GOOFISH_CATEGORY_ID_MAP = loadGoofishCategoryMap();

// Extract categoryId from Goofish URLs
function extractGoofishCategoryId(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    return String(parsed.searchParams.get('categoryId') || '').trim();
  } catch {
    return '';
  }
}

// Quick LLM check: does this product name actually belong to this category?
async function verifyCategoryMatch(productName, categorySlug, categoryNameAr) {
  const apiKey = String(process.env.SILICONFLOW_API_KEY || '').trim();
  if (!apiKey) return true; // no key → trust embedding
  const sfModel = process.env.SILICONFLOW_MODEL || 'Qwen/Qwen3-8B';
  try {
    const text = await callSiliconFlowLLM(
      [{ role: 'user', content: `/no_think\nDoes this product belong to the category "${categorySlug}" (${categoryNameAr})?\nProduct: "${productName}"\nAnswer ONLY "yes" or "no".` }],
      { model: sfModel, temperature: 0.1, maxTokens: 10, timeoutMs: 15000 }
    );
    const answer = String(text || '').trim().toLowerCase();
    return answer.startsWith('yes');
  } catch {
    return true; // on error, trust embedding
  }
}

async function generateMissingCategory(productName) {
  const apiKey = String(process.env.SILICONFLOW_API_KEY || '').trim();
  if (!apiKey) {
    console.log('No SILICONFLOW_API_KEY configured, skipping dynamic category generation');
    return null;
  }
  
  const sfModel = process.env.SILICONFLOW_MODEL || 'Qwen/Qwen3-8B';
  // /no_think disables Qwen3's reasoning mode — drops response time from ~40s to ~4s
  const prompt = `/no_think
You are an e-commerce category generator. Given a product name, return a SHORT GENERIC CATEGORY name — never the product name itself.

Rules:
- The category must be a BROAD group that many similar products belong to (e.g. "Drones", "Headphones", "Power Banks").
- Do NOT include brand names, model numbers, or specific product details.
- The slug must be a short plural English word in snake_case (e.g. "drones", "action_cameras", "bedding_sets").
- The name_ar must be a short generic Arabic category (e.g. "درون", "سماعات", "شواحن متنقلة").
- The english_name must be the generic English category (e.g. "Drones", "Headphones", "Power Banks").

Product name: "${productName}"

Return ONLY a valid JSON object:
{"slug": "...", "name_ar": "...", "english_name": "..."}
No other text.`;

  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(`Calling SiliconFlow (model: ${sfModel}, attempt ${attempt}/${maxAttempts}) for category generation...`);
      const text = await callSiliconFlowLLM(
        [{ role: 'user', content: prompt }],
        { model: sfModel, temperature: 0.3, maxTokens: 200, timeoutMs: 45000 }
      );

      if (!text) {
        console.log(`SiliconFlow returned empty response (attempt ${attempt}/${maxAttempts})`);
        continue;
      }

      console.log(`SiliconFlow returned: ${text.substring(0, 150)}`);
      const cleanJson = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').replace(/^[^{]*/, '').replace(/[^}]*$/, '').trim();
      const data = JSON.parse(cleanJson);
      
      if (data.slug && data.name_ar && data.english_name) {
        return {
          slug: data.slug.toLowerCase(),
          name_ar: data.name_ar,
          aliases: [data.english_name]
        };
      }
      console.log(`SiliconFlow returned incomplete JSON (attempt ${attempt}/${maxAttempts}): ${cleanJson.substring(0, 100)}`);
    } catch (error) {
      const status = error?.response?.status;
      const msg = error?.message || '';
      console.log(`SiliconFlow failed (attempt ${attempt}/${maxAttempts}): ${status || msg}`);
      if (status === 429 || status === 502 || status === 503 || status === 504 || status === 500) {
        const waitMs = Math.min(15000, 2000 * Math.pow(2, attempt - 1));
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      break;
    }
  }
  console.log('All SiliconFlow attempts failed for category generation');
  return null;
}

async function saveNewCategoryToSeed(newCat) {
  try {
    const raw = await fs.readFile(categoriesSeedPath, 'utf8');
    const categories = JSON.parse(raw);
    
    // Add to a "Generated Categories" root, or just append as a new root category
    let genRoot = categories.find(c => c.slug === 'dynamically_generated');
    if (!genRoot) {
      genRoot = {
        slug: "dynamically_generated",
        name_ar: "فئات مضافة تلقائياً",
        aliases: ["generated", "other_generated"],
        children: []
      };
      categories.push(genRoot);
    }
    
    // Check if it already exists
    if (!genRoot.children.find(c => c.slug === newCat.slug)) {
      genRoot.children.push({
        slug: newCat.slug,
        name_ar: newCat.name_ar,
        aliases: newCat.aliases
      });
      await fs.writeFile(categoriesSeedPath, JSON.stringify(categories, null, 2), 'utf8');
      console.log(`Saved new category to seed file: ${newCat.slug}`);
    }
  } catch (err) {
    console.error('Failed to save new category to seed:', err.message);
  }
}


// Setup HF endpoint
process.env.HF_ENDPOINT = 'https://hf-mirror.com';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const formatProductLabel = (product) => {
  const id = Number(product?.id) || 0;
  const name = String(product?.name || '').replace(/\s+/g, ' ').trim();
  return name ? `Product ${id} - ${name}` : `Product ${id}`;
};

const withTimeout = async (promiseFactory, label, timeoutMs = 60000) => {
  let timer;
  let heartbeat = null;
  try {
    return await Promise.race([
      promiseFactory(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
};

const withRetry = async (run, label, retries = 5, timeoutMs = 60000, backoffMs = 1500) => {
  let lastError;
  for (let i = 1; i <= retries; i++) {
    try {
      return await withTimeout(run, label, timeoutMs);
    } catch (error) {
      lastError = error;
      const msg = String(error?.message || '');
      const retryable = msg.includes('Timed out fetching a new connection from the connection pool')
        || msg.includes("Can't reach database server")
        || msg.includes('timed out after')
        || msg.includes('Server has closed the connection')
        || String(error?.code || '') === 'P2024'
        || String(error?.code || '') === 'P1017';
      if (!retryable || i === retries) break;
      console.warn(`${label} failed (attempt ${i}/${retries}), retrying... ${msg}`);
      try { await prisma.$disconnect(); } catch {}
      await new Promise((r) => setTimeout(r, backoffMs * i));
      try { await prisma.$connect(); } catch {}
    }
  }
  throw lastError;
};

const waitForDbReady = async (maxWaitMs, retryCount, timeoutMs, backoffMs, progressFilePath, lastId) => {
  const start = Date.now();
  const infiniteWait = maxWaitMs <= 0;
  while (infiniteWait || (Date.now() - start < maxWaitMs)) {
    try {
      await withRetry(() => prisma.$connect(), 'connect', retryCount, timeoutMs, backoffMs);
      await withRetry(() => prisma.$queryRawUnsafe('SELECT 1'), 'db ping', retryCount, timeoutMs, backoffMs);
      return true;
    } catch (error) {
      const msg = String(error?.message || '');
      console.warn(`Database not ready, retrying... ${msg}`);
      if (progressFilePath && lastId > 0) {
        try { await writeProgress(progressFilePath, { lastId }); } catch {}
      }
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  return false;
};

async function readProgress(progressFilePath) {
  try {
    const raw = await fs.readFile(progressFilePath, 'utf8');
    const data = JSON.parse(raw);
    const lastId = Number.parseInt(String(data?.lastId ?? '0'), 10) || 0;
    return { lastId };
  } catch {
    return { lastId: 0 };
  }
}

async function writeProgress(progressFilePath, progress) {
  const dir = path.dirname(progressFilePath);
  await fs.mkdir(dir, { recursive: true });

  const tmpPath = `${progressFilePath}.tmp`;
  const payload = JSON.stringify(
    {
      lastId: progress.lastId,
      updatedAt: new Date().toISOString(),
    },
    null,
    2
  );

  await fs.writeFile(tmpPath, payload, 'utf8');
  try {
    await fs.rename(tmpPath, progressFilePath);
  } catch {
    try {
      await fs.unlink(progressFilePath);
    } catch {}
    await fs.rename(tmpPath, progressFilePath);
  }
}

const assignCategories = process.env.REEMBED_ASSIGN_CATEGORIES === '1';
const categoryNewCategoryThreshold = Math.max(0, Math.min(1, Number.parseFloat(process.env.REEMBED_CATEGORY_NEW_THRESHOLD || '0.35') || 0.35));
const categoryVerifyThreshold = Math.max(0, Math.min(1, Number.parseFloat(process.env.REEMBED_CATEGORY_VERIFY_THRESHOLD || '0.50') || 0.50));
const categoryOtherThreshold = Math.max(0, Math.min(1, Number.parseFloat(process.env.REEMBED_CATEGORY_OTHER_THRESHOLD || '0.22') || 0.22));

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

// Merge fragmented category slugs into canonical ones
const CATEGORY_MERGE_MAP = new Map([
  ['foot_balls', 'footballs'],
  ['sports_balls', 'footballs'],
  ['soccer_balls', 'footballs'],
  ['basketballs', 'footballs'],
  ['volleyballs', 'footballs'],
  ['bedding', 'bedding_sets'],
  ['bed_sheet', 'bedding_sets'],
  ['sheets', 'bedding_sets'],
  ['kitchen_utensils', 'kitchen_tools'],
  ['cookware', 'kitchen_tools'],
  ['dinnerware', 'tableware_sets'],
  ['dishes', 'tableware_sets'],
  ['plates', 'tableware_sets'],
  ['ceramic_dishes', 'tableware_sets'],
  // outdoor / camping
  ['camping_tents', 'camping_gear'],
  ['outdoor_tents', 'camping_gear'],
  ['sunshade_tents', 'camping_gear'],
  ['folding_tables', 'camping_gear'],
  ['picnic_tables', 'camping_gear'],
  ['camping_tables', 'camping_gear'],
  ['outdoor_chairs', 'camping_gear'],
  ['folding_chairs', 'camping_gear'],
  ['camping_chairs', 'camping_gear'],
  ['picnic_baskets', 'camping_gear'],
  ['cooler_boxes', 'camping_gear'],
  // baby / kids
  ['baby_strollers', 'baby_gear'],
  ['baby_carriers', 'baby_gear'],
  ['infant_car_seats', 'baby_gear'],
  ['baby_walkers', 'baby_gear'],
  ['high_chairs', 'baby_gear'],
  ['kids_furniture', 'baby_gear'],
  // furniture
  ['dining_tables', 'furniture'],
  ['coffee_tables', 'furniture'],
  ['side_tables', 'furniture'],
  ['dining_chairs', 'furniture'],
  ['office_chairs', 'furniture'],
]);

function normalizeCategorySlug(slug) {
  return CATEGORY_MERGE_MAP.get(slug) || slug;
}

async function main() {
  const batchSize = Math.max(1, Number.parseInt(process.env.REEMBED_BATCH_SIZE || '100', 10) || 100);
  const maxItems = Math.max(1, Number.parseInt(process.env.REEMBED_MAX_ITEMS || '5000', 10) || 5000);
  const startId = Number.parseInt(process.env.REEMBED_START_ID || '0', 10) || 0;
  const progressFilePath = path.resolve(process.env.REEMBED_PROGRESS_FILE || 'reembed_progress.json');
  const resetProgress = String(process.env.REEMBED_RESET_PROGRESS || '').trim() === '1';
  const forceAll = String(process.env.REEMBED_FORCE_ALL || '').trim() === '1';
  const testOnly = String(process.env.REEMBED_TEST_ONLY || '').trim() === '1';
  const queryTimeoutMs = Math.max(1000, Number.parseInt(process.env.REEMBED_QUERY_TIMEOUT_MS || '90000', 10) || 90000);
  const updateTimeoutMs = Math.max(1000, Number.parseInt(process.env.REEMBED_UPDATE_TIMEOUT_MS || '180000', 10) || 180000);
  const retryCount = Math.max(1, Number.parseInt(process.env.REEMBED_RETRY_COUNT || '5', 10) || 5);
  const concurrency = Math.max(1, Number.parseInt(process.env.REEMBED_CONCURRENCY || '1', 10) || 1);
  const retryBackoffMs = Math.max(200, Number.parseInt(process.env.REEMBED_RETRY_BACKOFF_MS || '1500', 10) || 1500);
  const pingEveryChunk = String(process.env.REEMBED_DB_PING_EVERY_CHUNK || '1').trim() === '1';
  const reconnectEveryChunk = String(process.env.REEMBED_RECONNECT_EVERY_CHUNK || '0').trim() === '1';
  const dbWaitMs = Math.max(1000, Number.parseInt(process.env.REEMBED_DB_WAIT_MS || '300000', 10) || 300000);
  const progressEvery = Math.max(1, Number.parseInt(process.env.REEMBED_PROGRESS_EVERY || '5', 10) || 5);
  const heartbeatMs = Math.max(5000, Number.parseInt(process.env.REEMBED_HEARTBEAT_MS || '30000', 10) || 30000);

  const dbHost = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).hostname : 'unknown';
  console.log(`\n=================================================`);
  console.log(`🚀 Starting embedding process on Database: ${dbHost}`);
  console.log(`=================================================\n`);

  let heartbeat = null;

  const categoryEmbeddings = [];
  const textCategoryEmbeddings = []; // text-only embeddings for product name cross-check
  const categoryBySlug = new Map(); // slug -> cat object (ALL known categories, canonical + dynamic)
  if (assignCategories) {
    console.log('Pre-computing category embeddings...');
    for (const cat of canonicalCategories) {
      if (cat.slug === 'other') continue;
      
      // Try to find a purely English alias for a better CLIP prompt
      const englishAlias = (cat.aliases || []).find(a => /^[a-zA-Z\s-]+$/.test(a));
      const promptSubject = englishAlias || cat.slug.replace(/_/g, ' ');
      const text = `a photo of ${promptSubject}`;
      
      const vec = await embedText(text);
      if (vec && vec.length === 512 && !vec.every(v => v === 0)) {
        categoryEmbeddings.push({ cat, vec });
        textCategoryEmbeddings.push({ cat, vec });
        categoryBySlug.set(normalizeCategorySlug(cat.slug), cat);
      }
    }
    console.log(`Pre-computed text embeddings for ${textCategoryEmbeddings.length} categories.`);
    
    // Build image centroids from previously-assigned products for much better matching.
    // Text embeddings score ~30% against images (cross-modal limit), but image centroids score 70-85%.
    try {
      const slugList = [...categoryBySlug.keys()];
      if (slugList.length > 0) {
        console.log('Computing image centroids from previously assigned products...');
        const rows = await prisma.$queryRawUnsafe(`
          SELECT
            "aiMetadata"->>'categorySlug' AS slug,
            "imageEmbedding"::text AS vec
          FROM "Product"
          WHERE "imageEmbedding" IS NOT NULL
            AND "aiMetadata"->>'categorySlug' IS NOT NULL
            AND "aiMetadata"->>'categorySource' IN ('dynamic_generated', 'dynamic_reused', 'vision_llm_verified', 'vision_text_cross_verified')
        `);
        
        // Group image vectors by normalized category slug
        const vectorsBySlug = new Map();
        for (const row of rows) {
          if (!row.slug || !row.vec) continue;
          const normalizedSlug = normalizeCategorySlug(row.slug);
          try {
            const vec = JSON.parse(row.vec);
            if (!Array.isArray(vec) || vec.length !== 512) continue;
            if (!vectorsBySlug.has(normalizedSlug)) vectorsBySlug.set(normalizedSlug, []);
            vectorsBySlug.get(normalizedSlug).push(vec);
          } catch {}
        }
        
        let centroidCount = 0;
        for (const [slug, vecs] of vectorsBySlug) {
          const cat = categoryBySlug.get(slug);
          if (!cat || vecs.length === 0) continue;
          // Compute centroid (average of all image vectors for this category)
          const dim = vecs[0].length;
          const centroid = new Array(dim).fill(0);
          for (const v of vecs) {
            for (let i = 0; i < dim; i++) centroid[i] += v[i];
          }
          for (let i = 0; i < dim; i++) centroid[i] /= vecs.length;
          categoryEmbeddings.push({ cat, vec: centroid });
          centroidCount++;
        }
        if (centroidCount > 0) {
          console.log(`Added image centroids for ${centroidCount} categories (from ${rows.length} products).`);
        }
      }
    } catch (centroidErr) {
      console.warn(`Could not compute image centroids: ${centroidErr.message}`);
    }
  }

  // ── Auto-discovery for unknown Goofish category IDs ──
  const goofishCategoryDiscoveryInProgress = new Set();
  const goofishCategoryDiscoveryCache = new Map();

  async function autoDiscoverGoofishCategory(categoryId) {
    if (goofishCategoryDiscoveryInProgress.has(categoryId)) {
      while (goofishCategoryDiscoveryInProgress.has(categoryId)) {
        await new Promise((r) => setTimeout(r, 200));
      }
      return goofishCategoryDiscoveryCache.get(categoryId) || null;
    }

    goofishCategoryDiscoveryInProgress.add(categoryId);
    console.log(`[CategoryDiscovery] Starting auto-discovery for categoryId=${categoryId}`);

    try {
      const rows = await prisma.$queryRawUnsafe(`
        SELECT DISTINCT "name"
        FROM "Product"
        WHERE "aiMetadata"->>'goofishCategoryId' = $1
          AND "name" IS NOT NULL
        LIMIT 12
      `, categoryId);

      const titles = (rows || []).map((r) => String(r.name || '').trim()).filter(Boolean);
      if (titles.length === 0) {
        console.log(`[CategoryDiscovery] No product titles found for categoryId=${categoryId}`);
        goofishCategoryDiscoveryInProgress.delete(categoryId);
        return null;
      }

      const sfModel = process.env.SILICONFLOW_MODEL || 'Qwen/Qwen3-8B';
      const knownSlugs = [...categoryBySlug.keys()].join(', ');
      const prompt = `/no_think
You are an e-commerce category classifier. Given product titles from a Chinese marketplace, determine the best broad category.

Product titles (first 8):
${titles.slice(0, 8).map((t, i) => `${i + 1}. ${t}`).join('\n')}

Known categories (if it matches one, return its slug exactly):
${knownSlugs}

If none match, create a NEW broad generic category slug in snake_case (e.g. "camping_gear", "baby_strollers").

Return ONLY valid JSON:
{"slug": "...", "name_ar": "...", "english_name": "...", "reason": "..."}
No other text.`;

      const text = await callSiliconFlowLLM(
        [{ role: 'user', content: prompt }],
        { model: sfModel, temperature: 0.2, maxTokens: 200, timeoutMs: 20000 }
      );
      if (!text) {
        console.log(`[CategoryDiscovery] LLM returned empty for categoryId=${categoryId}`);
        goofishCategoryDiscoveryInProgress.delete(categoryId);
        return null;
      }

      const cleanJson = text
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '')
        .replace(/^[^{]*/, '')
        .replace(/[^}]*$/, '')
        .trim();

      const parsed = JSON.parse(cleanJson);
      let slug = parsed?.slug?.toLowerCase()?.trim();
      let nameAr = parsed?.name_ar?.trim();
      let englishName = parsed?.english_name?.trim();

      if (!slug || !nameAr) {
        console.log(`[CategoryDiscovery] LLM returned incomplete JSON for categoryId=${categoryId}: ${cleanJson.slice(0, 100)}`);
        goofishCategoryDiscoveryInProgress.delete(categoryId);
        return null;
      }

      slug = normalizeCategorySlug(slug);

      let category = categoryBySlug.get(slug);
      if (!category) {
        category = {
          slug,
          name_ar: nameAr,
          english_name: englishName || slug.replace(/_/g, ' '),
          aliases: [englishName || slug.replace(/_/g, ' ')],
        };
        categoryBySlug.set(slug, category);
        await saveNewCategoryToSeed(category);
        console.log(`[CategoryDiscovery] Created NEW category "${slug}" (${nameAr}) for categoryId=${categoryId}`);
      } else {
        console.log(`[CategoryDiscovery] Mapped categoryId=${categoryId} to EXISTING "${slug}" (${category.name_ar})`);
      }

      GOOFISH_CATEGORY_ID_MAP.set(categoryId, slug);
      saveGoofishCategoryMap(GOOFISH_CATEGORY_ID_MAP);

      const result = { slug, name_ar: category.name_ar, source: 'auto_discovered' };
      goofishCategoryDiscoveryCache.set(categoryId, result);
      goofishCategoryDiscoveryInProgress.delete(categoryId);
      return result;
    } catch (err) {
      console.warn(`[CategoryDiscovery] Failed for categoryId=${categoryId}: ${err.message}`);
      goofishCategoryDiscoveryInProgress.delete(categoryId);
      return null;
    }
  }

  try {
    let processed = 0;
    if (resetProgress) {
      try {
        await fs.unlink(progressFilePath);
      } catch {}
    }

    const resumeProgress = await readProgress(progressFilePath);
    let lastId = Math.max(startId, resumeProgress.lastId);
    if (lastId > 0) {
      console.log(`Resuming from product id > ${lastId} (progress file: ${progressFilePath})`);
    } else {
      console.log(`Starting from the first product in the database (progress file: ${progressFilePath})`);
    }
    heartbeat = setInterval(async () => {
      try { await writeProgress(progressFilePath, { lastId }); } catch {}
    }, heartbeatMs);

    const dbReady = await waitForDbReady(dbWaitMs, retryCount, queryTimeoutMs, retryBackoffMs, progressFilePath, lastId);
    if (!dbReady) {
      console.error('Database was not reachable within the wait window. Exiting.');
      if (heartbeat) clearInterval(heartbeat);
      return;
    }

    await withRetry(
      () => prisma.$executeRawUnsafe(`SET statement_timeout TO ${Math.max(queryTimeoutMs, updateTimeoutMs)}`),
      'set statement_timeout',
      retryCount,
      Math.max(queryTimeoutMs, updateTimeoutMs),
      retryBackoffMs
    );
    
    if (forceAll) {
      console.log('FORCE MODE: Processing ALL products (ignoring existing embeddings)');
    }
    if (testOnly) {
      console.log('TEST MODE: Fetching only one batch and exiting (no embedding).');
    }

    while (processed < maxItems) {
      const ready = await waitForDbReady(dbWaitMs, retryCount, queryTimeoutMs, retryBackoffMs, progressFilePath, lastId);
      if (!ready) {
        console.error('Database was not reachable within the wait window. Exiting.');
        break;
      }
      const remaining = maxItems - processed;
      const take = Math.min(batchSize, remaining);
      
      const whereClause = forceAll
        ? `WHERE id > ${lastId}`
        : `WHERE id > ${lastId}
            AND (
              "imageEmbedding" IS NULL
              OR EXISTS (
                SELECT 1
                FROM "ProductImage" pi
                WHERE pi."productId" = "Product".id
                  AND pi."order" < ${MAX_PRODUCT_IMAGE_EMBEDDINGS}
                  AND pi."imageEmbedding" IS NULL
              )
            )`;

      console.log(`Fetching next batch with lastId=${lastId}...`);
      const rows = await withRetry(
        () => prisma.$queryRawUnsafe(`
          SELECT id, image, name FROM "Product" 
          ${whereClause} 
          ORDER BY id ASC 
          LIMIT ${take}
        `),
        'fetch products',
        retryCount,
        queryTimeoutMs,
        retryBackoffMs
      );
      
      const products = Array.isArray(rows) ? rows : [];
      if (products.length === 0) {
         console.log('No more products to process.');
         break;
      }

      console.log(`Processing batch of ${products.length} products starting from ID ${products[0].id}...`);

      if (testOnly) {
        lastId = products[products.length - 1].id;
        await writeProgress(progressFilePath, { lastId });
        console.log('TEST MODE: Batch fetch OK. Exiting.');
        break;
      }

      for (let i = 0; i < products.length; i += concurrency) {
        const chunk = products.slice(i, i + concurrency);
        if (pingEveryChunk) {
          await withRetry(
            () => prisma.$queryRawUnsafe('SELECT 1'),
            'db ping',
            retryCount,
            queryTimeoutMs,
            retryBackoffMs
          );
        }
        if (reconnectEveryChunk) {
          try { await prisma.$disconnect(); } catch {}
          await withRetry(() => prisma.$connect(), 'reconnect', retryCount, queryTimeoutMs, retryBackoffMs);
        }
        await Promise.all(chunk.map(async (product) => {
          try {
            const imageUrl = String(product.image || '').trim();
            const productLabel = formatProductLabel(product);
            const result = await ensureProductImageEmbeddings({
              prisma,
              productId: product.id,
              productName: product.name || null,
              fallbackImageUrl: imageUrl,
              runDb: (operation, label) => withRetry(
                operation,
                label,
                retryCount,
                updateTimeoutMs,
                retryBackoffMs
              ),
              logger: console,
            });
            if (result.embeddedCount === 0) {
              console.log(`Skipping ${productLabel}: No embeddable product images`);
              return;
            }

            if (assignCategories && categoryEmbeddings.length > 0) {
              try {
                // Fast path: Check Goofish categoryId from metadata or purchaseUrl
                const goofishCategoryId = product.aiMetadata?.goofishCategoryId
                  || extractGoofishCategoryId(product.purchaseUrl || '');
                if (goofishCategoryId && GOOFISH_CATEGORY_ID_MAP.has(goofishCategoryId)) {
                  const mappedSlug = GOOFISH_CATEGORY_ID_MAP.get(goofishCategoryId);
                  const cat = categoryBySlug.get(mappedSlug);
                  if (cat) {
                    const metadataPatch = JSON.stringify({
                      categorySlug: cat.slug,
                      categoryNameAr: cat.name_ar,
                      categoryScore: 100,
                      categoryConfidence: 'high',
                      categorySource: 'goofish_category_id',
                      goofishCategoryId,
                      categoryAssignedAt: new Date().toISOString()
                    });
                    await withRetry(
                      () => prisma.$executeRawUnsafe(`
                        UPDATE "Product"
                        SET "aiMetadata" = COALESCE("aiMetadata", '{}'::jsonb) || $2::jsonb
                        WHERE id = $1
                      `, product.id, metadataPatch),
                      'update category (goofish fast path)',
                      retryCount,
                      updateTimeoutMs,
                      retryBackoffMs
                    );
                    console.log(`Category Assigned (Goofish fast path): ${productLabel} -> ${cat.slug} (categoryId=${goofishCategoryId})`);
                    processed += 1;
                    return; // Skip all embedding/LLM logic
                  }
                }

                // Unknown Goofish categoryId — auto-discover using LLM
                if (goofishCategoryId && !GOOFISH_CATEGORY_ID_MAP.has(goofishCategoryId)) {
                  console.log(`[Category] Unknown Goofish categoryId=${goofishCategoryId} for ${productLabel} — auto-discovering...`);
                  const discovered = await autoDiscoverGoofishCategory(goofishCategoryId);
                  if (discovered && GOOFISH_CATEGORY_ID_MAP.has(goofishCategoryId)) {
                    const mappedSlug = GOOFISH_CATEGORY_ID_MAP.get(goofishCategoryId);
                    const cat = categoryBySlug.get(mappedSlug);
                    if (cat) {
                      const metadataPatch = JSON.stringify({
                        categorySlug: cat.slug,
                        categoryNameAr: cat.name_ar,
                        categoryScore: 100,
                        categoryConfidence: 'high',
                        categorySource: 'goofish_category_id_auto',
                        goofishCategoryId,
                        categoryAssignedAt: new Date().toISOString()
                      });
                      await withRetry(
                        () => prisma.$executeRawUnsafe(`
                          UPDATE "Product"
                          SET "aiMetadata" = COALESCE("aiMetadata", '{}'::jsonb) || $2::jsonb
                          WHERE id = $1
                        `, product.id, metadataPatch),
                        'update category (goofish auto-discovered)',
                        retryCount,
                        updateTimeoutMs,
                        retryBackoffMs
                      );
                      console.log(`Category Assigned (Goofish auto-discovered): ${productLabel} -> ${cat.slug} (categoryId=${goofishCategoryId})`);
                      processed += 1;
                      return;
                    }
                  }
                }

                // Use averaged vector from ALL images (more representative than just first image)
                const vecArray = result.averagedVector
                  || (result.mainVector ? JSON.parse(result.mainVector) : null);
                if (!vecArray) throw new Error('No embedding vector available');
                
                let bestCat = null;
                let bestScore = -1;
                
                for (const { cat, vec } of categoryEmbeddings) {
                  const score = cosineSimilarity(vecArray, vec);
                  if (score > bestScore) {
                    bestScore = score;
                    bestCat = cat;
                  }
                }
                
                let categorySource = 'vision_zero_shot';
                let categoryConfidence = bestScore >= categoryVerifyThreshold ? 'high' : 'medium';
                const pctScore = Math.round(bestScore * 100);
                
                // Helper: resolve LLM-generated category — reuse if slug already known
                const resolveLLMCategory = async (newCat, label) => {
                  const normalizedSlug = normalizeCategorySlug(newCat.slug);
                  const existing = categoryBySlug.get(normalizedSlug);
                  if (existing) {
                    console.log(`Reusing existing category "${normalizedSlug}" (from ${newCat.slug}) for ${label}`);
                    return { cat: existing, score: 0.95, source: 'dynamic_reused', confidence: 'high' };
                  }
                  // Truly new — add text embedding to live index and save to seed
                  const englishAlias = (newCat.aliases || [])[0] || newCat.slug.replace(/_/g, ' ');
                  const textVec = await embedText(`a photo of ${englishAlias}`);
                  if (textVec && textVec.length === 512 && !textVec.every(v => v === 0)) {
                    categoryEmbeddings.push({ cat: newCat, vec: textVec });
                  }
                  categoryBySlug.set(normalizedSlug, newCat);
                  console.log(`Created new category "${newCat.slug}" (${newCat.name_ar})`);
                  saveNewCategoryToSeed(newCat).catch(console.error);
                  return { cat: newCat, score: 0.99, source: 'dynamic_generated', confidence: 'high' };
                };
                
                // ── THREE-TIER CATEGORY ASSIGNMENT ──
                // Tier 1: ≥ 50% — high confidence, accept embedding match directly
                // Tier 2: 35–50% — uncertain, verify with LLM using product name
                // Tier 3: < 35% — low confidence, generate category from scratch via LLM
                
                if (bestScore >= categoryVerifyThreshold) {
                  // Tier 1: high confidence — accept directly, BUT cross-check with product name text embedding
                  // This catches image-only false positives (e.g. round ball image matches shoe centroid at 93%)
                  let textMismatch = false;
                  if (product.name && textCategoryEmbeddings.length > 0) {
                    try {
                      const nameVec = await embedText(product.name);
                      let textBestCat = null;
                      let textBestScore = -1;
                      for (const { cat, vec } of textCategoryEmbeddings) {
                        const score = cosineSimilarity(nameVec, vec);
                        if (score > textBestScore) {
                          textBestScore = score;
                          textBestCat = cat;
                        }
                      }
                      if (textBestCat && textBestCat.slug !== bestCat.slug && textBestScore > 0.25) {
                        textMismatch = true;
                        console.log(`Image→${bestCat.slug} (${pctScore}%) but text→${textBestCat.slug} (${Math.round(textBestScore*100)}%). Cross-checking with LLM...`);
                        const verified = await verifyCategoryMatch(product.name, bestCat.slug, bestCat.name_ar);
                        if (verified) {
                          console.log(`LLM confirmed: "${bestCat.slug}" is correct despite text mismatch`);
                          categorySource = 'vision_text_cross_verified';
                          textMismatch = false; // confirmed correct, accept
                        } else {
                          console.log(`LLM rejected "${bestCat.slug}". Generating correct category...`);
                          const newCat = await generateMissingCategory(product.name);
                          if (newCat) {
                            const resolved = await resolveLLMCategory(newCat, productLabel);
                            bestCat = resolved.cat;
                            bestScore = resolved.score;
                            categorySource = resolved.source;
                            categoryConfidence = resolved.confidence;
                          } else {
                            bestCat = { slug: 'other', name_ar: 'أخرى' };
                            categorySource = 'fallback_other';
                            categoryConfidence = 'low';
                          }
                          textMismatch = false; // resolved, skip normal tier flow
                        }
                      }
                    } catch {}
                  }
                  if (!textMismatch) {
                    console.log(`High match (${pctScore}%) for ${productLabel} -> ${bestCat.slug} (accepted)`);
                  }
                  
                } else if (bestScore >= categoryNewCategoryThreshold) {
                  // Tier 2: uncertain zone — embedding found a candidate, verify with product name
                  console.log(`Uncertain match (${pctScore}%) for ${productLabel} -> ${bestCat.slug}. Verifying with LLM...`);
                  const verified = await verifyCategoryMatch(product.name, bestCat.slug, bestCat.name_ar);
                  if (verified) {
                    console.log(`LLM verified: "${bestCat.slug}" is correct for ${productLabel}`);
                    categorySource = 'vision_llm_verified';
                    categoryConfidence = 'high';
                  } else {
                    console.log(`LLM rejected "${bestCat.slug}" for ${productLabel}. Generating correct category...`);
                    const newCat = await generateMissingCategory(product.name);
                    if (newCat) {
                      const resolved = await resolveLLMCategory(newCat, productLabel);
                      bestCat = resolved.cat;
                      bestScore = resolved.score;
                      categorySource = resolved.source;
                      categoryConfidence = resolved.confidence;
                    } else {
                      bestCat = { slug: 'other', name_ar: 'أخرى' };
                      categorySource = 'fallback_other';
                      categoryConfidence = 'low';
                    }
                  }
                  
                } else {
                  // Tier 3: low confidence — generate from scratch
                  console.log(`Low match (${pctScore}%) for ${productLabel}. Generating category dynamically...`);
                  const newCat = await generateMissingCategory(product.name);
                  if (newCat) {
                    const resolved = await resolveLLMCategory(newCat, productLabel);
                    bestCat = resolved.cat;
                    bestScore = resolved.score;
                    categorySource = resolved.source;
                    categoryConfidence = resolved.confidence;
                  } else {
                    bestCat = { slug: 'other', name_ar: 'أخرى' };
                    categorySource = 'fallback_other';
                    categoryConfidence = 'low';
                  }
                }
                
                if (bestCat) {
                  // Add this product's image vector to the category's live centroid ONLY
                  // if the assignment was verified or generated — never for auto-accepted Tier 1,
                  // because a misclassified product would poison the centroid and cause a
                  // runaway feedback loop (e.g. everything → cutlery_sets).
                  const trustedSources = new Set([
                    'vision_llm_verified',
                    'vision_text_cross_verified',
                    'dynamic_generated',
                    'dynamic_reused'
                  ]);
                  if (bestCat.slug !== 'other' && trustedSources.has(categorySource)) {
                    categoryEmbeddings.push({ cat: bestCat, vec: vecArray });
                  }
                  
                  const metadataPatch = JSON.stringify({
                    categorySlug: bestCat.slug,
                    categoryNameAr: bestCat.name_ar,
                    categoryScore: Math.round(bestScore * 100),
                    categoryConfidence,
                    categorySource,
                    categoryAssignedAt: new Date().toISOString()
                  });
                  
                  await withRetry(
                    () => prisma.$executeRawUnsafe(`
                      UPDATE "Product"
                      SET "aiMetadata" = COALESCE("aiMetadata", '{}'::jsonb) || $2::jsonb
                      WHERE id = $1
                    `, product.id, metadataPatch),
                    'update category',
                    retryCount,
                    updateTimeoutMs,
                    retryBackoffMs
                  );
                  console.log(`Category Assigned: ${productLabel} -> ${bestCat.slug} (${Math.round(bestScore * 100)}% match)`);
                }
              } catch (catErr) {
                console.error(`Failed to assign category for ${productLabel}: ${catErr?.message || catErr}`);
              }
            }

            processed += 1;
            console.log(`Success: ${productLabel} (${result.embeddedCount} image embedding${result.embeddedCount === 1 ? '' : 's'})`);
            if (processed % 25 === 0) {
              console.log(`Embedded ${processed} products (last successful=${productLabel})`);
            }
            lastId = product.id;
            if (processed % progressEvery === 0) {
              try { await writeProgress(progressFilePath, { lastId }); } catch {}
            }
          } catch (err) {
            console.error(`Unexpected error for ${formatProductLabel(product)}: ${err?.message || err}`);
            lastId = product.id;
            if (processed % progressEvery === 0) {
              try { await writeProgress(progressFilePath, { lastId }); } catch {}
            }
          }
        }));
        
        // Update progress with the last ID in the chunk
        lastId = chunk[chunk.length - 1].id;
        try {
            await writeProgress(progressFilePath, { lastId });
        } catch (err) {
            console.error(`Failed to write progress file: ${err?.message || err}`);
        }
        
        await sleep(100);
        if (processed >= maxItems) break;
      }
    }

    if (heartbeat) clearInterval(heartbeat);
    console.log(`Done. Embedded image vectors for ${processed} products.`);
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
