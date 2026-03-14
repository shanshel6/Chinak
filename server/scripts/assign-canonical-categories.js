import prisma from '../prismaClient.js';
import { canonicalCategories, mapToCanonicalCategory, normalizeCategoryText } from '../services/categoryCanonicalService.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const categoryBySlug = new Map(canonicalCategories.map((category) => [category.slug, category]));
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const checkpointPath = path.join(__dirname, '.assign-canonical-categories.checkpoint.json');

const buildCategoryMatchers = () => canonicalCategories.map((category) => {
  const aliases = [category.name_ar, ...(Array.isArray(category.aliases) ? category.aliases : [])]
    .map((value) => normalizeCategoryText(value))
    .filter(Boolean);
  const aliasSet = new Set(aliases);
  const compactAliasSet = new Set(aliases.map((value) => value.replace(/\s+/g, '')).filter(Boolean));
  return {
    slug: category.slug,
    name_ar: category.name_ar,
    aliasSet,
    compactAliasSet
  };
});

const categoryMatchers = buildCategoryMatchers();
const DEFAULT_BATCH_SIZE = 200;
const DEFAULT_QUERY_TIMEOUT_MS = 60000;
const heartbeatMs = 15000;
const DEFAULT_ALL_MODE_FETCH_CHUNK_SIZE = 5;

const scoreFromKeyword = (normalizedKeyword, compactKeyword, scores) => {
  // Direct match using the service's lookup
  const direct = mapToCanonicalCategory(normalizedKeyword) || mapToCanonicalCategory(compactKeyword);
  if (direct) {
    scores.set(direct, (scores.get(direct) || 0) + 100);
    return;
  }

  // Fallback: Check if any category alias is contained within the keyword (substring match)
  for (const matcher of categoryMatchers) {
    let score = scores.get(matcher.slug) || 0;
    
    // Strict inclusion: Check if alias is part of the keyword
    for (const alias of matcher.aliasSet) {
      if (alias.length < 3) continue; // Skip very short aliases
      if (normalizedKeyword.includes(alias)) {
        score += 20;
      }
    }
    
    if (score > (scores.get(matcher.slug) || 0)) {
      scores.set(matcher.slug, score);
    }
  }
};

const classifyProduct = (product) => {
  const rawKeywords = Array.isArray(product.keywords) ? product.keywords : [];
  const normalizedKeywords = rawKeywords
    .map((value) => normalizeCategoryText(value))
    .filter(Boolean);
  const scores = new Map();
  for (const normalizedKeyword of normalizedKeywords) {
    const compactKeyword = normalizedKeyword.replace(/\s+/g, '');
    if (!compactKeyword) continue;
    scoreFromKeyword(normalizedKeyword, compactKeyword, scores);
  }
  if (scores.size === 0) {
    return { slug: 'other', score: 0 };
  }
  const ranked = Array.from(scores.entries()).sort((a, b) => b[1] - a[1]);
  return { slug: ranked[0][0], score: ranked[0][1] };
};

const updateProductCategory = async (product, categorySlug, score) => {
  const category = categoryBySlug.get(categorySlug) || categoryBySlug.get('other');
  const nextMetadata = {
    categorySlug: category?.slug || 'other',
    categoryNameAr: category?.name_ar || 'أخرى',
    categoryScore: score,
    categorySource: 'canonical_keywords',
    categoryAssignedAt: new Date().toISOString()
  };
  const metadataPatch = JSON.stringify(nextMetadata);
  const changedRows = await prisma.$executeRawUnsafe(`
    UPDATE "Product"
    SET "aiMetadata" = COALESCE("aiMetadata", '{}'::jsonb) || $2::jsonb
    WHERE id = $1
  `, product.id, metadataPatch);
  return Number(changedRows || 0) > 0;
};

const withTimeout = async (promise, timeoutMs, label) => {
  let timeoutId;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      })
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
};

const parseArgNumber = (name, fallback) => {
  const raw = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (!raw) return fallback;
  const value = Number.parseInt(raw.split('=').slice(1).join('='), 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const parseArgValue = (name) => {
  const raw = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (!raw) return null;
  return String(raw.split('=').slice(1).join('=') || '').trim();
};

const hasFlag = (name) => process.argv.includes(name);

const resolveBatchSize = () => {
  const raw = parseArgValue('--batch-size');
  if (!raw) return DEFAULT_BATCH_SIZE;
  if (raw.toLowerCase() === 'all' || raw.toLowerCase() === 'unlimited') return null;
  const numeric = Number.parseInt(raw, 10);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : DEFAULT_BATCH_SIZE;
};

const readCheckpoint = () => {
  try {
    if (!fs.existsSync(checkpointPath)) return null;
    const raw = fs.readFileSync(checkpointPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
};

const writeCheckpoint = (state) => {
  fs.writeFileSync(checkpointPath, JSON.stringify(state, null, 2));
};

const deleteCheckpoint = () => {
  try {
    if (fs.existsSync(checkpointPath)) fs.unlinkSync(checkpointPath);
  } catch {}
};

const run = async () => {
  const batchSize = resolveBatchSize();
  const maxProducts = parseArgNumber('--max-products', 0);
  const queryTimeoutMs = parseArgNumber('--timeout-ms', DEFAULT_QUERY_TIMEOUT_MS);
  const allModeChunkSize = parseArgNumber('--all-chunk', DEFAULT_ALL_MODE_FETCH_CHUNK_SIZE);
  const resetCheckpoint = hasFlag('--reset-checkpoint');
  if (resetCheckpoint) deleteCheckpoint();
  const checkpoint = resetCheckpoint ? null : readCheckpoint();
  let lastId = Number(checkpoint?.lastId || 0);
  if (!Number.isFinite(lastId) || lastId < 0) lastId = 0;
  const batchSizeLabel = batchSize === null ? 'all' : String(batchSize);
  console.log(`[category-assign] start batchSize=${batchSizeLabel} maxProducts=${maxProducts || 'all'} timeoutMs=${queryTimeoutMs} resumeFromId=${lastId} allModeChunk=${allModeChunkSize}`);
  await withTimeout(prisma.$connect(), queryTimeoutMs, 'prisma connect');
  const total = await withTimeout(prisma.$queryRawUnsafe(`
    SELECT count(*)::int AS total
    FROM "Product"
    WHERE "isActive" = true AND status = 'PUBLISHED'
  `), queryTimeoutMs, 'count products');
  const dbTotalCount = Number(Array.isArray(total) && total[0]?.total ? total[0].total : 0);
  const remainingRows = await withTimeout(prisma.$queryRawUnsafe(`
    SELECT count(*)::int AS total
    FROM "Product"
    WHERE "isActive" = true AND status = 'PUBLISHED' AND id > $1
  `, lastId), queryTimeoutMs, 'count remaining products');
  const remainingCount = Number(Array.isArray(remainingRows) && remainingRows[0]?.total ? remainingRows[0].total : 0);
  const totalCount = maxProducts > 0 ? Math.min(remainingCount, maxProducts) : remainingCount;
  if (totalCount <= 0) {
    console.log('[category-assign] no products to process');
    deleteCheckpoint();
    return;
  }
  const fetchChunkSize = batchSize === null ? Math.min(allModeChunkSize, totalCount) : batchSize;
  let processed = 0;
  let updated = 0;
  let keepGoing = true;
  const heartbeat = setInterval(() => {
    console.log(`[category-assign] heartbeat processed=${processed}/${totalCount} updated=${updated} lastId=${lastId} chunk=${fetchChunkSize}`);
  }, heartbeatMs);
  try {
    while (keepGoing && processed < totalCount) {
      const remaining = totalCount - processed;
      const takeCount = Math.min(fetchChunkSize, remaining);
      console.log(`[category-assign] fetching_batch afterId=${lastId} take=${takeCount}`);
      const rows = await withTimeout(prisma.$queryRawUnsafe(`
        SELECT id, "keywords"
        FROM "Product"
        WHERE "isActive" = true
          AND status = 'PUBLISHED'
          AND id > $1
        ORDER BY id ASC
        LIMIT $2
      `, lastId, takeCount), queryTimeoutMs, 'fetch batch');
      console.log(`[category-assign] fetched_batch count=${Array.isArray(rows) ? rows.length : 0}`);
      if (!Array.isArray(rows) || rows.length === 0) {
        keepGoing = false;
        break;
      }
      for (const product of rows) {
        processed += 1;
        lastId = Number(product.id) || lastId;
        const { slug, score } = classifyProduct(product);
        const changed = await withTimeout(updateProductCategory(product, slug, score), queryTimeoutMs, `update product ${product.id}`);
        if (changed) updated += 1;
        console.log(`[category-assign] category_success productId=${product.id} slug=${slug} score=${score} changed=${changed ? 'yes' : 'no'}`);
        if (processed % 50 === 0 || processed === totalCount) {
          console.log(`[category-assign] progress processed=${processed}/${totalCount} updated=${updated}`);
          writeCheckpoint({
            lastId,
            processedInCurrentRun: processed,
            updatedInCurrentRun: updated,
            batchSize: batchSizeLabel,
            updatedAt: new Date().toISOString()
          });
        }
      }
      console.log(`[category-assign] batch_done processed=${processed}/${totalCount} updated=${updated} lastId=${lastId}`);
      writeCheckpoint({
        lastId,
        processedInCurrentRun: processed,
        updatedInCurrentRun: updated,
        batchSize: batchSizeLabel,
        updatedAt: new Date().toISOString()
      });
    }
  } finally {
    clearInterval(heartbeat);
  }
  console.log(`[category-assign] done processed=${processed} updated=${updated}`);
  deleteCheckpoint();
};

run()
  .catch((error) => {
    console.error('[category-assign] failed', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
