import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import readline from 'readline';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { Prisma, PrismaClient } from '@prisma/client';
import axios from 'axios';
import { embedImage } from '../services/clipService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.join(__dirname, '..', '.env');
dotenv.config({ path: envPath });

import { canonicalCategories, mapToCanonicalCategory, normalizeCategoryText } from '../services/categoryCanonicalService.js';

const categoryBySlug = new Map(canonicalCategories.map((category) => [category.slug, category]));

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

const classifyProduct = (keywords) => {
  const rawKeywords = Array.isArray(keywords) ? keywords : [];
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

const assignCategoryToProduct = async (productId, keywords) => {
  const { slug, score } = classifyProduct(keywords);
  const category = categoryBySlug.get(slug) || categoryBySlug.get('other');
  const nextMetadata = {
    categorySlug: category?.slug || 'other',
    categoryNameAr: category?.name_ar || 'أخرى',
    categoryScore: score,
    categorySource: 'canonical_keywords',
    categoryAssignedAt: new Date().toISOString()
  };
  const metadataPatch = JSON.stringify(nextMetadata);
  await prisma.$executeRawUnsafe(`
    UPDATE "Product"
    SET "aiMetadata" = COALESCE("aiMetadata", '{}'::jsonb) || $2::jsonb
    WHERE id = $1
  `, productId, metadataPatch);
  console.log(`[Category] Assigned product ${productId} to ${slug} (${category?.name_ar}) score=${score}`);
};
const CNY_TO_IQD_RATE = 200;

const withDbParams = (url) => {
  if (!url) return '';
  const parsed = new URL(url);
  if (!parsed.searchParams.has('connection_limit')) parsed.searchParams.set('connection_limit', '3');
  if (!parsed.searchParams.has('pool_timeout')) parsed.searchParams.set('pool_timeout', '120');
  if (!parsed.searchParams.has('connect_timeout')) parsed.searchParams.set('connect_timeout', '20');
  if (!parsed.searchParams.has('keepalives')) parsed.searchParams.set('keepalives', '1');
  if (!parsed.searchParams.has('keepalives_idle')) parsed.searchParams.set('keepalives_idle', '30');
  if (!parsed.searchParams.has('keepalives_interval')) parsed.searchParams.set('keepalives_interval', '10');
  if (!parsed.searchParams.has('keepalives_count')) parsed.searchParams.set('keepalives_count', '3');
  if (!parsed.searchParams.has('sslmode')) parsed.searchParams.set('sslmode', 'require');
  return parsed.toString();
};

const prismaDbUrl = withDbParams(
  String(process.env.GOOFISH_DATABASE_URL || process.env.DATABASE_URL || '').trim()
);

// We must override the direct connection parameters specifically for Prisma
if (process.env.GOOFISH_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.GOOFISH_DATABASE_URL;
}

const createPrismaClient = () => (prismaDbUrl
  ? new PrismaClient({ datasources: { db: { url: prismaDbUrl } } })
  : new PrismaClient());
let prisma = createPrismaClient();
function calculatePriceMultiplier(basePriceIQD) {
  return 1.25;
}

const SILICONFLOW_API_KEY = String(process.env.SILICONFLOW_API_KEY || '').trim();
const DISABLE_DB_WRITE = String(process.env.GOOFISH_DISABLE_DB_WRITE || '').toLowerCase() === 'true';
const configuredMaxProducts = parseInt(process.env.GOOFISH_MAX_PRODUCTS || '', 10);
const MAX_PRODUCTS_TO_PROCESS = Number.isFinite(configuredMaxProducts) && configuredMaxProducts > 0
  ? configuredMaxProducts
  : Number.POSITIVE_INFINITY;
const OUTPUT_JSON = String(process.env.GOOFISH_OUTPUT_JSON || '').toLowerCase() === 'true';
const REQUIRE_DB_WRITE = String(process.env.GOOFISH_REQUIRE_DB_WRITE || 'true').toLowerCase() !== 'false';
const AI_ONLY_TERMS = String(process.env.GOOFISH_AI_ONLY_TERMS || '').toLowerCase() === 'true';
const TRANSLATION_CACHE_PATH = path.join(__dirname, 'goofish-translation-cache.json');
const TERM_DETAIL_LINKS_PATH = path.join(__dirname, 'goofish-term-detail-links.json');
const BATCH_LINKS_PATH = path.join(__dirname, 'goofish-batch-links.json');
const ITEMS_PER_SEARCH = Math.max(1, parseInt(process.env.GOOFISH_ITEMS_PER_SEARCH || '150', 10) || 150);
const GOOFISH_LINKS_PER_TERM = Math.max(1, parseInt(process.env.GOOFISH_LINKS_PER_TERM || '90', 10) || 90);
const GOOFISH_TERMS_PER_BATCH = Math.max(1, parseInt(process.env.GOOFISH_TERMS_PER_BATCH || '50', 10) || 50);
const KEYWORDS_PER_PRODUCT = Math.max(10, Math.min(50, parseInt(process.env.GOOFISH_KEYWORDS_PER_PRODUCT || '30', 10) || 30));
const GOOFISH_AI_TITLE_MAX_CHARS = Math.max(40, parseInt(process.env.GOOFISH_AI_TITLE_MAX_CHARS || '140', 10) || 140);
const GOOFISH_AI_SECOND_PASS_DESCRIPTION = String(process.env.GOOFISH_AI_SECOND_PASS_DESCRIPTION || 'false').toLowerCase() === 'true';
const GOOFISH_TRANSLATION_CACHE_FLUSH_EVERY = Math.max(1, parseInt(process.env.GOOFISH_TRANSLATION_CACHE_FLUSH_EVERY || '20', 10) || 20);
const GOOFISH_DB_SAVE_TIMEOUT_MS = Math.max(5000, parseInt(process.env.GOOFISH_DB_SAVE_TIMEOUT_MS || '45000', 10) || 45000);
const GOOFISH_DB_SAVE_RETRIES = Math.max(1, parseInt(process.env.GOOFISH_DB_SAVE_RETRIES || '1', 10) || 1);
const GOOFISH_DB_SAVE_FATAL_ON_RETRY_EXHAUST = String(process.env.GOOFISH_DB_SAVE_FATAL_ON_RETRY_EXHAUST || 'true').toLowerCase() !== 'false';
const GOOFISH_DB_CONNECT_TIMEOUT_MS = Math.max(8000, parseInt(process.env.GOOFISH_DB_CONNECT_TIMEOUT_MS || '25000', 10) || 25000);
const GOOFISH_DB_CONNECT_RETRIES = Math.max(1, parseInt(process.env.GOOFISH_DB_CONNECT_RETRIES || '8', 10) || 8);
const GOOFISH_DB_CONNECT_RETRY_DELAY_MS = Math.max(500, parseInt(process.env.GOOFISH_DB_CONNECT_RETRY_DELAY_MS || '5000', 10) || 5000);
const GOOFISH_DB_CONNECT_VERIFY_PING = String(process.env.GOOFISH_DB_CONNECT_VERIFY_PING || 'false').toLowerCase() === 'true';
const GOOFISH_DB_ENGINE_FAILURE_THRESHOLD = Math.max(1, parseInt(process.env.GOOFISH_DB_ENGINE_FAILURE_THRESHOLD || '3', 10) || 3);
const GOOFISH_DB_ENGINE_FAILURE_WINDOW_MS = Math.max(1000, parseInt(process.env.GOOFISH_DB_ENGINE_FAILURE_WINDOW_MS || '120000', 10) || 120000);
const GOOFISH_DB_ENGINE_COOLDOWN_MS = Math.max(1000, parseInt(process.env.GOOFISH_DB_ENGINE_COOLDOWN_MS || '45000', 10) || 45000);
const GOOFISH_DB_FORCE_RECONNECT_MIN_INTERVAL_MS = Math.max(1000, parseInt(process.env.GOOFISH_DB_FORCE_RECONNECT_MIN_INTERVAL_MS || '45000', 10) || 45000);
const GOOFISH_PROGRESS_STALL_TIMEOUT_MS = Math.max(30000, parseInt(process.env.GOOFISH_PROGRESS_STALL_TIMEOUT_MS || '120000', 10) || 120000);
const GOOFISH_PROGRESS_WATCHDOG_INTERVAL_MS = Math.max(5000, parseInt(process.env.GOOFISH_PROGRESS_WATCHDOG_INTERVAL_MS || '10000', 10) || 10000);
const GOOFISH_PROGRESS_RECOVERY_COOLDOWN_MS = Math.max(5000, parseInt(process.env.GOOFISH_PROGRESS_RECOVERY_COOLDOWN_MS || '30000', 10) || 30000);
const GOOFISH_PROGRESS_STALL_MAX_RECOVERS = Math.max(1, parseInt(process.env.GOOFISH_PROGRESS_STALL_MAX_RECOVERS || '3', 10) || 3);
const GOOFISH_PROGRESS_STALL_HARD_EXIT_MS = Math.max(
  GOOFISH_PROGRESS_STALL_TIMEOUT_MS,
  parseInt(
    process.env.GOOFISH_PROGRESS_STALL_HARD_EXIT_MS || String(GOOFISH_PROGRESS_STALL_TIMEOUT_MS * 2),
    10
  ) || (GOOFISH_PROGRESS_STALL_TIMEOUT_MS * 2)
);
const parsedRecoverWaitMs = parseInt(process.env.GOOFISH_DB_RECOVER_WAIT_MS || '120000', 10);
const GOOFISH_DB_RECOVER_WAIT_MS = Number.isFinite(parsedRecoverWaitMs) ? Math.max(0, parsedRecoverWaitMs) : 120000;
const GOOFISH_DB_RECOVER_PING_TIMEOUT_MS = Math.max(1000, parseInt(process.env.GOOFISH_DB_RECOVER_PING_TIMEOUT_MS || '12000', 10) || 12000);
const GOOFISH_DB_RECOVER_MAX_CYCLES_PER_OP = Math.max(0, parseInt(process.env.GOOFISH_DB_RECOVER_MAX_CYCLES_PER_OP || '1', 10) || 1);
const GOOFISH_PROCESS_LINK_TIMEOUT_MS = Math.max(30000, parseInt(process.env.GOOFISH_PROCESS_LINK_TIMEOUT_MS || '120000', 10) || 120000);
const GOOFISH_AI_CALL_TIMEOUT_MS = Math.max(5000, parseInt(process.env.GOOFISH_AI_CALL_TIMEOUT_MS || '15000', 10) || 15000);
const GOOFISH_AI_RETRY_MAX_ATTEMPTS = Math.max(1, parseInt(process.env.GOOFISH_AI_RETRY_MAX_ATTEMPTS || '2', 10) || 2);
const GOOFISH_AI_MODEL = String(process.env.GOOFISH_AI_MODEL || 'Qwen/Qwen3-14B').trim() || 'Qwen/Qwen3-14B';
const GOOFISH_ENABLE_TRANSLATION_RETRY = String(process.env.GOOFISH_ENABLE_TRANSLATION_RETRY || '').toLowerCase() === 'true';
const GOOFISH_SKIP_ON_TRANSLATION_FAILURE = String(process.env.GOOFISH_SKIP_ON_TRANSLATION_FAILURE || 'true').toLowerCase() !== 'false';
const GOOFISH_DB_SAVE_BACKOFF_MS = Math.max(200, parseInt(process.env.GOOFISH_DB_SAVE_BACKOFF_MS || '500', 10) || 500);
const GOOFISH_RESET_TERMS_ON_START = String(process.env.GOOFISH_RESET_TERMS_ON_START || '').toLowerCase() === 'true';
const GOOFISH_EMBED_USE_PRODUCT_NAME = String(process.env.GOOFISH_EMBED_USE_PRODUCT_NAME || 'true').toLowerCase() !== 'false';
const GOOFISH_SKIP_DETAILS_AFTER_TERM = String(process.env.GOOFISH_SKIP_DETAILS_AFTER_TERM || '').toLowerCase() === 'true';
const GOOFISH_DETAILS_ONLY = String(process.env.GOOFISH_DETAILS_ONLY || '').toLowerCase() === 'true';
const GOOFISH_DETAILS_LIMIT = Math.max(1, parseInt(process.env.GOOFISH_DETAILS_LIMIT || '3', 10) || 3);
const GOOFISH_DETAILS_IDS = String(process.env.GOOFISH_DETAILS_IDS || '')
  .split(',')
  .map((v) => Number.parseInt(v.trim(), 10))
  .filter((v) => Number.isFinite(v) && v > 0);
const UPDATE_EXISTING = String(process.env.GOOFISH_UPDATE_EXISTING || '').toLowerCase() === 'true';
const UPDATE_LIMIT = parseInt(process.env.GOOFISH_UPDATE_LIMIT || '', 10);
const UPDATE_START_ID = parseInt(process.env.GOOFISH_UPDATE_START_ID || '0', 10);
const UPDATE_BATCH_SIZE = Math.max(1, parseInt(process.env.GOOFISH_UPDATE_BATCH || '25', 10) || 25);
const UPDATE_DELAY_MIN = Math.max(0, parseInt(process.env.GOOFISH_UPDATE_DELAY_MIN || '800', 10) || 800);
const UPDATE_DELAY_MAX = Math.max(UPDATE_DELAY_MIN, parseInt(process.env.GOOFISH_UPDATE_DELAY_MAX || '1600', 10) || 1600);
const UPDATE_PROGRESS_EVERY = Math.max(1, parseInt(process.env.GOOFISH_UPDATE_PROGRESS_EVERY || '10', 10) || 10);
const UPDATE_PROGRESS_PATH = path.join(__dirname, 'goofish-update-existing-progress.json');
const UPDATE_RESET_PROGRESS = String(process.env.GOOFISH_UPDATE_RESET_PROGRESS || '').toLowerCase() === 'true';
const DEFAULT_SEARCH_TERMS = [
  '手机壳', '女包', '斜挎包', '连衣裙', '女鞋', '牛仔裤',
  '男士T恤', '运动鞋', '耳机', '蓝牙音箱', '智能手表', '充电宝',
  '化妆刷', '口红', '护肤套装', '床上四件套', '收纳盒', '厨房用品',
  '汽车香水', '儿童玩具', '瑜伽裤', '太阳镜', '首饰', '行李箱'
];
const SEARCH_TERMS_PATH = path.join(__dirname, 'goofish-search-terms.json');
const FOOD_BLACKLIST = [
  '食品', '零食', '水果', '蔬菜', '牛奶', '饮料', '咖啡', '茶',
  '面包', '零嘴', '饼干', '蛋糕', '方便面', '火锅', '调味',
  '大米', '米', '面', '肉', '海鲜', '酒', '啤酒', '葡萄酒'
];

const EXCLUDED_KEYWORDS = [
  '黄金', '足金', '千足金', '万足金', '18K金', '24K金', 'Au999', 'Au750', '真金', '赤金', '纯金', '金条', '金币', '金砖'
];

// Silver and other metals are OKAY now.
// Removed: '白银', '纯银', '足银', 'S925', '925银', 'Ag999', 'Ag925', '真银'

function isExcludedProduct(title) {
  if (!title) return false;
  const t = title.toUpperCase();
  return EXCLUDED_KEYWORDS.some(k => t.includes(k.toUpperCase()));
}

function isChineseTerm(text) {
  if (!text) return false;
  // A rough heuristic to check if the string has Chinese characters
  return /[\u4e00-\u9fa5]/.test(String(text));
}

function detectRealPriceFromTitle(title, currentPrice) {
  // DISABLED: Returning current price as requested
  return currentPrice;
}

const MAX_AI_ATTEMPTS = 3;
let dbReady = false;
let dbChecked = false;
let dbEngineFailureTimestamps = [];
let dbCircuitOpenUntil = 0;
let dbCircuitLastLogAt = 0;
let dbLastForceReconnectAt = 0;
let pipelineLastProgressAt = Date.now();
let pipelineLastProgressLabel = 'startup';
let pipelineWatchdogTimer = null;
let pipelineWatchdogReconnectInFlight = false;
let pipelineWatchdogLastRecoveryAt = 0;
let pipelineWatchdogLastStallLabel = '';
let pipelineWatchdogStallCount = 0;
let pipelineRestartScheduled = false;

if (process.env.NODE_ENV === 'production' && process.env.ALLOW_SCRAPER_IN_PROD !== 'true') {
  console.error('CRITICAL: Scraper is BLOCKED in production environment.');
  console.error('To run this script on the server, set ALLOW_SCRAPER_IN_PROD=true');
  process.exit(1);
}

// Simple SiliconFlow client using axios
async function callSiliconFlow(messages, temperature = 0.3, maxTokens = 100) {
  const apiKey = SILICONFLOW_API_KEY;
  if (!apiKey) return null;
  const maxAttempts = GOOFISH_AI_RETRY_MAX_ATTEMPTS;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      console.log(`[SiliconFlow] Request attempt ${attempt}/${maxAttempts} (timeout=${GOOFISH_AI_CALL_TIMEOUT_MS}ms)`);
      const startedAt = Date.now();
      const response = await axios.post('https://api.siliconflow.com/v1/chat/completions', {
        model: GOOFISH_AI_MODEL,
        messages,
        temperature,
        max_tokens: maxTokens,
        stream: false
      }, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        timeout: GOOFISH_AI_CALL_TIMEOUT_MS
      });
      console.log(`[SiliconFlow] Success in ${Date.now() - startedAt}ms`);
      return response.data.choices[0].message.content.trim();
    } catch (error) {
      const status = error?.response?.status;
      const isTimeout = String(error?.message || '').includes('timeout');
      // Retry on 429 (Rate Limit), 503 (Service Unavailable), and 500 (Internal Server Error)
      if (status === 429 || status === 503 || status === 500 || isTimeout) {
        console.warn(`SiliconFlow API Error (${status || 'timeout'}), retrying (attempt ${attempt}/${maxAttempts})...`);
        const waitMs = Math.min(5000, 1000 * attempt);
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        continue;
      }
      console.error('SiliconFlow API Error:', error.message);
      if (error.response?.data) {
        console.error('API Response Data:', JSON.stringify(error.response.data).slice(0, 200));
      }
      return null;
    }
  }
  console.error('SiliconFlow API Error: rate limit');
  return null;
}

function hasArabic(value) {
  return /[\u0600-\u06FF]/.test(String(value || ''));
}

function cleanAiText(value) {
  return String(value || '')
    .replace(/\*\*/g, '')
    .replace(/[`"'']/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isLowQualityTranslationText(value, minArabicChars = 3) {
  const text = cleanAiText(sanitizeTranslationText(value));
  if (!text) return true;
  const arabicChars = (text.match(/[\u0600-\u06FF]/g) || []).length;
  if (arabicChars < minArabicChars) return true;
  if (/([\u0600-\u06FFA-Za-z])\1{6,}/u.test(text)) return true;
  const normalizedTokens = text
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => token.replace(/[^\u0600-\u06FFA-Za-z0-9]/g, '').toLowerCase())
    .filter(Boolean);
  if (normalizedTokens.length === 0) return true;
  let longestRun = 1;
  let run = 1;
  for (let i = 1; i < normalizedTokens.length; i += 1) {
    if (normalizedTokens[i] === normalizedTokens[i - 1]) {
      run += 1;
      if (run > longestRun) longestRun = run;
    } else {
      run = 1;
    }
  }
  if (longestRun >= 5) return true;
  if (normalizedTokens.length >= 8) {
    const freq = new Map();
    for (const token of normalizedTokens) {
      freq.set(token, (freq.get(token) || 0) + 1);
    }
    const topCount = Math.max(...Array.from(freq.values()));
    if ((topCount / normalizedTokens.length) >= 0.58) return true;
  }
  return false;
}

function cleanDescriptionText(value) {
  const raw = cleanAiText(sanitizeTranslationText(value));
  if (!raw) return '';
  const priceTokenRegex = /[¥￥]\s*\d+(?:[.,]\d+)?|\b(?:CNY|RMB)\b\s*\d+(?:[.,]\d+)?|\d+(?:[.,]\d+)?\s*(?:元|人民币)\b/gi;
  const keywordLineRegex = /(关键词|关键字|keywords?\b|tags?\b|الكلمات\s*المفتاحية|كلمات\s*مفتاحية)/i;
  const priceLineRegex = /(\bprice\b|السعر|السعر:|price_rmb|rmb|cny|¥|￥|元|人民币)/i;
  const lines = raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !keywordLineRegex.test(line))
    .map((line) => line.replace(priceTokenRegex, '').trim())
    .filter((line) => !(priceLineRegex.test(line) && /\d/.test(line)));
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function normalizeArabicKeyword(value) {
  return cleanAiText(value)
    .replace(/[\u0610-\u061A\u0640\u064B-\u065F\u0670\u06D6-\u06ED]/g, '')
    .replace(/[.,!?:;()"'[\]{}<>«»]/g, ' ')
    .replace(/،/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeTranslatedTitle(aiText, fallbackTitle) {
  const raw = String(aiText || '').trim();
  if (!raw) return fallbackTitle;
  const parsedPayload = parseAiTranslationPayload(raw);
  const parsedTitle = cleanAiText(sanitizeTranslationText(parsedPayload?.title_ar || ''));
  if (parsedTitle && hasArabic(parsedTitle) && !isLowQualityTranslationText(parsedTitle, 3)) return parsedTitle.slice(0, 140);
  const lines = raw.split('\n').map((line) => cleanAiText(line)).filter(Boolean);
  const arabicLine = lines
    .map((line) => line
      .replace(/^[{\s]*/, '')
      .replace(/["']?(title_ar|titlear|title)["']?\s*[:：-]\s*/i, '')
      .replace(/["']?(description_ar|descriptionar|full_description_ar|fulldescriptionar)["']?\s*[:：-]\s*/i, '')
      .replace(/["'}\s]*$/, '')
      .trim()
    )
    .map((line) => line.split(/,\s*["']?(description_ar|descriptionar|full_description_ar|fulldescriptionar)\b/i)[0].trim())
    .find((line) => hasArabic(line) && !/^option\b/i.test(line) && !isLowQualityTranslationText(line, 3));
  if (arabicLine) return arabicLine.slice(0, 140);
  const cleanedRaw = cleanAiText(raw).slice(0, 140);
  if (cleanedRaw && hasArabic(cleanedRaw) && !isLowQualityTranslationText(cleanedRaw, 3)) return cleanedRaw;
  return fallbackTitle;
}

function normalizeKeywordList(value) {
  const stopwords = new Set([
    'ال', 'في', 'من', 'على', 'مع', 'عن', 'الى', 'إلى', 'او', 'أو', 'و', 'ب', 'ل',
    'هذا', 'هذه', 'ذلك', 'تلك', 'هناك', 'هنا', 'لكن', 'ثم', 'قد', 'لم', 'لن', 'لا',
    'بعض', 'جدا', 'تماما', 'تمامًا', 'اي', 'أي', 'مثل', 'حالة', 'ممتازة',
    'معروضة', 'للبيع', 'البيع', 'عرض', 'شحن', 'مجاني', 'استرجاع', 'تبديل', 'عدم', 'الحاجة', 'اليها', 'إليها',
    'تسوق', 'شراء', 'بيع', 'يبيع', 'للشراء', 'موجود', 'متوفر', 'وصل', 'توصيل', 'يشمل',
    'تتضمن', 'يتضمن', 'شامل', 'متاح', 'مطلوب', 'يريد', 'اريد', 'أريد', 'ابحث', 'أبحث',
    'جديد', 'شبه', 'كامل', 'كاملة', 'مجموعة', 'عدة', 'متنوعة', 'يوجد', 'اصلي', 'تقليد', 'مقاس', 'حجم',
    'بسبب', 'تغيير', 'يتم', 'التخلص', 'منها', 'كعنصر', 'غير', 'مستخدم', 'تتضمن',
    'والباقي', 'الباقي', 'باقي', 'ارجاع', 'إرجاع', 'استبدال', 'لأسباب', 'سبب', 'اسباب', 'أسباب',
    'من', 'على', 'به', 'او', 'أو', 'لا', 'في', 'مع', 'الان', 'حاليا',
    'كان', 'كانت', 'لديه', 'عنده', 'صديق', 'سابق', 'اغلق', 'أغلق', 'لبعض', 'بقي', 'دفعات',
    'مفرغة', 'مفرغ', 'نظرا', 'فهي', 'ليست', 'معباة', 'معبأة', 'فقط', 'تباع', 'بسعر',
    'منخفض', 'متوفرة', 'بشكل', 'بالجملة', 'بدون', 'خياطة', 'تحمل', 'للاستخدام', 'احترافي',
    'منافسات', 'يوان'
  ]);
  const isUsefulKeyword = (word) => {
    if (!word) return false;
    if (word.length < 2 || word.length > 24) return false;
    if (/^\d+$/.test(word)) return false;
    if (/(.)\1{2,}/.test(word)) return false;
    if (/اات$/.test(word)) return false;
    if (/^[^a-zA-Z\u0600-\u06FF]+$/.test(word)) return false;
    return true;
  };
  const splitToWords = (input) => {
    const normalized = normalizeArabicKeyword(input);
    if (!normalized) return [];
    return normalized
      .split(/\s+/)
      .map((word) => word.trim())
      .flatMap((word) => {
        if (!word) return [];
        let cleaned = word;
        if (cleaned.startsWith('و') && cleaned.length > 2) cleaned = cleaned.slice(1);
        if (cleaned.startsWith('ال') && cleaned.length > 3) cleaned = cleaned.slice(2);
        return [cleaned];
      })
      .map((word) => word.trim())
      .filter((word) => !stopwords.has(word) && isUsefulKeyword(word));
  };
  if (Array.isArray(value)) {
    return [...new Set(value.flatMap((k) => splitToWords(k)).filter(Boolean))];
  }
  if (typeof value !== 'string') return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return [...new Set(parsed.flatMap((k) => splitToWords(k)).filter(Boolean))];
    }
  } catch {}
  return [...new Set(trimmed.split(/,|،|\n/).flatMap((k) => splitToWords(k)).filter(Boolean))];
}

function dedupeKeywordsByShape(list) {
  const seen = new Set();
  const unique = [];
  list.forEach((entry) => {
    const key = normalizeArabicKeyword(entry).replace(/\s+/g, '');
    if (!key || seen.has(key)) return;
    seen.add(key);
    unique.push(entry);
  });
  return unique;
}

const IRAQI_SYNONYMS = {
  'طاولة': ['ميز'],
  'طاوله': ['ميز'],
  'ميز': ['طاولة', 'طاوله', 'مكتب'],
  'مكتب': ['ميز', 'طاولة', 'طاوله'],
  'جربايه': ['سرير'],
  'سرير': ['جربايه'],
  'قنفه': ['اريكة', 'كنبة'],
  'برده': ['ستاره'],
  'ستاره': ['برده'],
  'بنكه': ['مروحه'],
  'مروحه': ['بنكه'],
  'ثلاجه': ['براد'],
  'براد': ['ثلاجه'],
  'مجمد': ['فريزر'],
  'فريزر': ['مجمد'],
  'طباخ': ['فرن', 'غاز'],
  'فرن': ['طباخ'],
  'كاونتر': ['خزانه', 'مطبخ'],
  'خزانه': ['كاونتر'],
  'دوشك': ['مرتبة'],
  'شرشف': ['مفرش', 'غطاء'],
  'مفرش': ['شرشف'],
  'خاولي': ['منشفه'],
  'منشفه': ['خاولي'],
  'تراكي': ['اقراط', 'حلق'],
  'اقراط': ['تراكي'],
  'سوار': ['اسواره'],
  'اسواره': ['سوار'],
  'جنطه': ['حقيبة', 'شنطة'],
  'حذاء': ['قندرة', 'جواتي'],
  'بوط': ['حذاء', 'جواتي'],
  'جزم': ['حذاء', 'قندرة'],
  'احذية': ['قنادر', 'جواتي'],
  'قندرة': ['حذاء', 'احذية'],
  'قنادر': ['احذية', 'جواتي'],
  'جواتي': ['حذاء', 'احذية', 'قندرة'],
  'شنطة': ['جنطة', 'جنطه'],
  'حقيبة': ['جنطة', 'جنطه', 'شنطة'],
  'كنبة': ['قنفه', 'اريكه'],
  'اريكة': ['قنفه', 'كنبة'],
  'مرتبة': ['دوشك'],
  'موبايل': ['جوال', 'تلفون'],
  'هاتف': ['جوال', 'موبايل', 'تلفون'],
  'جوال': ['هاتف', 'موبايل', 'تلفون'],
  'تلفون': ['هاتف', 'موبايل', 'جوال'],
  'تلفزيون': ['شاشه'],
  'شاشه': ['تلفزيون', 'مونيتر'],
  'لابتوب': ['حاسوب', 'كمبيوتر'],
  'حاسوب': ['لابتوب', 'كمبيوتر'],
  'كمبيوتر': ['لابتوب', 'حاسوب'],
  'شاحنه': ['شاحن'],
  'شاحن': ['شاحنه'],
  'سماعه': ['سبيكر', 'سماعات'],
  'سماعة': ['سبيكر', 'سماعات'],
  'سبيكر': ['سماعة', 'سماعه', 'سماعات'],
  'كاميرا': ['camera'],
  'مكياج': ['مكياج', 'ميك اب'],
  'بنطلون': ['سروال'],
  'تيشيرت': ['تي شيرت'],
  'نعال': ['شبشب', 'شحاطه'],
  'شحاطه': ['شبشب', 'صندل'],
  'شبشب': ['شحاطة', 'شحاطه'],
  'صندل': ['شحاطة', 'شحاطه'],
  'كلاو': ['قبعه'],
  'قبعه': ['كلاو'],
  'قميص': ['تيشيرت'],
  'فستان': ['دشداشه'],
  'دشداشه': ['فستان', 'جلابية', 'ثوب'],
  'تنوره': ['skirt'],
  'قاط': ['بدله'],
  'بدله': ['قاط'],
  'بايدر': ['دراجه'],
  'دراجه': ['بايدر'],
  'سياره': ['عربه'],
  'عربه': ['سياره'],
  'ملابس': ['هدوم'],
  'هدوم': ['ملابس'],
  'نساء': ['نسائي', 'بناتي'],
  'نسائي': ['نساء', 'بناتي'],
  'رجال': ['رجالي', 'ولادي'],
  'رجالي': ['رجال', 'ولادي'],
  'اطفال': ['ولادي', 'بناتي']
};

Object.assign(IRAQI_SYNONYMS, {
  'جركس': ['مطرقة', 'شاكوش'],
  'طرمبه': ['مضخة'],
  'دافور': ['موقد'],
  'صوبة': ['مدفأة'],
  'قنينة': ['زجاجة'],
  'تنك': ['خزان'],
  'تنكه': ['علبة', 'معدنية'],
  'جكارة': ['ولاعة'],
  'كابينه': ['خزانة'],
  'دولاب': ['خزانة', 'ملابس'],
  'طبك': ['طبق'],
  'شفاط': ['مروحة', 'شفط'],
  'خلاط': ['خلاط', 'كهربائي'],
  'مفرمه': ['مفرمة'],
  'قلايه': ['مقلاة'],
  'مشبك': ['مشبك', 'غسيل'],
  'قفل': ['قفل'],
  'مفتاح': ['مفتاح'],
  'سلسله': ['سلسلة'],
  'مسامير': ['مسامير'],
  'برغي': ['برغي'],
  'كيبل شحن': ['كابل', 'شحن'],
  'باور بنك': ['بطارية', 'متنقلة', 'باوربنك'],
  'ماوس': ['فأرة', 'حاسوب'],
  'كيبورد': ['لوحة', 'مفاتيح'],
  'كامره': ['كاميرا'],
  'ستاند': ['حامل'],
  'حامل موبايل': ['حامل', 'هاتف'],
  'كفر': ['غطاء', 'هاتف'],
  'سكرين': ['واقي', 'شاشة'],
  'فلتر': ['مرشح'],
  'فلتر مي': ['فلتر', 'ماء'],
  'كولر': ['مبرد', 'ماء'],
  'كولر هواء': ['مبرد', 'هواء'],
  'جاط': ['وعاء', 'كبير'],
  'كاسه': ['وعاء'],
  'ملقط': ['ملقط'],
  'مصفايه': ['مصفاة'],
  'مبخره': ['مبخرة'],
  'مسبحه': ['سبحة'],
  'مصباح': ['مصباح', 'لمبه'],
  'كشاف': ['مصباح', 'يدوي'],
  'لمبه ليد': ['مصباح', 'ليد'],
  'فيشه': ['قابس', 'كهربائي'],
  'توصيله': ['وصلة', 'كهربائية'],
  'مقسم كهرباء': ['موزع', 'كهرباء'],
  'مروحه سقف': ['مروحة', 'سقفية'],
  'مروحه مكتب': ['مروحة', 'مكتبية'],
  'مروحه يد': ['مروحة', 'يدوية'],
  'ميزان': ['ميزان'],
  'ميزان الكتروني': ['ميزان', 'الكتروني'],
  'قنينة غاز': ['اسطوانة', 'غاز'],
  'راس غاز': ['منظم', 'غاز'],
  'لي غاز': ['خرطوم', 'غاز'],
  'كيس زباله': ['كيس', 'قمامة'],
  'سله': ['سلة'],
  'سله مهملات': ['سلة', 'قمامة'],
  'ممسحه': ['ممسحة'],
  'جارو': ['مكنسة'],
  'فرشه': ['فرشاة'],
  'اسفنجه': ['اسفنجة'],
  'مسند': ['مسند'],
  'حزام': ['حزام'],
  'ساعة': ['ساعة'],
  'ساعة حايط': ['ساعة', 'حائط'],
  'ساعة يد': ['ساعة', 'يد'],
  'نظاره': ['نظارة'],
  'نظاره شمسيه': ['نظارة', 'شمسية'],
  'مظله': ['مظلة'],
  'شماسيه': ['مظلة', 'شمسية'],
  'مكبس': ['مكبس'],
  'قشاطه': ['مقشرة'],
  'فتاحه': ['فتاحة'],
  'مبرد': ['مبرد'],
  'مقص حديد': ['مقص', 'معدني'],
  'مطرقه مطاط': ['مطرقة', 'مطاطية'],
  'قاطع': ['قاطع'],
  'فيتر': ['مرشح'],
  'جنطه سفر': ['حقيبة', 'سفر'],
  'جنطه ظهر': ['حقيبة', 'ظهر'],
  'محفظه': ['محفظة'],
  'ميداليه': ['ميدالية', 'مفاتيح']
});

Object.assign(IRAQI_SYNONYMS, {
  'جركز': ['مطرقة', 'شاكوش'],
  'ماطور': ['مولد', 'محرك'],
  'محوله': ['محول', 'كهربائي'],
  'مكناسه': ['مكنسة'],
  'خاشوكه': ['ملعقة'],
  'طاسه': ['وعاء', 'طنجرة'],
  'جدر': ['قدر', 'طبخ'],
  'جدر ضغط': ['قدر ضغط', 'طنجرة ضغط'],
  'صينيه': ['صينية'],
  'قوري': ['ابريق', 'شاي'],
  'استكان': ['كوب', 'شاي'],
  'كلاص': ['كاس', 'كوب'],
  'بوري': ['انبوب'],
  'سطل': ['دلو'],
  'طشت': ['حوض', 'طست'],
  'منشر': ['منشر', 'غسيل'],
  'بطانيه': ['بطانية'],
  'دواشك': ['مراتب', 'مرتبة'],
  'مخده': ['وسادة', 'مخدة'],
  'كبت': ['خزانة'],
  'تخت': ['سرير'],
  'جادر': ['غطاء', 'مشمع'],
  'ترمس': ['حافظة', 'حرارية'],
  'فريزه': ['مجمد', 'فريزر'],
  'مكيف': ['مكيف', 'هواء'],
  'سبلت': ['مكيف', 'سبليت'],
  'دفايه': ['مدفأة', 'دافيه'],
  'غساله': ['غسالة'],
  'نشافه': ['مجفف', 'ملابس'],
  'مكوه': ['مكواة'],
  'جويته': ['حذاء', 'جواتي'],
  'قوطية': ['علبة', 'معدنية'],
  'كارتون': ['صندوق', 'كرتون'],
  'علبه': ['علبة'],
  'باكيت': ['حزمة', 'عبوة'],
  'شماغ': ['غطاء', 'راس'],
  'عقال': ['عقال'],
  'جاكيت': ['سترة', 'جكيت'],
  'بنطرون': ['سروال', 'بنطلون'],
  'فنيله': ['قميص', 'داخلي'],
  'كيبل': ['كابل'],
  'راوتر': ['موجه', 'انترنت'],
  'مودم': ['مودم'],
  'بطاريه': ['بطارية'],
  'لمبه': ['مصباح', 'لمبة'],
  'فيش': ['قابس', 'كهربائي'],
  'ابريز': ['مقبس', 'كهربائي'],
  'تيب': ['شريط', 'لاصق'],
  'سكوتش': ['شريط', 'لاصق', 'شفاف'],
  'كتر': ['مشرط', 'سكين'],
  'شاكوش': ['مطرقة', 'جركز'],
  'بنجه': ['مفتاح', 'ربط'],
  'مفك': ['مفك', 'براغي'],
  'دريل': ['مثقاب'],
  'منشار': ['منشار'],
  'كماشه': ['كماشة'],
  'زرديه': ['زرادية'],
  'جنط': ['اطار', 'عجلة'],
  'تاير': ['اطار', 'سيارة'],
  'جك': ['رافعة', 'سيارة'],
  'مضخه': ['مضخة'],
  'خرطوم': ['انبوب', 'ماء'],
  'برميل': ['برميل'],
  'قوطية صبغ': ['علبة', 'طلاء', 'صبغ'],
  'فرشه صبغ': ['فرشاة', 'طلاء'],
  'مسطره': ['مسطرة'],
  'دفتر': ['دفتر'],
  'قلم رصاص': ['قلم', 'رصاص'],
  'برايه': ['مبراة'],
  'ممحاة': ['ممحاة'],
  'شنطه مدرسه': ['حقيبة', 'مدرسية']
});

Object.assign(IRAQI_SYNONYMS, {
  'بوري مي': ['انبوب', 'ماء'],
  'بوري مجاري': ['انبوب', 'صرف'],
  'غطا بوري': ['غطاء', 'انبوب'],
  'وصله بوري': ['وصلة', 'انبوب'],
  'كوع بوري': ['وصلة', 'زاوية', 'انبوب'],
  'مضخه مي': ['مضخة', 'ماء'],
  'موتور مي': ['محرك', 'مضخة', 'ماء'],
  'حنفيه': ['صنبور'],
  'لي مي': ['خرطوم', 'ماء'],
  'رشاش مي': ['مرش', 'ماء'],
  'كفوف': ['قفازات'],
  'خوذه': ['خوذة'],
  'نظارات حمايه': ['نظارات', 'واقية'],
  'بدله عمل': ['ملابس', 'عمل'],
  'قلم تعليم': ['قلم', 'تحديد'],
  'ماركر': ['قلم', 'تحديد'],
  'سبوره': ['لوح', 'كتابة'],
  'طباشير': ['طباشير'],
  'ملف': ['ملف', 'اوراق'],
  'حافظه اوراق': ['حافظة', 'مستندات'],
  'كيس نايلون': ['كيس', 'بلاستيك'],
  'نايلون': ['بلاستيك'],
  'مشمع': ['غطاء', 'بلاستيكي'],
  'كتر كبير': ['مشرط', 'كبير'],
  'كتر صغير': ['مشرط', 'صغير'],
  'سكينه': ['سكين'],
  'سكين مطبخ': ['سكين', 'مطبخ'],
  'لوح تقطيع': ['لوح', 'تقطيع'],
  'مدقه': ['مدقة'],
  'هاون': ['هاون'],
  'مقشه': ['مكنسة', 'يدوية'],
  'كيس غسيل': ['كيس', 'غسيل'],
  'رف': ['رف'],
  'رف حديد': ['رف', 'معدني'],
  'رف جدار': ['رف', 'جداري'],
  'برواز': ['اطار', 'صورة'],
  'لوحه حايط': ['لوحة', 'جدارية'],
  'مخده سفر': ['وسادة', 'سفر'],
  'قنفة سرير': ['اريكة', 'سرير'],
  'مخده ارضيه': ['وسادة', 'ارضية'],
  'دواشك ارضي': ['مرتبة', 'ارضية'],
  'مفرش طاوله': ['غطاء', 'طاولة'],
  'سجاده': ['سجادة'],
  'دعاسه': ['بساط', 'باب'],
  'ممسحه ارض': ['ممسحة', 'ارضية'],
  'مساحه زجاج': ['ممسحة', 'زجاج'],
  'بخاخ': ['بخاخ'],
  'قنينة بخاخ': ['زجاجة', 'رش'],
  'مبيد': ['مبيد', 'حشرات'],
  'مصيده': ['مصيدة'],
  'مصيده فئران': ['مصيدة', 'فئران'],
  'مصيده حشرات': ['مصيدة', 'حشرات'],
  'كاشف دخان': ['جهاز', 'كشف', 'الدخان'],
  'كاشف غاز': ['جهاز', 'كشف', 'الغاز'],
  'كامره مراقبه': ['كاميرا', 'مراقبة'],
  'جهاز تسجيل كامرات': ['مسجل', 'كاميرات'],
  'شاشه كمبيوتر': ['شاشة', 'حاسوب'],
  'شاشه تلفزيون': ['شاشة', 'تلفاز'],
  'ريموت': ['جهاز', 'تحكم'],
  'ستلايت': ['جهاز', 'استقبال', 'فضائي'],
  'دش': ['طبق', 'استقبال', 'فضائي'],
  'راس دش': ['راس', 'طبق', 'فضائي'],
  'سلك دش': ['كابل', 'فضائي'],
  'سماعه بلوتوث': ['سماعة', 'بلوتوث'],
  'مكبر صوت': ['مكبر', 'صوت'],
  'حامل تلفزيون': ['حامل', 'تلفاز'],
  'حامل جدار': ['حامل', 'جداري'],
  'مبرد لابتوب': ['مبرد', 'حاسوب', 'محمول'],
  'طابعه': ['طابعة'],
  'حبر طابعه': ['حبر', 'طابعة'],
  'ورق طابعه': ['ورق', 'طباعة'],
  'كابل طابعه': ['كابل', 'طابعة'],
  'موزع نت': ['موزع', 'انترنت'],
  'مقوي واي فاي': ['مقوي', 'اشارة'],
  'حامل كامره': ['حامل', 'كاميرا'],
  'ستاند اضاءة': ['حامل', 'اضاءة'],
  'لمبه طوارئ': ['مصباح', 'طوارئ'],
  'كشاف يدوي': ['مصباح', 'يدوي'],
  'كشاف راس': ['مصباح', 'راس'],
  'حبل': ['حبل'],
  'جنزير': ['سلسلة', 'معدنية'],
  'قفل باب': ['قفل', 'باب'],
  'مقبض باب': ['مقبض', 'باب'],
  'مفصل باب': ['مفصل', 'باب'],
  'مسمار تثبيت': ['مسمار', 'تثبيت'],
  'مسمار جدار': ['مسمار', 'جدار'],
  'مسامير خشب': ['مسامير', 'خشب'],
  'مسامير حديد': ['مسامير', 'معدنية'],
  'لاصق': ['مادة', 'لاصقة'],
  'غرا': ['غراء'],
  'غرا قوي': ['غراء', 'قوي'],
  'سيليكون': ['سيليكون'],
  'مسدس سيليكون': ['مسدس', 'سيليكون'],
  'بخاخ صبغ': ['بخاخ', 'طلاء'],
  'رول صبغ': ['اسطوانة', 'طلاء'],
  'سطل صبغ': ['دلو', 'طلاء']
});

function expandIraqiKeywords(list) {
  const extras = [];
  list.forEach((entry) => {
    const normalized = normalizeArabicKeyword(entry);
    if (!normalized) return;
    const wholeMapped = IRAQI_SYNONYMS[normalized];
    if (Array.isArray(wholeMapped)) {
      wholeMapped.forEach((m) => extras.push(m));
    }
    const tokens = normalized.split(/\s+/).filter(Boolean);
    tokens.forEach((token) => {
      const mapped = IRAQI_SYNONYMS[token];
      if (!mapped) return;
      mapped.forEach((m) => extras.push(m));
    });
  });
  return dedupeKeywordsByShape(extras);
}

function buildKeywordCandidatesFromText(text) {
  return normalizeKeywordList(text);
}

const ARABIC_IRREGULAR_PLURAL_MAP = {
  'مصباح': ['مصابيح'],
  'مصابيح': ['مصباح'],
  'مفتاح': ['مفاتيح'],
  'مفاتيح': ['مفتاح'],
  'كتاب': ['كتب'],
  'كتب': ['كتاب'],
  'قلم': ['اقلام'],
  'اقلام': ['قلم'],
  'هاتف': ['هواتف'],
  'هواتف': ['هاتف'],
  'حاسوب': ['حواسيب'],
  'حواسيب': ['حاسوب'],
  'حقيبة': ['حقائب'],
  'حقائب': ['حقيبة'],
  'حذاء': ['احذية'],
  'احذية': ['حذاء'],
  'ساعة': ['ساعات'],
  'ساعات': ['ساعة'],
  'سماعة': ['سماعات'],
  'سماعات': ['سماعة']
};

function expandArabicSingularPlural(list) {
  const extras = [];
  list.forEach((entry) => {
    const token = normalizeArabicKeyword(entry);
    if (!token || token.length < 2 || token.includes(' ')) return;
    const irregular = ARABIC_IRREGULAR_PLURAL_MAP[token];
    if (Array.isArray(irregular)) extras.push(...irregular);
    if (token.endsWith('ات') && token.length > 3) {
      const stem = token.slice(0, -2);
      extras.push(`${stem}ة`, `${stem}ه`);
    } else if ((token.endsWith('ون') || token.endsWith('ين')) && token.length > 4) {
      extras.push(token.slice(0, -2));
    } else if ((token.endsWith('ة') || token.endsWith('ه')) && token.length > 3) {
      const stem = token.slice(0, -1);
      extras.push(`${stem}ات`);
      extras.push(stem);
    } else if (token.endsWith('ي') && token.length > 3) {
      extras.push(`${token}ة`, `${token}ات`);
    }
  });
  return dedupeKeywordsByShape(extras);
}

const CATEGORY_KEYWORD_RULES = [
  { signals: ['مصباح', 'اضاءة', 'إنارة', 'نور', 'ليد', 'LED', 'كشاف', 'فانوس'], keywords: ['انارة', 'مصابيح', 'لمبات', 'كشافات', 'مصباح'] },
  { signals: ['تخييم', 'رحلات', 'مخيم', 'بر', 'كشتة'], keywords: ['تخييم', 'رحلات', 'معدات تخييم', 'لوازم بر', 'ادوات رحلات'] },
  { signals: ['حذاء', 'احذية', 'قندرة', 'جواتي', 'شوز'], keywords: ['احذية', 'حذاء رجالي', 'حذاء نسائي', 'احذية رياضية', 'احذية كاجوال'] },
  { signals: ['شنطة', 'جنطة', 'حقيبة', 'باك'], keywords: ['حقائب', 'شنط', 'حقيبة يد', 'شنطة كتف', 'حقيبة ظهر'] },
  { signals: ['هاتف', 'موبايل', 'جوال', 'تلفون'], keywords: ['الكترونيات', 'هواتف', 'اكسسوارات موبايل', 'تقنية', 'اتصالات'] },
  { signals: ['سماعة', 'سماعات', 'سبيكر', 'بلوتوث'], keywords: ['اكسسوارات صوت', 'سماعات', 'الكترونيات', 'بلوتوث', 'صوتيات'] },
  { signals: ['ساعة', 'ساعات', 'ذكية'], keywords: ['ساعات', 'اكسسوارات', 'ساعة ذكية', 'ساعة يد', 'اكسسوارات الكترونية'] },
  { signals: ['قميص', 'تيشيرت', 'بلوزة', 'بنطلون', 'فستان', 'عباية', 'ملابس'], keywords: ['ملابس', 'ازياء', 'ملابس رجالية', 'ملابس نسائية', 'ملابس اطفال'] },
  { signals: ['كنبة', 'اريكة', 'طاولة', 'كرسي', 'خزانة', 'سرير', 'مطبخ'], keywords: ['اثاث', 'منزل', 'ديكور', 'غرفة نوم', 'مطبخ'] },
  { signals: ['عطر', 'كريم', 'سيروم', 'مكياج', 'ميك اب'], keywords: ['عناية', 'جمال', 'مستحضرات تجميل', 'عطور', 'العناية بالبشرة'] },
  { signals: ['لعبة', 'العاب', 'اطفال', 'بيبي', 'رضيع'], keywords: ['اطفال', 'العاب', 'مستلزمات اطفال', 'هدايا اطفال', 'ترفيه'] },
  { signals: ['سيارة', 'سيارات', 'عدة', 'ادوات', 'ورشة'], keywords: ['سيارات', 'اكسسوارات سيارات', 'ادوات', 'معدات', 'ورشة'] }
];

function inferCategoryKeywords(seedText, list = []) {
  const haystack = normalizeArabicKeyword(`${seedText || ''} ${(Array.isArray(list) ? list.join(' ') : '')}`);
  if (!haystack) return [];
  const matched = [];
  CATEGORY_KEYWORD_RULES.forEach((rule) => {
    const hasSignal = rule.signals.some((signal) => haystack.includes(normalizeArabicKeyword(signal)));
    if (hasSignal) matched.push(...rule.keywords);
  });
  if (matched.length > 0) return dedupeKeywordsByShape(matched);
  return ['منتجات', 'تسوق', 'متجر', 'فئة', 'تصنيف'];
}

function ensureKeywordList(value, seedText = '') {
  const normalized = dedupeKeywordsByShape(normalizeKeywordList(value))
    .filter((k) => k.length >= 2)
    .slice(0, KEYWORDS_PER_PRODUCT);
  const extras = dedupeKeywordsByShape(buildKeywordCandidatesFromText(seedText));
  const iraqiExtras = expandIraqiKeywords([...normalized, ...extras]);
  const singularPluralExtras = expandArabicSingularPlural([...normalized, ...extras, ...iraqiExtras]);
  const categoryExtras = inferCategoryKeywords(seedText, [...normalized, ...extras, ...iraqiExtras, ...singularPluralExtras]);
  const merged = dedupeKeywordsByShape([...normalized, ...extras, ...iraqiExtras, ...singularPluralExtras, ...categoryExtras])
    .filter((k) => k.length >= 2)
    .slice(0, KEYWORDS_PER_PRODUCT);
  if (merged.length >= KEYWORDS_PER_PRODUCT) return merged.slice(0, KEYWORDS_PER_PRODUCT);
  const padPool = merged.length > 0 ? [...merged] : extras;
  let idx = 0;
  while (merged.length < KEYWORDS_PER_PRODUCT && padPool.length > 0) {
    merged.push(padPool[idx % padPool.length]);
    idx += 1;
  }
  return merged.slice(0, KEYWORDS_PER_PRODUCT);
}


function detectNewOrOldFromTexts(title, conditionText) {
  const text = `${String(title || '')} ${String(conditionText || '')}`.trim();
  if (!text) return null;
  const normalized = text.toLowerCase();
  const mixedRegex = /(some\s+are\s+new|partly\s+new|partial(?:ly)?\s+new|mix(?:ed)?\s+condition|部分全新|部分新品|有新有旧|بعضها\s+جديد|جزء\s+جديد)/i;
  if (mixedRegex.test(normalized)) return null;
  const usedRegex = /(轻微使用痕迹|使用痕迹|二手|闲置|自用|有磨损|有划痕|成色|旧款|旧包|旧货|used|pre[-\s]?owned|second[-\s]?hand)/i;
  const newRegex = /(全新|全新未使用|未使用|未拆封|全新带吊牌|全新带标签|吊牌未拆|brand\s*new)/i;
  if (usedRegex.test(normalized)) return false;
  if (newRegex.test(normalized)) return true;
  return null;
}

function detectRealBrandFromTexts(title, conditionText) {
  const text = `${String(title || '')} ${String(conditionText || '')}`.trim();
  if (!text) return null;
  const mixedRegex = /(some\s+are\s+real|partly\s+authentic|partial(?:ly)?\s+authentic|mixed\s+authenticity|部分正品|有真有假|بعضها\s+أصلي|جزء\s+أصلي)/i;
  if (mixedRegex.test(text.toLowerCase())) return null;
  const negativeRegex = /(高仿|复刻|仿|a货|同款|平替|替代款|1[:：]\s*1|replica|fake|copy)/i;
  const positiveRegex = /(正品|专柜正品|官方正品|品牌正品|保真|真品|原装|官方|直营|authentic|genuine|original)/i;
  if (negativeRegex.test(text)) return false;
  if (positiveRegex.test(text)) return true;
  return null;
}

function sanitizeTranslationText(value) {
  return String(value || '')
    .replace(/^```json/i, '')
    .replace(/^```/i, '')
    .replace(/```$/i, '')
    .replace(/(?:^|\s)user\s+translate\s+this\s+chinese\s+product\s+title\s+to\s+arabic\.?\s*return\s+arabic\s+only\.?/gi, ' ')
    .replace(/translate\s+this\s+chinese\s+product\s+title\s+to\s+arabic\.?\s*return\s+arabic\s+only\.?/gi, ' ')
    .replace(/请用阿拉伯语翻译这个产品标题[:：]?\s*/g, ' ')
    .replace(/^\s*(title_ar|titlear|description_ar|descriptionar|full_description_ar|fullDescriptionAr)\s*[:：-]\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseAiTranslationPayload(rawValue) {
  const raw = String(rawValue || '').trim();
  if (!raw) return null;
  const normalized = raw
    .replace(/^```json/i, '')
    .replace(/^```/i, '')
    .replace(/```$/i, '')
    .trim();
  let parsed = null;
  try {
    parsed = JSON.parse(normalized);
  } catch {}
  if (!parsed) {
    const jsonMatch = normalized.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch {}
    }
  }
  const titleLine = normalized.match(/(?:^|\n|[{,]\s*)["']?(?:title_ar|titleAr|title)["']?\s*[:：]\s*["']?([^,"\n}]+)["']?/i)?.[1]?.trim();
  const descriptionLine = normalized.match(/(?:^|\n|[{,]\s*)["']?(?:description_ar|descriptionAr|full_description_ar|fullDescriptionAr)["']?\s*[:：]\s*["']?([^}\n]+)["']?/i)?.[1]?.trim();
  const keywordLine = normalized.match(/(?:^|\n)\s*keywords?\s*[:：]\s*(.+)/i)?.[1]?.trim();
  if (!parsed && !titleLine && !descriptionLine && !keywordLine) return null;
  return {
    title_ar: parsed?.title_ar ?? parsed?.titleAr ?? parsed?.title ?? titleLine ?? '',
    description_ar: parsed?.description_ar ?? parsed?.descriptionAr ?? parsed?.full_description_ar ?? parsed?.fullDescriptionAr ?? descriptionLine ?? '',
    keywords: Array.isArray(parsed?.keywords)
      ? parsed.keywords
      : (parsed?.keywords ?? parsed?.keywords_csv ?? keywordLine ?? '')
  };
}

function normalizeTranslationCacheKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function loadTranslationCache() {
  try {
    if (!fs.existsSync(TRANSLATION_CACHE_PATH)) return {};
    const raw = fs.readFileSync(TRANSLATION_CACHE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed;
  } catch {
    return {};
  }
}

function saveTranslationCache(cache) {
  try {
    fs.writeFileSync(TRANSLATION_CACHE_PATH, JSON.stringify(cache, null, 2));
  } catch {}
}

function loadTermDetailLinks() {
  try {
    if (!fs.existsSync(TERM_DETAIL_LINKS_PATH)) return null;
    const raw = fs.readFileSync(TERM_DETAIL_LINKS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const items = Array.isArray(parsed.items) ? parsed.items : [];
    return {
      batchId: parsed.batchId || null,
      termIndex: Number.isFinite(Number(parsed.termIndex)) ? Number(parsed.termIndex) : null,
      term: String(parsed.term || ''),
      items: items
        .map((item) => ({
          url: String(item?.url || '').trim(),
          title: String(item?.title || '').trim(),
          image: String(item?.image || '').trim()
        }))
        .filter((item) => Boolean(item.url))
    };
  } catch {
    return null;
  }
}

function saveTermDetailLinks(batchId, termIndex, term, items) {
  try {
    const payload = {
      batchId: batchId || null,
      termIndex: Number.isFinite(Number(termIndex)) ? Number(termIndex) : null,
      term: String(term || ''),
      items: (Array.isArray(items) ? items : [])
        .map((item) => ({
          url: String(item?.url || '').trim(),
          title: String(item?.title || '').trim(),
          image: String(item?.image || '').trim()
        }))
        .filter((item) => Boolean(item.url))
        .slice(0, ITEMS_PER_SEARCH),
      updatedAt: new Date().toISOString()
    };
    fs.writeFileSync(TERM_DETAIL_LINKS_PATH, JSON.stringify(payload, null, 2), 'utf8');
  } catch {}
}

function clearTermDetailLinks() {
  try {
    if (fs.existsSync(TERM_DETAIL_LINKS_PATH)) fs.unlinkSync(TERM_DETAIL_LINKS_PATH);
  } catch {}
}

function loadBatchLinksQueue() {
  try {
    if (!fs.existsSync(BATCH_LINKS_PATH)) return null;
    const raw = fs.readFileSync(BATCH_LINKS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (!Array.isArray(parsed.termStates)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveBatchLinksQueue(queue) {
  try {
    fs.writeFileSync(BATCH_LINKS_PATH, JSON.stringify(queue, null, 2), 'utf8');
  } catch {}
}

function clearBatchLinksQueue() {
  try {
    if (fs.existsSync(BATCH_LINKS_PATH)) fs.unlinkSync(BATCH_LINKS_PATH);
  } catch {}
}

function getCachedTranslation(cache, title) {
  const key = normalizeTranslationCacheKey(title);
  if (!key) return null;
  const entry = cache[key];
  if (!entry || typeof entry !== 'object') return null;
  const titleAr = normalizeTranslatedTitle(entry.titleAr, title);
  const descriptionAr = cleanDescriptionText(entry.descriptionAr || entry.translatedDescription || titleAr || title) || titleAr || title;
  if (isLowQualityTranslationText(titleAr, 3) || isLowQualityTranslationText(descriptionAr, 6)) return null;
  const seedText = `${titleAr} ${descriptionAr}`.trim();
  const keywords = ensureKeywordList(entry.keywords, seedText);
  return { titleAr, descriptionAr, keywords };
}

function setCachedTranslation(cache, title, data) {
  const key = normalizeTranslationCacheKey(title);
  if (!key) return;
  const normalizedTitleAr = normalizeTranslatedTitle(data?.titleAr, title);
  const descriptionAr = cleanDescriptionText(data?.descriptionAr || data?.translatedDescription || normalizedTitleAr || title);
  if (isLowQualityTranslationText(normalizedTitleAr, 3) || isLowQualityTranslationText(descriptionAr, 6)) return;
  const seedText = `${normalizedTitleAr} ${descriptionAr}`.trim();
  cache[key] = {
    titleAr: normalizedTitleAr,
    descriptionAr,
    keywords: ensureKeywordList(data?.keywords, seedText),
    updatedAt: new Date().toISOString()
  };
}

puppeteer.use(StealthPlugin());

const CHROME_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
];

// UA List for rotation
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15'
];

function getExecutablePath() {
  const envPaths = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    process.env.GOOFISH_CHROME_PATH,
    process.env.CHROME_PATH
  ].filter(Boolean);
  for (const p of envPaths) {
    if (fs.existsSync(p)) return p;
  }

  if (process.platform === 'linux') {
    const linuxPaths = [
      '/usr/bin/google-chrome-stable',
      '/usr/bin/google-chrome',
      '/opt/google/chrome/chrome',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
      '/snap/bin/chromium'
    ];
    for (const p of linuxPaths) {
      if (fs.existsSync(p)) return p;
    }
    const commands = ['google-chrome-stable', 'google-chrome', 'chromium-browser', 'chromium', 'chrome'];
    for (const command of commands) {
      try {
        const resolved = spawnSync('which', [command], { encoding: 'utf8' });
        if (resolved.status === 0) {
          const candidate = String(resolved.stdout || '').trim().split('\n')[0];
          if (candidate && fs.existsSync(candidate)) return candidate;
        }
      } catch {}
    }
    return null;
  }
  for (const p of CHROME_PATHS) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function findChromeInPuppeteerCache() {
  const roots = [
    path.join(process.cwd(), '.cache', 'puppeteer'),
    path.join(process.cwd(), '..', '.cache', 'puppeteer'),
    path.join('/app', '.cache', 'puppeteer'),
    path.join('/root', '.cache', 'puppeteer')
  ];
  const seen = new Set();
  const walk = (dir) => {
    let files = [];
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return files;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (seen.has(fullPath)) continue;
      seen.add(fullPath);
      if (entry.isDirectory()) {
        files = files.concat(walk(fullPath));
      } else {
        files.push(fullPath);
      }
    }
    return files;
  };
  for (const root of roots) {
    const files = walk(root);
    const match = files.find((filePath) => /[\\/]chrome(?:\.exe)?$/.test(filePath) && filePath.includes('chrome-linux'));
    if (match) return match;
  }
  return null;
}

function installChromeForLinux() {
  const result = spawnSync('npx', ['-y', '@puppeteer/browsers', 'install', 'chrome@stable', '--path', '.cache/puppeteer'], {
    cwd: process.cwd(),
    stdio: 'inherit'
  });
  return result.status === 0;
}

const delay = (ms) => new Promise(res => setTimeout(res, ms));
const humanDelay = (min = 1000, max = 3000) => delay(Math.floor(Math.random() * (max - min + 1)) + min);

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, ans => { rl.close(); resolve(ans); }));
}

function loadUpdateExistingProgress() {
  if (!fs.existsSync(UPDATE_PROGRESS_PATH)) return null;
  try {
    const raw = fs.readFileSync(UPDATE_PROGRESS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      lastId: Math.max(0, Number(parsed.lastId || 0) || 0),
      scanned: Math.max(0, Number(parsed.scanned || 0) || 0),
      updatedCount: Math.max(0, Number(parsed.updatedCount || 0) || 0),
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : null
    };
  } catch {
    return null;
  }
}

function saveUpdateExistingProgress(progress) {
  try {
    const payload = {
      lastId: Math.max(0, Number(progress?.lastId || 0) || 0),
      scanned: Math.max(0, Number(progress?.scanned || 0) || 0),
      updatedCount: Math.max(0, Number(progress?.updatedCount || 0) || 0),
      updatedAt: new Date().toISOString()
    };
    fs.writeFileSync(UPDATE_PROGRESS_PATH, JSON.stringify(payload, null, 2), 'utf8');
  } catch (error) {
    console.warn('Failed to save update progress:', error?.message || error);
  }
}

function clearUpdateExistingProgress() {
  try {
    if (fs.existsSync(UPDATE_PROGRESS_PATH)) fs.unlinkSync(UPDATE_PROGRESS_PATH);
  } catch (error) {
    console.warn('Failed to clear update progress:', error?.message || error);
  }
}

function loadSearchTermHistory() {
  if (!fs.existsSync(SEARCH_TERMS_PATH)) return { used: [], batches: [], activeBatch: null };
  try {
    const raw = fs.readFileSync(SEARCH_TERMS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    const used = Array.isArray(parsed?.used) ? parsed.used : [];
    const batches = Array.isArray(parsed?.batches) ? parsed.batches : [];
    const activeBatch = parsed?.activeBatch && typeof parsed.activeBatch === 'object' ? parsed.activeBatch : null;
    return { used, batches, activeBatch };
  } catch {
    return { used: [], batches: [], activeBatch: null };
  }
}

function saveSearchTermHistory(history) {
  fs.writeFileSync(SEARCH_TERMS_PATH, JSON.stringify(history, null, 2));
}

let dbConnectPromise = null;
let dbLastConnectError = null;

const resetPrismaClient = async (label = 'db reset') => {
  const oldPrisma = prisma;
  dbConnectPromise = null;
  dbReady = false;
  dbChecked = false;
  try {
    await Promise.race([
      oldPrisma.$disconnect(),
      new Promise((resolve) => setTimeout(resolve, 3000))
    ]);
  } catch {}
  prisma = createPrismaClient();
};

const isDbEngineError = (error) => {
  const msg = String(error?.message || '');
  return msg.includes('Engine is not yet connected')
    || msg.includes('Response from the Engine was empty');
};

const isDbConnectionFailure = (error) => {
  const msg = String(error?.message || '');
  const code = String(error?.code || '');
  return isDbEngineError(error)
    || msg.includes('Timed out fetching a new connection from the connection pool')
    || msg.includes("Can't reach database server")
    || msg.includes('timed out after')
    || msg.includes('db connect failed')
    || msg.includes('Server has closed the connection')
    || code === 'P2024'
    || code === 'P1017'
    || code === 'P1001';
};

const isDbCircuitOpen = () => Date.now() < dbCircuitOpenUntil;

const recordDbEngineFailure = (error) => {
  if (!isDbConnectionFailure(error)) return;
  const now = Date.now();
  dbEngineFailureTimestamps = dbEngineFailureTimestamps.filter((ts) => now - ts <= GOOFISH_DB_ENGINE_FAILURE_WINDOW_MS);
  dbEngineFailureTimestamps.push(now);
  if (dbEngineFailureTimestamps.length >= GOOFISH_DB_ENGINE_FAILURE_THRESHOLD) {
    dbCircuitOpenUntil = now + GOOFISH_DB_ENGINE_COOLDOWN_MS;
    dbEngineFailureTimestamps = [];
    dbReady = false;
    dbChecked = false;
    console.warn(`[DB Circuit] Opened for ${GOOFISH_DB_ENGINE_COOLDOWN_MS}ms after repeated Prisma engine errors.`);
  }
};

function clearSearchTermHistory() {
  try {
    if (fs.existsSync(SEARCH_TERMS_PATH)) fs.unlinkSync(SEARCH_TERMS_PATH);
    console.log('Search term history reset.');
  } catch (error) {
    console.warn('Failed to reset search term history:', error?.message || error);
  }
}

function resetRunProgressKeepTermMemory() {
  try {
    const history = loadSearchTermHistory();
    const nextHistory = {
      used: Array.isArray(history.used) ? history.used : [],
      batches: Array.isArray(history.batches) ? history.batches : [],
      activeBatch: null
    };
    saveSearchTermHistory(nextHistory);
    console.log('Run progress reset while preserving term memory.');
  } catch (error) {
    console.warn('Failed to reset run progress with term memory:', error?.message || error);
  }
}

function isFoodTerm(term) {
  return FOOD_BLACKLIST.some((word) => term.includes(word));
}

function normalizeSearchTerm(term) {
  return String(term || '').trim().replace(/\s+/g, '');
}

function shuffleTerms(terms) {
  const arr = [...terms];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

async function generateSearchTermsWithAi(existingTerms) {
  const recentTerms = existingTerms.slice(-400);
  const existingSet = new Set(recentTerms.map(normalizeSearchTerm));
  const termsToAvoid = recentTerms.slice(-120).join(', ');

  let results = [];
  let usedAi = false;
  for (let attempt = 0; attempt < MAX_AI_ATTEMPTS && results.length < GOOFISH_TERMS_PER_BATCH; attempt += 1) {
    console.log(`[AI Term Gen] Requesting new terms from SiliconFlow (attempt ${attempt + 1})...`);
    const prompt = [
      {
        role: 'system',
        content: 'You generate Chinese e-commerce category search terms for a marketplace like Xianyu. Output only valid JSON.'
      },
      {
        role: 'user',
        content: `Generate exactly ${GOOFISH_TERMS_PER_BATCH} unique Chinese category search terms for an e-commerce marketplace like Xianyu. 
Focus on shopping categories: electronics, phone accessories, home goods, furniture, fashion, shoes, bags, beauty, baby/kids, sports, tools, auto accessories, office, gaming, photography.
Avoid all food or grocery terms. Avoid brand names. Use short, natural category phrases in Chinese.
IMPORTANT: Do NOT use any of the following terms: ${termsToAvoid}.
Return a JSON array only, no other text or punctuation.`
      }
    ];
    const raw = await callSiliconFlow(prompt, 0.6, 500);
    if (!raw) {
      console.log('[AI Term Gen] SiliconFlow returned empty or null response.');
      continue;
    }
    usedAi = true;
    const cleaned = raw.trim().replace(/^```json/i, '').replace(/^```/i, '').replace(/```$/i, '').trim();
    console.log('[AI Term Gen] Raw response:', cleaned.substring(0, 100) + '...');
    let parsed = null;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      const match = cleaned.match(/\[[\s\S]*\]/);
      if (match) {
        try {
          parsed = JSON.parse(match[0]);
        } catch {
          parsed = null;
        }
      }
    }
    let candidates = Array.isArray(parsed) ? parsed : [];
    if (candidates.length === 0) {
      const quoted = cleaned.match(/"([^"\r\n]{2,40})"/g) || [];
      candidates = quoted.map((entry) => entry.replace(/^"/, '').replace(/"$/, ''));
    }
    for (const entry of candidates) {
      const term = normalizeSearchTerm(entry);
      if (!term || term.length < 2) continue;
      if (!isChineseTerm(term)) continue;
      if (isFoodTerm(term)) continue;
      if (existingSet.has(term) && results.length < 20) continue;
      if (!results.includes(term)) results.push(term);
      if (results.length >= GOOFISH_TERMS_PER_BATCH) break;
    }
  }
  
  if (results.length > 0) {
    console.log(`[AI Term Gen] Successfully generated ${results.length} terms using SiliconFlow:`);
    console.log(results.join(', '));
  } else {
    console.log('[AI Term Gen] Failed to generate terms or API returned empty list.');
  }

  return { terms: results.slice(0, GOOFISH_TERMS_PER_BATCH), usedAi };
}

async function getSearchTermsForRun() {
  const history = loadSearchTermHistory();
  let activeBatch = history.activeBatch;

  // If we have an active batch that is a fallback, but we want AI terms and have a key, discard it.
  if (activeBatch && activeBatch.source === 'fallback' && SILICONFLOW_API_KEY) {
    console.log('Found active batch from fallback source, but SiliconFlow Key is present. Discarding fallback batch to try AI generation.');
    activeBatch = null;
    clearActiveBatch(null); // Clear any active batch
  }

  if (activeBatch && Array.isArray(activeBatch.terms) && activeBatch.terms.length > 0) {
    const batchSource = activeBatch.source || 'resume';
    if (AI_ONLY_TERMS && batchSource !== 'ai') {
      clearActiveBatch(activeBatch.id);
    } else {
      return {
        terms: activeBatch.terms,
        startIndex: Math.max(0, Number(activeBatch.nextIndex || 0) || 0),
        batchId: activeBatch.id || activeBatch.generatedAt || null,
        source: batchSource,
        checkpoint: activeBatch.checkpoint || null
      };
    }
  }
  const existing = Array.isArray(history.used) ? history.used : [];
  const aiResult = await generateSearchTermsWithAi(existing);
  let finalTerms = aiResult.terms;
  let source = aiResult.usedAi ? 'ai' : 'fallback';
  if (AI_ONLY_TERMS && !SILICONFLOW_API_KEY) {
    throw new Error('AI-only mode is enabled but SILICONFLOW_API_KEY is missing.');
  }
  if (AI_ONLY_TERMS && finalTerms.length < GOOFISH_TERMS_PER_BATCH) {
    throw new Error(`AI-only mode could not generate ${GOOFISH_TERMS_PER_BATCH} unique terms.`);
  }
  if (finalTerms.length < GOOFISH_TERMS_PER_BATCH) {
    const fallback = DEFAULT_SEARCH_TERMS
      .map(normalizeSearchTerm)
      .filter((term) => term && !existing.includes(term) && !isFoodTerm(term));
    finalTerms = [...finalTerms, ...fallback].slice(0, GOOFISH_TERMS_PER_BATCH);
    source = 'fallback';
  }
  if (finalTerms.length === 0) {
    finalTerms = DEFAULT_SEARCH_TERMS.slice(0, GOOFISH_TERMS_PER_BATCH);
    source = 'fallback';
  }
  finalTerms = shuffleTerms(finalTerms);
  const batchId = `batch_${Date.now()}`;
  const active = { id: batchId, generatedAt: new Date().toISOString(), terms: finalTerms, nextIndex: 0, source };
  const nextHistory = {
    used: Array.from(new Set([...existing, ...finalTerms])),
    batches: [
      ...(Array.isArray(history.batches) ? history.batches : []),
      { id: batchId, generatedAt: active.generatedAt, terms: finalTerms, source }
    ],
    activeBatch: active
  };
  saveSearchTermHistory(nextHistory);
  clearBatchLinksQueue();
  return { terms: finalTerms, startIndex: 0, batchId, source, checkpoint: null };
}

function updateActiveBatchProgress(batchId, nextIndex) {
  const history = loadSearchTermHistory();
  const active = history.activeBatch;
  if (!active || (batchId && active.id !== batchId)) return;
  const updated = {
    ...active,
    nextIndex: Math.max(0, Number(nextIndex || 0) || 0),
    checkpoint: null,
    updatedAt: new Date().toISOString()
  };
  saveSearchTermHistory({ ...history, activeBatch: updated });
}

function normalizeDetailCheckpointItems(items) {
  if (!Array.isArray(items)) return [];
  const normalized = [];
  for (const item of items) {
    const id = Number(item?.id);
    if (!Number.isFinite(id) || id <= 0) continue;
    normalized.push({
      id,
      url: String(item?.url || '').trim(),
      name: String(item?.name || '').trim(),
      imagesChecked: Boolean(item?.imagesChecked),
      specs: item?.specs ?? null
    });
    if (normalized.length >= Math.max(ITEMS_PER_SEARCH, 300)) break;
  }
  return normalized;
}

function updateActiveBatchTermCheckpoint(batchId, termIndex, processedCount, urls = [], options = {}) {
  const history = loadSearchTermHistory();
  const active = history.activeBatch;
  if (!active || (batchId && active.id !== batchId)) return;
  const cleanedUrls = Array.from(new Set((Array.isArray(urls) ? urls : []).filter(Boolean)));
  const stage = String(options?.stage || '').toLowerCase() === 'detail' ? 'detail' : 'collect';
  const detailItems = normalizeDetailCheckpointItems(options?.detail?.items);
  const detailNextIndexRaw = Number(options?.detail?.nextIndex || 0);
  const detailNextIndex = Number.isFinite(detailNextIndexRaw) ? Math.max(0, Math.min(detailItems.length, detailNextIndexRaw)) : 0;
  const collectPageIndexRaw = Number(options?.collectPageIndex || 0);
  const collectPageIndex = Number.isFinite(collectPageIndexRaw) ? Math.max(0, collectPageIndexRaw) : 0;
  const previousPageIndex = Math.max(0, Number(active?.checkpoint?.pageIndex || 0) || 0);
  const updated = {
    ...active,
    nextIndex: Math.max(0, Number(termIndex || 0) || 0),
    checkpoint: {
      termIndex: Math.max(0, Number(termIndex || 0) || 0),
      processedCount: Math.max(0, Number(processedCount || 0) || 0),
      urls: cleanedUrls.slice(-Math.max(300, ITEMS_PER_SEARCH * 3)),
      pageIndex: stage === 'collect' ? collectPageIndex : previousPageIndex,
      stage,
      detail: stage === 'detail'
        ? {
            nextIndex: detailNextIndex,
            total: detailItems.length,
            items: detailItems
          }
        : null
    },
    updatedAt: new Date().toISOString()
  };
  saveSearchTermHistory({ ...history, activeBatch: updated });
}

function clearActiveBatch(batchId) {
  const history = loadSearchTermHistory();
  if (!history.activeBatch) return;
  if (batchId && history.activeBatch.id !== batchId) return;
  saveSearchTermHistory({ ...history, activeBatch: null });
}

const UNAVAILABLE_KEYWORDS = [
  '卖掉了', // Sold out (Primary indicator)
  '宝贝不存在', // Baby does not exist
  '下架', // Taken off shelf
  '删除', // Deleted
  '转移', // Transferred
  '很抱歉', // Very sorry
  'Sold out',
  'This item is no longer available',
  '商品已失效' // Product invalid
];

const withTimeout = async (promiseFactory, label, timeoutMs = 60000) => {
  let timer;
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

const safeDbDisconnect = async () => {
  try {
    await withTimeout(() => prisma.$disconnect(), 'db disconnect', 5000);
  } catch {}
  dbReady = false;
  dbChecked = false;
};

const dbPing = async () => withTimeout(() => prisma.$queryRaw`SELECT 1`, 'db ping', Math.min(12000, Math.max(5000, GOOFISH_DB_CONNECT_TIMEOUT_MS - 3000)));

const safeDbConnect = async () => {
  if (dbConnectPromise) return dbConnectPromise;
  dbConnectPromise = (async () => {
    try {
      dbLastConnectError = null;
      await withTimeout(() => prisma.$connect(), 'db connect', GOOFISH_DB_CONNECT_TIMEOUT_MS);
      if (GOOFISH_DB_CONNECT_VERIFY_PING) {
        await dbPing();
      }
      dbChecked = true;
      dbReady = true;
      return true;
    } catch (error) {
      dbLastConnectError = error;
      try { await prisma.$disconnect(); } catch {}
      dbChecked = true;
      dbReady = false;
      return false;
    }
  })();
  try {
    return await dbConnectPromise;
  } finally {
    dbConnectPromise = null;
  }
};

const recoverDbConnection = async (label, backoffMs, attemptIndex) => {
  const recoverWaitMs = Math.max(0, GOOFISH_DB_RECOVER_WAIT_MS);
  const infiniteWait = recoverWaitMs <= 0;
  const start = Date.now();
  let lastPauseLogAt = 0;
  while (infiniteWait || (Date.now() - start < recoverWaitMs)) {
    const now = Date.now();
    if (now - lastPauseLogAt >= 15000) {
      const elapsedSec = Math.floor((now - start) / 1000);
      const waitLabel = infiniteWait ? 'infinite' : `${Math.floor(recoverWaitMs / 1000)}s`;
      console.warn(`[DB Pause] ${label}: waiting for reconnect (${elapsedSec}s elapsed, wait=${waitLabel})`);
      lastPauseLogAt = now;
    }
    await safeDbDisconnect();
    await resetPrismaClient(`recover ${label}`);
    const delayMs = Math.max(1000, Math.min(15000, backoffMs * Math.max(1, attemptIndex)));
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    const connected = await safeDbConnect();
    if (!connected) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      continue;
    }
    try {
      await withTimeout(() => prisma.$queryRaw`SELECT 1`, `recover ping ${label}`, GOOFISH_DB_RECOVER_PING_TIMEOUT_MS);
      console.warn(`[DB Pause] ${label}: reconnect successful, resuming.`);
      return true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }
  return false;
};

const recoverDbConnectionQuick = async (label) => {
  await safeDbDisconnect();
  await resetPrismaClient(`quick recover ${label}`);
  const connected = await safeDbConnect();
  if (!connected) return false;
  try {
    await withTimeout(() => prisma.$queryRaw`SELECT 1`, `quick recover ping ${label}`, Math.max(3000, Math.min(8000, GOOFISH_DB_RECOVER_PING_TIMEOUT_MS)));
    return true;
  } catch {
    return false;
  }
};

const triggerDbReconnectNonBlocking = (label) => {
  Promise.resolve()
    .then(() => withTimeout(() => recoverDbConnectionQuick(label), `quick reconnect ${label}`, Math.max(4000, Math.min(10000, GOOFISH_DB_CONNECT_TIMEOUT_MS))))
    .catch(() => null);
};

const forceDbReconnectFromScratch = async (label) => {
  console.warn(`[DB Reconnect] Restarting DB connection from scratch: ${label}`);
  await safeDbDisconnect();
  await resetPrismaClient(`force reconnect ${label}`);
  const connected = await withTimeout(
    () => safeDbConnect(),
    `force reconnect connect ${label}`,
    Math.max(5000, GOOFISH_DB_CONNECT_TIMEOUT_MS)
  );
  if (!connected) {
    throw new Error(`force reconnect failed: ${label}`);
  }
  await withTimeout(
    () => prisma.$queryRaw`SELECT 1`,
    `force reconnect ping ${label}`,
    Math.max(3000, Math.min(12000, GOOFISH_DB_RECOVER_PING_TIMEOUT_MS))
  );
  dbChecked = true;
  dbReady = true;
  console.warn(`[DB Reconnect] Completed: ${label}`);
  return true;
};

const markPipelineProgress = (label = '') => {
  pipelineLastProgressAt = Date.now();
  if (label) pipelineLastProgressLabel = String(label);
  pipelineWatchdogLastStallLabel = '';
  pipelineWatchdogStallCount = 0;
};

const schedulePipelineRestart = (reason) => {
  if (pipelineRestartScheduled) return;
  pipelineRestartScheduled = true;
  const exitCode = 86;
  console.error(`[Watchdog] Restarting pipeline: ${reason}`);
  process.exitCode = exitCode;
  setTimeout(() => {
    process.exit(exitCode);
  }, 250);
};

const startPipelineProgressWatchdog = () => {
  if (pipelineWatchdogTimer) return;
  pipelineWatchdogTimer = setInterval(() => {
    if (DISABLE_DB_WRITE) return;
    if (pipelineRestartScheduled) return;
    if (pipelineWatchdogReconnectInFlight) return;
    const now = Date.now();
    const idleMs = now - pipelineLastProgressAt;
    if (idleMs < GOOFISH_PROGRESS_STALL_TIMEOUT_MS) return;
    const idleSec = Math.floor(idleMs / 1000);
    const label = pipelineLastProgressLabel || 'unknown';
    if (pipelineWatchdogLastStallLabel === label) {
      pipelineWatchdogStallCount += 1;
    } else {
      pipelineWatchdogLastStallLabel = label;
      pipelineWatchdogStallCount = 1;
    }
    if (idleMs >= GOOFISH_PROGRESS_STALL_HARD_EXIT_MS || pipelineWatchdogStallCount > GOOFISH_PROGRESS_STALL_MAX_RECOVERS) {
      schedulePipelineRestart(
        `stalled at "${label}" for ${idleSec}s after ${pipelineWatchdogStallCount - 1} recoveries`
      );
      return;
    }
    if ((now - pipelineWatchdogLastRecoveryAt) < GOOFISH_PROGRESS_RECOVERY_COOLDOWN_MS) {
      return;
    }
    pipelineWatchdogReconnectInFlight = true;
    Promise.resolve()
      .then(async () => {
        console.warn(
          `[Watchdog] No pipeline progress for ${idleSec}s at "${label}". Triggering DB reconnect (${pipelineWatchdogStallCount}/${GOOFISH_PROGRESS_STALL_MAX_RECOVERS}).`
        );
        let reconnected = false;
        try {
          await forceDbReconnectFromScratch(`watchdog idle ${idleSec}s ${label.slice(0, 40)}`);
          reconnected = true;
        } catch (error) {
          console.warn(`[Watchdog] DB reconnect failed: ${toErrorText(error)}`);
        } finally {
          if (reconnected) {
            pipelineWatchdogLastRecoveryAt = Date.now();
          }
          pipelineWatchdogReconnectInFlight = false;
        }
      })
      .catch(() => {
        pipelineWatchdogReconnectInFlight = false;
      });
  }, GOOFISH_PROGRESS_WATCHDOG_INTERVAL_MS);
  if (typeof pipelineWatchdogTimer?.unref === 'function') {
    pipelineWatchdogTimer.unref();
  }
};

const stopPipelineProgressWatchdog = () => {
  if (!pipelineWatchdogTimer) return;
  clearInterval(pipelineWatchdogTimer);
  pipelineWatchdogTimer = null;
  pipelineWatchdogReconnectInFlight = false;
  pipelineWatchdogLastRecoveryAt = 0;
  pipelineWatchdogLastStallLabel = '';
  pipelineWatchdogStallCount = 0;
  pipelineRestartScheduled = false;
};

const isRetryableDbError = (error) => {
  const msg = String(error?.message || '');
  const code = String(error?.code || '');
  return msg.includes('Timed out fetching a new connection from the connection pool')
    || msg.includes("Can't reach database server")
    || msg.includes('timed out after')
    || msg.includes('db connect failed')
    || msg.includes('Server has closed the connection')
    || msg.includes('Engine is not yet connected')
    || msg.includes('Response from the Engine was empty')
    || code === 'P2024'
    || code === 'P1017'
    || code === 'P1001';
};

const withRetry = async (run, label, retries = 5, timeoutMs = 60000, backoffMs = 1500) => {
  let lastError;
  let recoverCycles = 0;
  for (let i = 1; i <= retries; i++) {
    try {
      return await withTimeout(run, label, timeoutMs);
    } catch (error) {
      lastError = error;
      recordDbEngineFailure(error);
      const msg = String(error?.message || '');
      const retryable = isRetryableDbError(error);
      if (!retryable || i === retries) break;
      if (recoverCycles >= GOOFISH_DB_RECOVER_MAX_CYCLES_PER_OP) {
        lastError = new Error(`db recovery cycle limit reached for ${label}`);
        break;
      }
      console.warn(`${label} failed (attempt ${i}/${retries}), retrying... ${msg}`);
      const recovered = await withTimeout(
        () => recoverDbConnectionQuick(label),
        `quick reconnect ${label}`,
        Math.max(4000, Math.min(10000, GOOFISH_DB_CONNECT_TIMEOUT_MS))
      );
      recoverCycles += 1;
      if (!recovered) {
        triggerDbReconnectNonBlocking(label);
        lastError = new Error(`db quick recovery failed for ${label}`);
        break;
      }
    }
  }
  throw lastError;
};

const toErrorText = (error) => String(error?.message || error || 'unknown error');
const toErrorCode = (error) => String(error?.code || '');
const makePipelineRestartError = (message, cause = null) => {
  const error = new Error(message);
  error.code = 'GOOFISH_PIPELINE_RESTART';
  if (cause) {
    error.cause = cause;
  }
  return error;
};
const isPipelineRestartError = (error) => String(error?.code || '') === 'GOOFISH_PIPELINE_RESTART';
const shouldRestartPipelineForItemError = (error) => {
  if (isPipelineRestartError(error)) return true;
  const text = toErrorText(error);
  return text.includes('process link ') && text.includes(' timed out after ');
};

async function createBrowser() {
  let executablePath = getExecutablePath();
  
  const launchOptions = {
    headless: true,
    defaultViewport: null,
    args: [
      '--start-maximized',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--excludeSwitches=enable-automation',
      '--disable-features=IsolateOrigins,site-per-process',
      '--incognito',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu'
    ]
  };

  // Keep proxy if provided
  if (process.env.PROXY_SERVER) {
    launchOptions.args.push(`--proxy-server=${process.env.PROXY_SERVER}`);
  } else if (process.platform === 'win32') {
    launchOptions.args.push('--proxy-server=http://192.168.2.150:7890');
  }

  if (!executablePath && process.platform === 'linux') {
    const installed = installChromeForLinux();
    if (installed) {
      executablePath = getExecutablePath() || findChromeInPuppeteerCache();
    }
  }

  if (executablePath) {
    launchOptions.executablePath = executablePath;
  } else {
    throw new Error('Chrome executable not found on system and could not be installed.');
  }

  return puppeteer.launch(launchOptions);
}

function toAbsoluteImage(src) {
  if (!src) return '';
  if (src.startsWith('//')) return 'https:' + src;
  return src;
}

function parseCnyPrice(text) {
  if (!text) return 0;
  const m = text.match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : 0;
}

function extractGoofishItemId(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    return String(parsed.searchParams.get('id') || '').trim();
  } catch {
    return '';
  }
}

async function translateFullTitleToArabic(title, fallbackText = '') {
  const source = String(title || '').trim().slice(0, GOOFISH_AI_TITLE_MAX_CHARS);
  if (!source || !SILICONFLOW_API_KEY) return fallbackText || source;
  try {
    const result = await callSiliconFlow([
      {
        role: 'system',
        content: 'You are an Arabic e-commerce localization expert. Rewrite Chinese marketplace product titles into natural Arabic product listing names. Keep brand names (Latin) unchanged and keep exact numbers/units.'
      },
      {
        role: 'user',
        content: `Convert this Chinese product title into one clean Arabic e-commerce title. Return Arabic title only, no JSON, no explanation.\nTitle: ${source}`
      }
    ], 0.2, 180);
    const translated = cleanAiText(sanitizeTranslationText(result));
    if (!translated || isLowQualityTranslationText(translated, 3)) return fallbackText || source;
    return translated;
  } catch {
    return fallbackText || source;
  }
}

async function translateDetailDescriptionToArabic(title, detailText, fallbackText = '') {
  const sourceTitle = String(title || '').trim().slice(0, GOOFISH_AI_TITLE_MAX_CHARS);
  const sourceDetail = String(detailText || '').trim().slice(0, 1800);
  if (!sourceDetail || !SILICONFLOW_API_KEY) return fallbackText || '';
  try {
    const result = await callSiliconFlow([
      {
        role: 'system',
        content: 'You are an Arabic e-commerce copywriter. Translate product details into natural Arabic listing description text. Keep facts, measurements, model names, and condition details accurate.'
      },
      {
        role: 'user',
        content: `Translate the following Chinese product detail text to Arabic for an e-commerce listing description.
Rules:
- Keep it factual and concise.
- Preserve all numbers, dimensions, model codes, and condition notes.
- Keep brand names unchanged.
- Do not add features not present in source.
- Output Arabic only.
Product title: ${sourceTitle}
Product details: ${sourceDetail}`
      }
    ], 0.2, 420);
    const translated = cleanDescriptionText(result);
    if (!translated || isLowQualityTranslationText(translated, 6)) return fallbackText || '';
    return translated;
  } catch {
    return fallbackText || '';
  }
}

async function updateProductTranslatedDescription(productId, descriptionAr) {
  const normalizedDescription = cleanDescriptionText(descriptionAr);
  if (!normalizedDescription) return;
  const metadataPatch = JSON.stringify({
    translatedDescription: normalizedDescription,
    detailTranslationUpdatedAt: new Date().toISOString()
  });
  await prisma.$executeRawUnsafe(`
    UPDATE "Product"
    SET "aiMetadata" = COALESCE("aiMetadata", '{}'::jsonb) || $2::jsonb,
        "updatedAt" = NOW()
    WHERE id = $1
  `, productId, metadataPatch);
}

async function generateTitleAndKeywords(title) {
  const fallback = String(title || '').trim().slice(0, GOOFISH_AI_TITLE_MAX_CHARS);
  if (!SILICONFLOW_API_KEY || !fallback) {
    return { titleAr: fallback, descriptionAr: fallback, keywords: [], translationSucceeded: false };
  }
  try {
    const prompt = [
      {
        role: 'system',
        content: 'You are an Arabic e-commerce localization expert for marketplace products. Produce high-quality Iraqi-friendly Modern Standard Arabic listing outputs.'
      },
      {
        role: 'user',
        content: `Return valid JSON only with this exact schema:
{"title_ar":"...","description_ar":"...","keywords":["..."]}

Task:
- Translate and rewrite the Chinese title into a natural Arabic marketplace product name.
- title_ar must be concise, product-focused, and suitable as listing title.
- description_ar must be a clear Arabic product description sentence or short paragraph based only on source title meaning.
- keywords must contain exactly ${KEYWORDS_PER_PRODUCT} unique Arabic search terms suitable for shopping queries.

Rules:
- Preserve brand names and model numbers exactly.
- Preserve quantities, dimensions, storage sizes, and condition words.
- Remove marketing fluff, emojis, and shipping chatter.
- Do not output Chinese text.
- Do not output markdown.

Chinese title: "${fallback}"`
      }
    ];
    const result = await callSiliconFlow(prompt, 0.2, 420);
    const raw = String(result || '').trim();
    if (!raw) {
        console.warn(`[AI Debug] generateTitleAndKeywords returned empty for title: ${fallback}`);
        return { titleAr: fallback, descriptionAr: fallback, keywords: [], translationSucceeded: false };
    }
    const parsed = parseAiTranslationPayload(raw);
    const titleAr = normalizeTranslatedTitle(parsed?.title_ar || raw, fallback);
    let descriptionAr = cleanDescriptionText(parsed?.description_ar || titleAr || fallback) || titleAr || fallback;
    
    // Log for debugging
    console.log(`[AI Debug] Translating: ${fallback.substring(0, 20)}...`);
    console.log(`[AI Debug] Title: ${titleAr.substring(0, 30)}...`);
    // console.log(`[AI Debug] Desc:`, descriptionAr);
    
    if (GOOFISH_AI_SECOND_PASS_DESCRIPTION && (!descriptionAr || descriptionAr.length < 15 || descriptionAr === titleAr)) {
      descriptionAr = cleanDescriptionText(await translateFullTitleToArabic(fallback, descriptionAr || titleAr || fallback)) || titleAr || fallback;
    }
    const titleLooksBad = isLowQualityTranslationText(titleAr, 3);
    const descriptionLooksBad = isLowQualityTranslationText(descriptionAr, 6);
    if (titleLooksBad || descriptionLooksBad) {
      return { titleAr: fallback, descriptionAr: fallback, keywords: [], translationSucceeded: false };
    }
    descriptionAr = cleanDescriptionText(descriptionAr) || titleAr || fallback;
    const seedText = `${titleAr} ${descriptionAr}`.trim();
    const keywords = ensureKeywordList(
      Array.isArray(parsed?.keywords)
        ? parsed.keywords
        : (parsed?.keywords || ''),
      seedText || fallback
    );
    const translationSucceeded = (titleAr && titleAr !== fallback && hasArabic(titleAr))
      || (descriptionAr && descriptionAr !== fallback && hasArabic(descriptionAr));
    return { titleAr, descriptionAr, keywords, translationSucceeded };
  } catch (e) {
    return { titleAr: fallback, descriptionAr: fallback, keywords: [], translationSucceeded: false };
  }
}

async function ensureDbReady() {
  console.log("ensureDbReady called. DISABLE_DB_WRITE:", DISABLE_DB_WRITE);
  if (DISABLE_DB_WRITE) {
    if (REQUIRE_DB_WRITE) {
      throw new Error('GOOFISH_DISABLE_DB_WRITE is true while DB write is required.');
    }
    return false;
  }
  if (isDbCircuitOpen()) {
    const now = Date.now();
    if (now - dbCircuitLastLogAt > 5000) {
      dbCircuitLastLogAt = now;
      console.warn(`[DB Circuit] Skipping DB connect during cooldown (${Math.ceil((dbCircuitOpenUntil - now) / 1000)}s left).`);
    }
    return false;
  }
  console.log("dbChecked:", dbChecked);
  if (dbConnectPromise) {
    return await dbConnectPromise;
  }
  if (dbChecked && dbReady) {
    if (!GOOFISH_DB_CONNECT_VERIFY_PING) return true;
    try {
      await dbPing();
      return true;
    } catch {
      dbReady = false;
      dbChecked = false;
    }
  }
  dbChecked = true;
  const maxAttempts = GOOFISH_DB_CONNECT_RETRIES;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(`Prisma connecting (attempt ${attempt})...`);
      const connected = await safeDbConnect();
      if (!connected) {
        throw dbLastConnectError || new Error('db connect failed');
      }
      dbReady = true;
      console.log('Database connection established.');
      return true;
    } catch (e) {
      recordDbEngineFailure(e);
      dbReady = false;
      dbChecked = false;
      const code = String(e?.code || '');
      const msg = String(e?.message || '');
      const retryable = code === 'P2024'
        || code === 'P1001'
        || code === 'P1017'
        || msg.includes('db connect failed')
        || msg.includes('Engine is not yet connected')
        || msg.includes('Response from the Engine was empty')
        || msg.includes('timed out after')
        || msg.includes("Can't reach database server")
        || msg.includes('Server has closed the connection');
      if (!retryable || attempt === maxAttempts) {
        console.error('Database unavailable.');
        console.error(String(e?.message || e));
        if (REQUIRE_DB_WRITE) {
          throw e;
        }
        return dbReady;
      }
      console.warn(`Database connection attempt ${attempt}/${maxAttempts} failed. Retrying in ${GOOFISH_DB_CONNECT_RETRY_DELAY_MS}ms...`);
      await safeDbDisconnect();
      await new Promise((resolve) => setTimeout(resolve, GOOFISH_DB_CONNECT_RETRY_DELAY_MS));
    }
  }
  if (REQUIRE_DB_WRITE) {
    throw new Error('Database unavailable after retries.');
  }
  return dbReady;
}

async function randomInteraction(page) {
  try {
    const width = await page.evaluate(() => window.innerWidth);
    const height = await page.evaluate(() => window.innerHeight);
    const moveCount = 5 + Math.floor(Math.random() * 5); // More moves
    
    // Random mouse movements
    for (let i = 0; i < moveCount; i++) {
      const x = Math.random() * width;
      const y = Math.random() * height;
      await page.mouse.move(x, y, { steps: 10 + Math.floor(Math.random() * 20) });
      await humanDelay(100, 400);
      
      // Occasionally hover over something if possible
      if (Math.random() < 0.3) {
         await humanDelay(200, 500);
      }
    }
    
    // Random scroll with pauses
    const scrollAmount = 300 + Math.floor(Math.random() * 500);
    await page.evaluate((amt) => window.scrollBy(0, amt), scrollAmount);
    await humanDelay(800, 1500);
    
    // Scroll back up a bit sometimes
    if (Math.random() < 0.4) {
      await page.evaluate(() => window.scrollBy(0, -100 - Math.floor(Math.random() * 200)));
      await humanDelay(500, 1000);
    }
  } catch {
  }
}

async function closeLoginPopup(page) {
  const selectors = [
    '.closeIconBg--cubvOqVh',
    'img.closeIcon--gwB7wNKs',
    '.closeIcon--gwB7wNKs'
  ];
  for (const selector of selectors) {
    try {
      const el = await page.$(selector);
      if (el) {
        await el.click();
        await humanDelay(600, 1200);
        return true;
      }
    } catch {}
  }
  return false;
}

async function openHomeAndSearch(page, term) {
  await page.goto('https://www.goofish.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await humanDelay(2000, 3500);
  await closeLoginPopup(page);
  await page.waitForSelector('input[class*="search-input--"]', { timeout: 30000 });
  await page.click('input[class*="search-input--"]', { clickCount: 3 });
  await page.keyboard.press('Backspace');
  await page.type('input[class*="search-input--"]', term, { delay: 40 + Math.floor(Math.random() * 40) });
  await humanDelay(250, 600);
  const submitBtn = await page.$('button.search-icon--bewLHteU, button[class*="search-icon--"]');
  if (submitBtn) {
    await submitBtn.click();
  } else {
    await page.keyboard.press('Enter');
  }
  await page.waitForSelector('#content div[class^="search-container--"] div[class^="feeds-list-container--"] a[class*="feeds-item-wrap--"]', { timeout: 30000 });
  await humanDelay(1200, 2200);
}

async function findExistingProductByUrl(url) {
  if (!url || url.includes('search?')) return null;
  if (!dbReady) return null;
  try {
    return await withTimeout(() => prisma.product.findFirst({
      where: { purchaseUrl: url },
      select: {
        id: true,
        name: true,
        keywords: true,
        aiMetadata: true
      }
    }), 'find existing product by url', 12000);
  } catch (error) {
    if (isRetryableDbError(error)) {
      dbReady = false;
      dbChecked = false;
    }
    return null;
  }
}

function shouldTranslateFromExistingProduct(existingProduct) {
  if (!existingProduct) {
    return { shouldTranslate: true, reason: 'no existing product' };
  }
  const existingName = cleanAiText(String(existingProduct.name || '').trim());
  const existingDescription = cleanDescriptionText(String(existingProduct?.aiMetadata?.translatedDescription || existingName).trim());
  const existingKeywords = Array.isArray(existingProduct.keywords) ? existingProduct.keywords : [];
  const hasGoodName = Boolean(existingName) && hasArabic(existingName) && !isChineseTerm(existingName);
  const hasGoodDescription = existingDescription.length >= 24 && hasArabic(existingDescription) && !isChineseTerm(existingDescription);
  const hasStrongKeywords = existingKeywords.length >= Math.max(10, Math.floor(KEYWORDS_PER_PRODUCT * 0.7));
  const shouldTranslate = !(hasGoodName && hasGoodDescription && hasStrongKeywords);
  const reason = shouldTranslate
    ? `existing data weak (name:${hasGoodName ? 'ok' : 'bad'}, desc:${hasGoodDescription ? 'ok' : 'bad'}, keywords:${hasStrongKeywords ? 'ok' : 'bad'})`
    : 'existing translated data is strong';
  return { shouldTranslate, reason };
}

async function saveProductToDb(item, existingProductId = null) {
  try {
    if (!item.url || item.url.includes('search?')) {
        console.warn('Skipping item with invalid URL:', item.url);
        return; 
    }
    const ready = await ensureDbReady();
    if (!ready) {
        throw makePipelineRestartError(`database not ready before save ${extractGoofishItemId(item.url) || 'item'}`);
    }

    const existing = existingProductId ? { id: existingProductId } : null;
    const metadata = {
      originalTitle: item.title,
      translatedDescription: item.descriptionAr || '',
      isRealBrand: typeof item.realBrand === 'boolean' ? item.realBrand : null,
      source: 'goofish',
      scrapedAt: new Date()
    };
    const keywordsList = ensureKeywordList(item.keywords, item.titleEn || item.title);
    const hasDetectedCondition = typeof item.newOrOld === 'boolean';
    const newOrOldValue = hasDetectedCondition ? item.newOrOld : null;

    const basePriceIQD = Math.max(0, Number(item.priceCny || 0) * CNY_TO_IQD_RATE);
    const multiplier = calculatePriceMultiplier(basePriceIQD);
    const priceIQD = Math.round(basePriceIQD * multiplier);
    if (existing) {
      try {
        await prisma.product.update({
          where: { id: existing.id },
          data: {
            name: item.titleEn || item.title,
            price: priceIQD,
            basePriceIQD,
            // keywords: keywordsList, // Removing this because it causes "Unknown argument" error
            aiMetadata: metadata,
            updatedAt: new Date(),
            ...(hasDetectedCondition ? { neworold: newOrOldValue } : {})
          }
        });
        // Update keywords using raw SQL to bypass Prisma schema mismatch
        const keywordsSql = Prisma.join(keywordsList);
        await prisma.$executeRaw`
          UPDATE "Product"
          SET "keywords" = ARRAY[${keywordsSql}]
          WHERE "id" = ${existing.id}
        `;
        try {
          await assignCategoryToProduct(existing.id, keywordsList);
        } catch (categoryErr) {
          console.warn(`Category assignment deferred for product ${existing.id}: ${toErrorText(categoryErr)}`);
          if (isRetryableDbError(categoryErr)) triggerDbReconnectNonBlocking(`category assign ${existing.id}`);
        }
        console.log(`Updated product: ${item.titleEn || item.title}`);
        return existing.id;
      } catch (updateError) {
        if (isRetryableDbError(updateError)) {
          throw updateError;
        }
        console.error('Update failed, trying raw SQL fallback:', updateError.message);
        const keywordsSql = Prisma.join(keywordsList);
        if (hasDetectedCondition) {
          await prisma.$executeRaw`
            UPDATE "Product"
            SET "price" = ${priceIQD},
                "basePriceIQD" = ${basePriceIQD},
                "name" = ${item.titleEn || item.title},
                "keywords" = ARRAY[${keywordsSql}],
                "neworold" = ${newOrOldValue},
                "aiMetadata" = ${JSON.stringify(metadata)}::jsonb,
                "updatedAt" = NOW()
            WHERE "id" = ${existing.id}
          `;
        } else {
          await prisma.$executeRaw`
            UPDATE "Product"
            SET "price" = ${priceIQD},
                "basePriceIQD" = ${basePriceIQD},
                "name" = ${item.titleEn || item.title},
                "keywords" = ARRAY[${keywordsSql}],
                "aiMetadata" = ${JSON.stringify(metadata)}::jsonb,
                "updatedAt" = NOW()
            WHERE "id" = ${existing.id}
          `;
        }
        console.log(`Updated product (raw SQL): ${item.titleEn || item.title}`);
        return existing.id;
      }
    } else {
      let newProduct;
      try {
        const createData = {
            name: item.titleEn || item.title,
            price: priceIQD,
            basePriceIQD,
            image: item.image,
            purchaseUrl: item.url,
            status: 'PUBLISHED',
            isActive: true,
            // keywords: keywordsList, // Removed to avoid "Unknown argument"
            aiMetadata: metadata,
            ...(hasDetectedCondition ? { neworold: newOrOldValue } : {})
        };
        newProduct = await prisma.product.create({
          data: createData
        });
        // Update keywords using raw SQL
        if (newProduct?.id) {
            const keywordsSql = Prisma.join(keywordsList);
            await prisma.$executeRaw`
                UPDATE "Product"
                SET "keywords" = ARRAY[${keywordsSql}]
                WHERE "id" = ${newProduct.id}
            `;
            try {
              await assignCategoryToProduct(newProduct.id, keywordsList);
            } catch (categoryErr) {
              console.warn(`Category assignment deferred for product ${newProduct.id}: ${toErrorText(categoryErr)}`);
              if (isRetryableDbError(categoryErr)) triggerDbReconnectNonBlocking(`category assign ${newProduct.id}`);
            }
        }
      } catch (createError) {
        if (isRetryableDbError(createError)) {
          throw createError;
        }
        console.warn(`Prisma create failed, trying minimal create fallback: ${toErrorText(createError)}`);
        const fallbackCreateData = {
          name: String(item.titleEn || item.title || '').slice(0, 380),
          price: priceIQD,
          basePriceIQD,
          image: item.image,
          purchaseUrl: item.url,
          status: 'PUBLISHED',
          isActive: true,
          ...(hasDetectedCondition ? { neworold: newOrOldValue } : {})
        };
        newProduct = await prisma.product.create({
          data: fallbackCreateData
        });
        if (newProduct?.id) {
          try {
            const keywordsSql = Prisma.join(keywordsList);
            await prisma.$executeRaw`
              UPDATE "Product"
              SET "keywords" = ARRAY[${keywordsSql}],
                  "aiMetadata" = ${JSON.stringify(metadata)}::jsonb
              WHERE "id" = ${newProduct.id}
            `;
            try {
              await assignCategoryToProduct(newProduct.id, keywordsList);
            } catch (categoryErr) {
              console.warn(`Category assignment deferred for product ${newProduct.id}: ${toErrorText(categoryErr)}`);
              if (isRetryableDbError(categoryErr)) triggerDbReconnectNonBlocking(`category assign ${newProduct.id}`);
            }
          } catch (fallbackMetaErr) {
            console.warn(`Post-create metadata update skipped for ${newProduct.id}: ${toErrorText(fallbackMetaErr)}`);
          }
        }
      }
      
      // Add main image
      if (item.image && newProduct?.id) {
        try {
          await withRetry(
            () => prisma.productImage.createMany({
              data: [{
                productId: newProduct.id,
                url: item.image,
                order: 0,
                type: 'GALLERY'
              }],
              skipDuplicates: true
            }),
            `insert product image ${newProduct.id}`,
            1,
            5000,
            500
          );
        } catch (imageErr) {
          console.warn(`Product image insert skipped for ${newProduct.id}: ${toErrorText(imageErr)}`);
        }
      }
      if (newProduct?.id) {
        console.log(`Saved to DB: id=${newProduct.id} title=${item.titleEn || item.title}`);
      } else {
        console.log(`Saved to DB: id=unknown title=${item.titleEn || item.title}`);
      }
      return newProduct?.id || null;
    }
  } catch (e) {
    console.error(`Failed to save product ${item.titleEn}:`, e.message);
    // Print stack trace for debugging
    if (e.stack) console.error(e.stack);
    if (isRetryableDbError(e)) {
      recordDbEngineFailure(e);
      dbReady = false;
      dbChecked = false;
      throw e;
    }
    return null;
  }
}

async function processProductDetails(page, product, detailProgress = null) {
  const mutationTimeoutMs = Math.max(5000, Number.parseInt(process.env.GOOFISH_MUTATION_TIMEOUT_MS || '15000', 10) || 15000);
  const mutationRetryCount = Math.max(1, Number.parseInt(process.env.GOOFISH_MUTATION_RETRY_COUNT || '3', 10) || 3);
  const imageMutationTimeoutMs = Math.max(5000, Number.parseInt(process.env.GOOFISH_IMAGE_MUTATION_TIMEOUT_MS || '10000', 10) || 10000);
  const imageMutationRetryCount = Math.max(1, Number.parseInt(process.env.GOOFISH_IMAGE_MUTATION_RETRY_COUNT || '1', 10) || 1);
  const embeddingMutationTimeoutMs = Math.max(5000, Number.parseInt(process.env.GOOFISH_EMBEDDING_MUTATION_TIMEOUT_MS || '8000', 10) || 8000);
  const embeddingMutationRetryCount = Math.max(1, Number.parseInt(process.env.GOOFISH_EMBEDDING_MUTATION_RETRY_COUNT || '1', 10) || 1);
  const newOrOldTimeoutMs = Math.max(4000, Number.parseInt(process.env.GOOFISH_NEWOROLD_TIMEOUT_MS || '8000', 10) || 8000);
  const newOrOldRetryCount = Math.max(1, Number.parseInt(process.env.GOOFISH_NEWOROLD_RETRY_COUNT || '3', 10) || 3);
  const retryBackoffMs = Math.max(200, Number.parseInt(process.env.GOOFISH_RETRY_BACKOFF_MS || '500', 10) || 500);
  const productTimeoutMs = Math.max(30000, Number.parseInt(process.env.GOOFISH_PRODUCT_TIMEOUT_MS || '120000', 10) || 120000);
  const specsMutationTimeoutMs = Math.max(4000, Number.parseInt(process.env.GOOFISH_SPECS_MUTATION_TIMEOUT_MS || '8000', 10) || 8000);
  const specsMutationRetryCount = Math.max(1, Number.parseInt(process.env.GOOFISH_SPECS_MUTATION_RETRY_COUNT || '1', 10) || 1);
  const updateNewOrOld = async (statusValue) => withRetry(
    () => prisma.$executeRaw`
      UPDATE "Product"
      SET "neworold" = ${statusValue},
          "updatedAt" = NOW()
      WHERE "id" = ${product.id}
    `,
    `update neworold raw ${product.id}`,
    newOrOldRetryCount,
    newOrOldTimeoutMs,
    retryBackoffMs
  );
  const updateSpecsValue = async (specsValue, label) => withRetry(
    () => prisma.$executeRaw`
      UPDATE "Product"
      SET "specs" = ${specsValue},
          "updatedAt" = NOW()
      WHERE "id" = ${product.id}
    `,
    label,
    specsMutationRetryCount,
    specsMutationTimeoutMs,
    retryBackoffMs
  );

  const progressLabel = detailProgress && Number.isFinite(detailProgress.current) && Number.isFinite(detailProgress.total)
    ? ` [${detailProgress.current}/${detailProgress.total}]`
    : '';
  console.log(`\n[Pipeline]${progressLabel} Checking details for Product ID ${product.id}: ${product.name}`);
  console.log(`URL: \`${product.url}\``);

  if (!product.url) {
    console.log(`⚠️ No URL. Skipping.`);
    return;
  }

  try {
    await ensureDbReady();
    await withTimeout(async () => {
      await page.goto(product.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    
      const delay = Math.floor(Math.random() * 1500) + 1000;
      await new Promise(r => setTimeout(r, delay));

      const pageContent = await page.evaluate(() => document.body.innerText);
      const title = await page.title();
    
      let isUnavailable = false;
      let unavailableReason = '';

      for (const keyword of UNAVAILABLE_KEYWORDS) {
        if (pageContent.includes(keyword) || title.includes(keyword)) {
          isUnavailable = true;
          unavailableReason = keyword;
          break;
        }
      }

      if (page.url().includes('login.taobao.com') || page.url().includes('login.tmall.com')) {
        console.warn('⚠️ Redirected to login page. Cannot verify status accurately. Skipping.');
        return;
      }

      if (isUnavailable) {
        console.log(`❌ Product ${product.id} is UNAVAILABLE. Reason: Found keyword: ${unavailableReason}`);
      
        await withRetry(
          () => prisma.product.update({
            where: { id: product.id },
            data: { isActive: false }
          }),
          `update isActive ${product.id}`,
          mutationRetryCount,
          mutationTimeoutMs,
          retryBackoffMs
        );
      } else {
        console.log(`✅ Product ${product.id} is AVAILABLE.`);
      
        const newOrOldStatus = await page.evaluate(() => {
          try {
            const images = Array.from(document.querySelectorAll('img'));
            const newImgUrl = 'https://gw.alicdn.com/imgextra/i3/O1CN015hOhg21hTpVIveeDA_!!6000000004279-2-tps-252-60.png';
            const usedImgUrl = 'https://gw.alicdn.com/imgextra/i4/O1CN01MQosre1EmUmuzzD3k_!!6000000000394-2-tps-252-60.png';
            const almostNewImgUrl = 'https://gw.alicdn.com/imgextra/i3/O1CN01yU5CER1wslIj9m7bv_!!6000000006364-2-tps-252-60.png';

            const hasNewImg = images.some(img => img.src === newImgUrl);
            const hasUsedImg = images.some(img => img.src === usedImgUrl);
            const hasAlmostNewImg = images.some(img => img.src === almostNewImgUrl);

            if (hasNewImg) return true;
            if (hasUsedImg || hasAlmostNewImg) return false;

            const labels = Array.from(document.querySelectorAll('.item--qI9ENIfp'));
            for (const label of labels) {
              const labelText = label.querySelector('.label--ejJeaTRV')?.innerText || '';
              const valueText = label.querySelector('.value--EyQBSInp')?.innerText || '';
          
              if (labelText.includes('成色')) {
                if (valueText.includes('全新')) return true;
                if (valueText.includes('使用痕迹') || valueText.includes('二手') || valueText.includes('闲置') || valueText.includes('有磨损') || valueText.includes('有划痕')) return false;
              }
            }

            const desc = document.querySelector('.desc--GaIUKUQY')?.innerText || '';
            if (desc.includes('全新') && !desc.includes('部分全新') && !desc.includes('99新')) return true;
            if (desc.includes('使用痕迹') || desc.includes('二手') || desc.includes('闲置')) return false;

            return null;
          } catch (e) {
            return null;
          }
        });

        if (newOrOldStatus !== null) {
          console.log(`ℹ️ Product ${product.id} detected as ${newOrOldStatus ? 'NEW' : 'USED'}. Updating...`);
          try {
            await updateNewOrOld(newOrOldStatus);
          } catch (updateErr) {
            console.error(`Error updating neworold for Product ${product.id} (code=${toErrorCode(updateErr) || 'n/a'}): ${toErrorText(updateErr)}`);
            const updateErrText = toErrorText(updateErr);
            const updateErrCode = toErrorCode(updateErr);
            if (
              updateErrText.includes('Server has closed the connection')
              || updateErrText.includes("Can't reach database server")
              || updateErrText.includes('timed out after')
              || updateErrCode === 'P1017'
              || updateErrCode === 'P1001'
            ) {
              await safeDbDisconnect();
              try {
                await withRetry(
                  () => prisma.$connect(),
                  'reconnect after neworold failure',
                  1,
                  12000,
                  500
                );
              } catch {}
              console.warn(`Skipping neworold update for Product ${product.id} after retries.`);
            }
          }
        }

        let translatedDetailDescription = '';
        const rawDetailDescription = cleanAiText(await page.evaluate(() => {
          const selectors = [
            '.desc--GaIUKUQY',
            '[class*="desc--"]',
            '.item-desc--fHfY0Q3N',
            '[class*="item-desc"]',
            '[class*="description"]'
          ];
          for (const selector of selectors) {
            const el = document.querySelector(selector);
            const txt = (el?.textContent || '').trim();
            if (txt) return txt;
          }
          const bodyText = (document.body?.innerText || '').trim();
          if (!bodyText) return '';
          const lines = bodyText
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
            .filter((line) => line.length >= 8)
            .slice(0, 30);
          return lines.join(' ');
        }));
        if (rawDetailDescription) {
          const fallbackDescription = cleanDescriptionText(String(product.name || '').trim());
          translatedDetailDescription = await translateDetailDescriptionToArabic(product.name || '', rawDetailDescription, fallbackDescription);
          if (translatedDetailDescription && hasArabic(translatedDetailDescription)) {
            try {
              await withRetry(
                () => updateProductTranslatedDescription(product.id, translatedDetailDescription),
                `update translated description ${product.id}`,
                mutationRetryCount,
                mutationTimeoutMs,
                retryBackoffMs
              );
              console.log(`✅ Updated translated description for Product ${product.id}`);
            } catch (descUpdateErr) {
              console.warn(`⚠️ Failed to update translated description for Product ${product.id}: ${toErrorText(descUpdateErr)}`);
              if (isRetryableDbError(descUpdateErr)) triggerDbReconnectNonBlocking(`update translated description ${product.id}`);
            }
          }
        }

        if (product.specs && product.specs !== 'null') {
          console.log(`ℹ️ Specs already exist for Product ${product.id}. Skipping extraction.`);
        } else {
          const rawSpecs = await page.evaluate(() => {
            try {
              const labels = Array.from(document.querySelectorAll('.labels--ndhPFgp8 .item--qI9ENIfp'));
              const specs = {};
          
              for (const item of labels) {
                const labelEl = item.querySelector('.label--ejJeaTRV');
                if (!labelEl) continue;
            
                let key = labelEl.innerText.replace(/[\n\r\s：:]/g, '').trim();
            
                const valueEl = item.querySelector('.value--EyQBSInp');
                if (!valueEl) continue;
                let value = valueEl.innerText.trim();
            
                if (key && value) {
                  specs[key] = value;
                }
              }
          
              return Object.keys(specs).length > 0 ? specs : null;
            } catch (e) {
              return null;
            }
          });

          if (rawSpecs) {
            console.log(`ℹ️ Found specs for Product ${product.id}:`, JSON.stringify(rawSpecs));
        
            const rawSpecsText = JSON.stringify(rawSpecs);
            const containsChinese = true;

            if (SILICONFLOW_API_KEY) {
              console.log(`ℹ️ Product ${product.id} specs found. Attempting translation...`);
              try {
                const prompt = `Translate this JSON from Chinese to Arabic. Translate keys and values. Return JSON only.\n${JSON.stringify(rawSpecs)}`;
                
                const translatedJsonStr = await callSiliconFlow([{ role: "user", content: prompt }], 0.2, 350);
                
                if (translatedJsonStr) {
                  const cleanJson = translatedJsonStr.replace(/```json/g, '').replace(/```/g, '').trim();
                  let translatedSpecs;
                  try {
                    translatedSpecs = JSON.parse(cleanJson);
                  } catch (parseErr) {
                     console.error(`❌ Failed to parse translated specs JSON for Product ${product.id}:`, parseErr.message);
                     translatedSpecs = rawSpecs;
                  }
                  
                  console.log(`✅ Translated specs for Product ${product.id}:`, JSON.stringify(translatedSpecs));
                  
                  await updateSpecsValue(JSON.stringify(translatedSpecs), `update specs ${product.id}`);
                } else {
                    console.warn(`⚠️ Translation returned empty for Product ${product.id}. Saving raw specs.`);
                    await updateSpecsValue(rawSpecsText, `update specs raw ${product.id}`);
                }
              } catch (err) {
                console.error(`❌ Failed to translate specs for Product ${product.id}:`, err.message);
                try {
                  await updateSpecsValue(rawSpecsText, `update specs fallback ${product.id}`);
                } catch (specFallbackErr) {
                  console.error(`❌ Failed to save fallback specs for Product ${product.id}: ${toErrorText(specFallbackErr)}`);
                }
              }
            } else {
              console.warn(`⚠️ SILICONFLOW_API_KEY missing. Saving raw specs for Product ${product.id}.`);
              await updateSpecsValue(rawSpecsText, `update specs raw ${product.id}`);
            }
          }
        }

        let mainImage = null;
        if (product.imagesChecked) {
          console.log(`ℹ️ Images already checked for Product ${product.id}. Skipping extraction.`);
        } else {
          console.log('Checking for images...');
          const images = await page.evaluate(() => {
            const container = document.querySelector('.item-main-window-list--od7DK4Fm');
            if (!container) return [];

            const imgElements = Array.from(container.querySelectorAll('img.fadeInImg--DnykYtf4'));
            return imgElements.map(img => img.getAttribute('src')).filter(src => src);
          });

          if (images.length > 0) {
            const cleanImages = images.map(url => {
              let clean = url;
              if (clean.startsWith('//')) clean = 'https:' + clean;
              return clean.replace(/_\d+x\d+.*$/, '').replace(/\.webp$/, '');
            });

            mainImage = cleanImages[0];

            console.log(`Found ${cleanImages.length} images. Updating database...`);
            if (isDbCircuitOpen()) {
              const remaining = Math.max(1, Math.ceil((dbCircuitOpenUntil - Date.now()) / 1000));
              console.warn(`[DB Circuit] Skipping image DB update for Product ${product.id} (${remaining}s left).`);
            } else {
              try {
                await withRetry(
                  () => prisma.product.update({
                    where: { id: product.id },
                    data: {
                      image: mainImage,
                      imagesChecked: true
                    }
                  }),
                  `update image base ${product.id}`,
                imageMutationRetryCount,
                imageMutationTimeoutMs,
                  retryBackoffMs
                );
                await withRetry(
                  () => prisma.productImage.deleteMany({
                    where: { productId: product.id }
                  }),
                  `delete images ${product.id}`,
                imageMutationRetryCount,
                imageMutationTimeoutMs,
                  retryBackoffMs
                );
                if (cleanImages.length > 0) {
                  await withRetry(
                    () => prisma.productImage.createMany({
                      data: cleanImages.map((url, index) => ({
                        productId: product.id,
                        url: url,
                        order: index,
                        type: 'GALLERY'
                      }))
                    }),
                    `create images ${product.id}`,
                    imageMutationRetryCount,
                    imageMutationTimeoutMs,
                    retryBackoffMs
                  );
                }
                console.log(`Images updated for Product ${product.id}`);
              } catch (imageDbErr) {
                console.warn(`Image DB update deferred for Product ${product.id}: ${toErrorText(imageDbErr)}`);
                if (isRetryableDbError(imageDbErr)) triggerDbReconnectNonBlocking(`image update ${product.id}`);
              }
            }
          } else {
            console.log('No images found with the specified selector.');
            if (isDbCircuitOpen()) {
              const remaining = Math.max(1, Math.ceil((dbCircuitOpenUntil - Date.now()) / 1000));
              console.warn(`[DB Circuit] Skipping imagesChecked update for Product ${product.id} (${remaining}s left).`);
            } else {
              try {
                await withRetry(
                  () => prisma.product.update({
                    where: { id: product.id },
                    data: { imagesChecked: true }
                  }),
                  `mark imagesChecked ${product.id}`,
                  imageMutationRetryCount,
                  imageMutationTimeoutMs,
                  retryBackoffMs
                );
                console.log(`Marked Product ${product.id} as checked (no images found).`);
              } catch (markErr) {
                console.warn(`imagesChecked update deferred for Product ${product.id}: ${toErrorText(markErr)}`);
                if (isRetryableDbError(markErr)) triggerDbReconnectNonBlocking(`imagesChecked ${product.id}`);
              }
            }
          }
        }

        // Now generate embedding
        // We need an image URL to embed. Either mainImage we just got, or the product.image from DB.
        const imageToEmbed = mainImage || product.image;
        if (imageToEmbed) {
          console.log(`[Pipeline] Generating embedding for Product ${product.id}...`);
          try {
            const embedding = await embedImage(imageToEmbed, GOOFISH_EMBED_USE_PRODUCT_NAME ? (product.name || null) : null);
            if (embedding && embedding.length > 0) {
              const isZero = embedding.every((v) => v === 0);
              if (isZero) {
                console.log(`Warning: Zero embedding for product ${product.id}. URL: ${imageToEmbed}`);
              }
              const vectorStr = `[${embedding.join(',')}]`;
              await withRetry(
                () => prisma.$executeRawUnsafe(`
                  UPDATE "Product"
                  SET "imageEmbedding" = $1::vector
                  WHERE id = $2
                `, vectorStr, product.id),
                `update embedding ${product.id}`,
                embeddingMutationRetryCount,
                embeddingMutationTimeoutMs,
                retryBackoffMs
              );
              console.log(`✅ Embedding saved for Product ${product.id}`);
            } else {
              console.warn(`⚠️ Failed to generate embedding for Product ${product.id}`);
            }
          } catch (embedErr) {
            console.error(`❌ Embedding error for Product ${product.id}: ${embedErr.message}`);
            if (isRetryableDbError(embedErr)) triggerDbReconnectNonBlocking(`embedding ${product.id}`);
          }
        } else {
          console.log(`ℹ️ No image available to embed for Product ${product.id}`);
        }
      }
    }, `process product ${product.id}`, productTimeoutMs);

  } catch (error) {
    console.error(`Error processing Product ${product.id}:`, error.message);
  }
}

async function run() {
  console.log("Starting goofish-pipeline run()...");
  const browser = await createBrowser();
  console.log("Browser created.");
  markPipelineProgress('run-start');
  startPipelineProgressWatchdog();
  const translationCache = loadTranslationCache();
  let pendingCacheWrites = 0;
  if (GOOFISH_RESET_TERMS_ON_START) {
    resetRunProgressKeepTermMemory();
    clearBatchLinksQueue();
  }
  if (SILICONFLOW_API_KEY) {
    console.log('AI translation is enabled (using env key).');
  } else {
    console.warn('AI translation is disabled: missing SILICONFLOW_API_KEY.');
  }
  // Ensure we use the incognito context (usually the first one for --incognito launch)
  // or explicitly create incognito context if browser isn't already one.
  // With --incognito arg, browser.newPage() typically opens incognito tab.
  // But to be safe, let's close existing blank tabs and ensure one target page.
  
  const pages = await browser.pages();
  let page = pages[0];
  if (!page) page = await browser.newPage();
  
  // Randomize Viewport slightly
  const width = 1920 + Math.floor(Math.random() * 100) - 50;
  const height = 1080 + Math.floor(Math.random() * 100) - 50;
  await page.setViewport({ width, height });

  // Rotate User Agent
  const ua = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
  await page.setUserAgent(ua);
  console.log(`Using User-Agent: ${ua}`);

  await page.setExtraHTTPHeaders({
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Cache-Control': 'max-age=0',
    'Upgrade-Insecure-Requests': '1'
  });
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'language', { get: () => 'zh-CN' });
    Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en'] });
    Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
    window.chrome = { runtime: {} };
  });

  // Cookie management
  const cookiesPath = path.join(__dirname, 'goofish-cookies.json');
  try {
    if (fs.existsSync(cookiesPath)) {
      const cookies = JSON.parse(fs.readFileSync(cookiesPath));
      await page.setCookie(...cookies);
      console.log('Restored cookies from goofish-cookies.json');
    }
  } catch (e) {
    console.error('Failed to load cookies:', e.message);
  }

  try {
    console.log('Opening Goofish...');
    const entryUrls = String(process.env.GOOFISH_ENTRY_URLS || 'https://www.goofish.com/,https://2.taobao.com/')
      .split(',')
      .map((url) => url.trim())
      .filter(Boolean);
    let opened = false;
    let openError = null;
    for (const entryUrl of entryUrls) {
      for (let attempt = 1; attempt <= 3 && !opened; attempt += 1) {
        try {
          markPipelineProgress(`open-entry ${entryUrl}`);
          await page.goto(entryUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
          opened = true;
          markPipelineProgress(`opened-entry ${entryUrl}`);
        } catch (error) {
          openError = error;
          const errorText = toErrorText(error);
          const errorCode = toErrorCode(error);
          console.warn(`Failed to open ${entryUrl} (attempt ${attempt}/3): ${errorText}${errorCode ? ` [${errorCode}]` : ''}`);
          if (attempt < 3) {
            await humanDelay(2000, 5000);
          }
        }
      }
      if (opened) break;
    }
    if (!opened) {
      throw openError || new Error('Failed to open Goofish');
    }

    // Handle login popup closer immediately if present
    try {
      const closeBtnSelector = '.closeIconBg--cubvOqVh, img.closeIcon--gwB7wNKs, .closeIcon--gwB7wNKs';
      const closeBtn = await page.$(closeBtnSelector);
      if (closeBtn) {
        console.log('Found login popup closer. Clicking...');
        await closeBtn.click();
        await humanDelay(1000, 2000);
      }
    } catch (e) {
      // Ignore if not found
    }

    // await ask('If you need to log in, do it now. Press ENTER to continue...');
    console.log('Waiting 5 seconds for manual login check (optional)...');
    await humanDelay(5000, 5000);

    // Save cookies after potential login
    try {
      const cookies = await page.cookies();
      fs.writeFileSync(cookiesPath, JSON.stringify(cookies, null, 2));
      console.log('Saved cookies to goofish-cookies.json');
    } catch (e) {
      console.error('Failed to save cookies:', e.message);
    }

    const ensureItemsLoaded = async (term) => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const state = await page.evaluate(() => {
          const cards = document.querySelectorAll('#content div[class^="search-container--"] div[class^="feeds-list-container--"] a[class*="feeds-item-wrap--"]');
          const cardCount = cards ? cards.length : 0;
          const emptyEl = document.querySelector('div[class*="empty-text-notfound--"]');
          const emptyText = (emptyEl?.textContent || '').trim();
          const isExplicitEmpty = /no items|没有.*商品|暂无|没有找到|没有内容/i.test(emptyText);
          return { cardCount, emptyText, isExplicitEmpty };
        });
        if (state.cardCount > 0) return true;
        if (state.isExplicitEmpty) {
          console.log(`Empty state detected: ${state.emptyText}`);
        }
        if (attempt === 0) {
          await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
          await humanDelay(3000, 5000);
          continue;
        }
        if (attempt === 1 && term) {
          await openHomeAndSearch(page, term);
          continue;
        }
      }
      return false;
    };
    const goToNextSearchPage = async () => {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await humanDelay(1000, 2000);
      const firstBefore = await page.evaluate(() => {
        const container = document.querySelector('#content div[class^="search-container--"] div[class^="feeds-list-container--"]');
        if (!container) return '';
        const t = container.querySelector('div[class*="row1-wrap-title--"]');
        return t?.getAttribute('title') || t?.textContent || '';
      });
      const nextBtn = await page.evaluateHandle(() => {
        const arrows = Array.from(document.querySelectorAll('.search-pagination-arrow-right--CKU78u4z'));
        if (arrows.length === 0) return null;
        return arrows[0].closest('button');
      });
      if (!nextBtn || await nextBtn.evaluate(node => node.disabled)) return false;
      try {
        await nextBtn.hover();
        await humanDelay(200, 500);
        await nextBtn.click();
      } catch (err) {
        await page.evaluate(btn => btn.click(), nextBtn);
      }
      await humanDelay(3500, 5500);
      const firstAfter = await page.evaluate(() => {
        const container = document.querySelector('#content div[class^="search-container--"] div[class^="feeds-list-container--"]');
        if (!container) return '';
        const t = container.querySelector('div[class*="row1-wrap-title--"]');
        return t?.getAttribute('title') || t?.textContent || '';
      });
      return (firstAfter && firstAfter.trim() && firstAfter.trim() !== String(firstBefore || '').trim());
    };

    const configuredMaxPages = parseInt(process.env.GOOFISH_MAX_PAGES || '0', 10);
    const estimatedItemsPerPage = Math.max(1, parseInt(process.env.GOOFISH_ESTIMATED_ITEMS_PER_PAGE || '30', 10) || 30);
    const requiredPagesForTermTarget = Math.max(1, Math.ceil(GOOFISH_LINKS_PER_TERM / estimatedItemsPerPage));
    const MAX_PAGES = Number.isFinite(configuredMaxPages) && configuredMaxPages > 0
      ? Math.max(configuredMaxPages, requiredPagesForTermTarget)
      : requiredPagesForTermTarget;
    console.log(`Items per search target: ${ITEMS_PER_SEARCH}. Max pages per term: ${MAX_PAGES}.`);
    let allItems = [];
    const extractItems = async () => {
      return await page.evaluate(() => {
        const toAbs = (src) => (src && src.startsWith('//') ? ('https:' + src) : (src || ''));
        const container = document.querySelector('#content div[class^="search-container--"] div[class^="feeds-list-container--"]');
        if (!container) return [];
        const cards = Array.from(container.querySelectorAll('a[class*="feeds-item-wrap--"]'));
        const out = [];
        for (const card of cards) {
          const imgEl = card.querySelector('img[class*="feeds-image--"]');
          const titleWrap = card.querySelector('div[class*="row1-wrap-title--"]');
          const mainTitle = titleWrap?.getAttribute('title') || titleWrap?.innerText || '';
          const conditionText = Array.from(card.querySelectorAll('div[class*="row2-wrap-cpv--"] span[class*="cpv--"]'))
            .map((el) => (el?.textContent || '').trim())
            .filter(Boolean)
            .join(' ');
          const priceWrap = card.querySelector('div[class*="row3-wrap-price--"] div[class*="price-wrap--"]');
          const numEl = priceWrap?.querySelector('span[class*="number--"]');
          const decEl = priceWrap?.querySelector('span[class*="decimal--"]');
          let priceText = '';
          if (numEl) {
            priceText = numEl.textContent?.trim() || '';
            if (decEl && decEl.textContent) priceText += decEl.textContent.trim();
          } else if (priceWrap) {
            priceText = priceWrap.textContent?.trim() || '';
          }
          const url = card.getAttribute('href')?.startsWith('http')
            ? card.getAttribute('href')
            : (card.getAttribute('href') ? `https://www.goofish.com${card.getAttribute('href')}` : '');
          out.push({
            title: (mainTitle || '').trim(),
            conditionText: (conditionText || '').trim(),
            priceText: (priceText || '').trim(),
            image: toAbs(imgEl?.getAttribute('src') || ''),
            url
          });
        }
        return out;
      });
    };
    const processCollectedLink = async (item) => {
      if (!item?.url) return null;
      let cny = parseCnyPrice(item.priceText);
      const detectedPrice = detectRealPriceFromTitle(item.title, cny);
      if (detectedPrice !== cny && detectedPrice > 0) cny = detectedPrice;
      const newOrOld = detectNewOrOldFromTexts(item.title, item.conditionText);
      const realBrand = detectRealBrandFromTexts(item.title, item.conditionText);
      let titleEn = String(item.title || '').trim();
      let descriptionAr = titleEn;
      let keywords = [];
      const resolvedUrl = item.url || '';
      const resolveDetailTargetFromDbByUrl = async () => {
        try {
          await ensureDbReady();
          if (!dbReady) return null;
          const fromDb = await withTimeout(
            () => prisma.product.findFirst({
              where: { purchaseUrl: resolvedUrl },
              select: {
                id: true,
                name: true,
                purchaseUrl: true,
                image: true,
                imagesChecked: true,
                specs: true
              }
            }),
            `resolve detail by url ${extractGoofishItemId(resolvedUrl) || 'item'}`,
            8000
          );
          if (!fromDb?.id) return null;
          return {
            id: fromDb.id,
            url: fromDb.purchaseUrl || resolvedUrl,
            name: fromDb.name || titleEn || item.title,
            image: fromDb.image || item.image || '',
            imagesChecked: fromDb.imagesChecked || false,
            specs: fromDb.specs || null
          };
        } catch (resolveErr) {
          if (isRetryableDbError(resolveErr)) triggerDbReconnectNonBlocking(`resolve detail ${extractGoofishItemId(resolvedUrl) || 'item'}`);
          return null;
        }
      };
      const existingProduct = await findExistingProductByUrl(resolvedUrl);
      if (existingProduct) {
        titleEn = cleanAiText(String(existingProduct.name || titleEn).trim()) || titleEn;
        descriptionAr = cleanDescriptionText(String(existingProduct?.aiMetadata?.translatedDescription || titleEn).trim()) || titleEn;
        keywords = ensureKeywordList(existingProduct.keywords, titleEn || item.title);
      }
      const translationDecision = shouldTranslateFromExistingProduct(existingProduct);
      if (SILICONFLOW_API_KEY && translationDecision.shouldTranslate) {
        const cachedTranslation = getCachedTranslation(translationCache, item.title);
        const canUseCachedDescription = cachedTranslation
          && cachedTranslation.descriptionAr
          && cachedTranslation.descriptionAr.length >= 24
          && cachedTranslation.descriptionAr !== cachedTranslation.titleAr
          && hasArabic(cachedTranslation.descriptionAr);
        if (canUseCachedDescription) {
          titleEn = cachedTranslation.titleAr;
          descriptionAr = cachedTranslation.descriptionAr;
          keywords = cachedTranslation.keywords;
        } else {
          const generated = await generateTitleAndKeywords(item.title);
          if (GOOFISH_SKIP_ON_TRANSLATION_FAILURE && !generated.translationSucceeded) {
            return existingProduct?.id ? {
              id: existingProduct.id,
              url: resolvedUrl,
              name: titleEn || item.title,
              image: item.image || '',
              imagesChecked: existingProduct?.imagesChecked || false,
              specs: existingProduct?.specs || null
            } : null;
          }
          titleEn = generated.titleAr;
          descriptionAr = generated.descriptionAr;
          keywords = generated.keywords;
          if (generated.translationSucceeded) {
            setCachedTranslation(translationCache, item.title, generated);
            pendingCacheWrites += 1;
            if (pendingCacheWrites >= GOOFISH_TRANSLATION_CACHE_FLUSH_EVERY) {
              saveTranslationCache(translationCache);
              pendingCacheWrites = 0;
            }
          }
        }
      }
      titleEn = sanitizeTranslationText(titleEn);
      descriptionAr = cleanDescriptionText(descriptionAr);
      if (GOOFISH_ENABLE_TRANSLATION_RETRY && SILICONFLOW_API_KEY && (!descriptionAr || descriptionAr === item.title || isChineseTerm(descriptionAr))) {
        if (isChineseTerm(titleEn)) titleEn = await translateFullTitleToArabic(item.title, item.title);
        descriptionAr = cleanDescriptionText(await translateFullTitleToArabic(item.title, item.title));
      }
      const itemData = {
        title: item.title || '',
        titleEn: titleEn || '',
        descriptionAr: descriptionAr || '',
        keywords,
        newOrOld,
        realBrand,
        priceCny: cny,
        image: item.image || '',
        url: resolvedUrl
      };
      if (OUTPUT_JSON) allItems.push(itemData);
      const goofishItemId = extractGoofishItemId(resolvedUrl);
      if (isDbCircuitOpen()) {
        if (!existingProduct?.id) {
          throw makePipelineRestartError(`db circuit open before save ${goofishItemId || 'n/a'}`);
        }
        return {
          id: existingProduct.id,
          url: resolvedUrl,
          name: titleEn || item.title,
          image: existingProduct?.image || item.image || '',
          imagesChecked: existingProduct?.imagesChecked || false,
          specs: existingProduct?.specs || null
        };
      }
      let dbId = null;
      try {
        dbId = await withRetry(
          () => saveProductToDb(itemData, existingProduct?.id || null),
          `save product ${item.title?.slice(0, 20) || 'item'}`,
          1,
          GOOFISH_DB_SAVE_TIMEOUT_MS,
          GOOFISH_DB_SAVE_BACKOFF_MS
        );
      } catch (saveErr) {
        if (GOOFISH_DB_SAVE_FATAL_ON_RETRY_EXHAUST && isRetryableDbError(saveErr)) {
          console.error(`[DB Save] Retry exhausted itemId=${goofishItemId || 'n/a'} url=${resolvedUrl} sourceTitle=${cleanAiText(String(item.title || '').slice(0, 50))} error=${toErrorText(saveErr)}`);
          const now = Date.now();
          const reconnectCooldownLeft = Math.max(0, GOOFISH_DB_FORCE_RECONNECT_MIN_INTERVAL_MS - (now - dbLastForceReconnectAt));
          if (isDbCircuitOpen()) {
            console.warn(`[DB Reconnect] Skipped force reconnect because DB circuit is open (${Math.max(1, Math.ceil((dbCircuitOpenUntil - now) / 1000))}s left).`);
          } else if (reconnectCooldownLeft > 0) {
            console.warn(`[DB Reconnect] Skipped force reconnect due to cooldown (${Math.ceil(reconnectCooldownLeft / 1000)}s left).`);
          } else {
            dbLastForceReconnectAt = now;
            try {
              await forceDbReconnectFromScratch(`save product ${item.title?.slice(0, 20) || 'item'}`);
            } catch (reconnectErr) {
              console.warn(`[DB Reconnect] Failed after save timeout: ${toErrorText(reconnectErr)}`);
            }
          }
        }
        if (existingProduct?.id) {
          return {
            id: existingProduct.id,
            url: resolvedUrl,
            name: titleEn || item.title,
            image: existingProduct?.image || item.image || '',
            imagesChecked: existingProduct?.imagesChecked || false,
            specs: existingProduct?.specs || null
          };
        }
        const recoveredTarget = await resolveDetailTargetFromDbByUrl();
        if (recoveredTarget) return recoveredTarget;
        throw makePipelineRestartError(`failed to persist item ${goofishItemId || 'n/a'}`, saveErr);
      }
      if (!dbId) {
        const recoveredTarget = await resolveDetailTargetFromDbByUrl();
        if (recoveredTarget) return recoveredTarget;
        throw makePipelineRestartError(`save returned no db target for ${goofishItemId || 'n/a'}`);
      }
      return {
        id: dbId,
        url: resolvedUrl,
        name: titleEn || item.title,
        image: item.image || '',
        imagesChecked: existingProduct?.imagesChecked || false,
        specs: existingProduct?.specs || null
      };
    };
    let cycleIndex = 0;
    while (true) {
      markPipelineProgress('cycle-start');
      cycleIndex += 1;
      let processedCount = 0;
      allItems = [];
      console.log(`[Pipeline] Starting term cycle ${cycleIndex}...`);
      const { terms: searchTerms, startIndex, batchId, source } = await getSearchTermsForRun();
      const safeStartIndex = Math.max(0, Math.min(searchTerms.length, Number(startIndex || 0) || 0));
      console.log(`Loaded ${searchTerms.length} search terms for this batch.`);
      console.log(`Batch source: ${source}.`);
      console.log(`Starting from term ${Math.min(searchTerms.length, safeStartIndex + 1)}/${searchTerms.length}.`);
      const existingQueue = loadBatchLinksQueue();
      const queueMatchesBatch = existingQueue
        && existingQueue.batchId === batchId
        && Array.isArray(existingQueue.termStates)
        && existingQueue.termStates.length === searchTerms.length;
      const queue = queueMatchesBatch
        ? existingQueue
        : {
            batchId,
            source,
            phase: 'collect',
            nextCollectTerm: safeStartIndex,
            nextProcessTerm: 0,
            termStates: searchTerms.map((term, termIndex) => ({
              term,
              termIndex,
              items: [],
              seenUrls: [],
              collectDone: false,
              processIndex: 0,
              updatedAt: null
            })),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };
      if (queue.phase === 'collect') {
        for (let termIndex = queue.nextCollectTerm; termIndex < searchTerms.length; termIndex += 1) {
          const term = searchTerms[termIndex];
          const state = queue.termStates[termIndex] || { term, termIndex, items: [], seenUrls: [], collectDone: false, processIndex: 0 };
          const seenUrls = new Set(Array.isArray(state.seenUrls) ? state.seenUrls : []);
          let termCollected = Array.isArray(state.items) ? state.items.length : 0;
          console.log(`[Collect] ${term} (${termCollected}/${GOOFISH_LINKS_PER_TERM})`);
          await openHomeAndSearch(page, term);
          const ok = await ensureItemsLoaded(term);
          if (!ok) continue;
          let pageIndex = 0;
          while (pageIndex < MAX_PAGES && termCollected < GOOFISH_LINKS_PER_TERM) {
            markPipelineProgress(`collect ${term} page ${pageIndex + 1}`);
            pageIndex += 1;
            await closeLoginPopup(page);
            await page.waitForSelector('#content div[class^="search-container--"] div[class^="feeds-list-container--"] a[class*="feeds-item-wrap--"]', { timeout: 30000 });
            await humanDelay(1600, 2600);
            const items = await extractItems();
            console.log(`[Collect][${term}] Page ${pageIndex} -> ${items.length} raw items`);
            for (const it of items) {
              if (termCollected >= GOOFISH_LINKS_PER_TERM) break;
              const url = String(it?.url || '').trim();
              if (!url || seenUrls.has(url)) continue;
              if (isExcludedProduct(it.title)) continue;
              seenUrls.add(url);
              state.items = Array.isArray(state.items) ? state.items : [];
              state.items.push({
                url,
                title: String(it.title || '').trim(),
                conditionText: String(it.conditionText || '').trim(),
                priceText: String(it.priceText || '').trim(),
                image: String(it.image || '').trim()
              });
              termCollected += 1;
              markPipelineProgress(`collect-hit ${term}`);
              console.log(`[Collect][${term}] ${termCollected}/${GOOFISH_LINKS_PER_TERM}`);
            }
            state.seenUrls = Array.from(seenUrls).slice(-Math.max(300, GOOFISH_LINKS_PER_TERM * 3));
            queue.termStates[termIndex] = state;
            queue.nextCollectTerm = termIndex;
            queue.updatedAt = new Date().toISOString();
            saveBatchLinksQueue(queue);
            updateActiveBatchTermCheckpoint(batchId, termIndex, termCollected, state.seenUrls, { collectPageIndex: pageIndex });
            if (termCollected >= GOOFISH_LINKS_PER_TERM) break;
            const changed = await goToNextSearchPage();
            if (!changed) break;
          }
          state.collectDone = true;
          state.updatedAt = new Date().toISOString();
          queue.termStates[termIndex] = state;
          queue.nextCollectTerm = termIndex + 1;
          queue.updatedAt = new Date().toISOString();
          saveBatchLinksQueue(queue);
          updateActiveBatchProgress(batchId, termIndex + 1);
        }
        queue.phase = 'process';
        queue.nextProcessTerm = 0;
        queue.updatedAt = new Date().toISOString();
        saveBatchLinksQueue(queue);
      }
      let reachedProcessLimit = false;
      if (queue.phase === 'process') {
        await ensureDbReady();
        console.log("DB ready.");
        for (let termIndex = queue.nextProcessTerm; termIndex < searchTerms.length; termIndex += 1) {
          const state = queue.termStates[termIndex];
          if (!state) continue;
          const term = state.term || searchTerms[termIndex];
          state.items = Array.isArray(state.items) ? state.items : [];
          const processedBeforeTerm = Math.max(0, Number(state.processIndex || 0));
          const totalKnownForTerm = Math.max(state.items.length + processedBeforeTerm, processedBeforeTerm);
          console.log(`[Process] ${term}: ${processedBeforeTerm}/${totalKnownForTerm}`);
          while (state.items.length > 0) {
            markPipelineProgress(`process-start ${term}`);
            if (processedCount >= MAX_PRODUCTS_TO_PROCESS) {
              reachedProcessLimit = true;
              break;
            }
            const currentItem = state.items[0];
            const currentProgress = Math.max(0, Number(state.processIndex || 0)) + 1;
            const currentTotalForTerm = Math.max(state.items.length + Math.max(0, Number(state.processIndex || 0)), currentProgress);
            const currentItemId = extractGoofishItemId(currentItem?.url);
            const sourceTitle = cleanAiText(String(currentItem?.title || '').slice(0, 80));
            console.log(`[ProcessItem] term="${term}" progress=${currentProgress}/${currentTotalForTerm} itemId=${currentItemId || 'n/a'} url=${currentItem?.url || ''}`);
            if (sourceTitle) {
              console.log(`[ProcessItem] sourceTitle=${sourceTitle}`);
            }
            try {
              markPipelineProgress(`process-link ${currentItemId || 'n/a'}`);
              const detailTarget = await withTimeout(
                () => processCollectedLink(currentItem),
                `process link ${currentItemId || 'n/a'}`,
                GOOFISH_PROCESS_LINK_TIMEOUT_MS
              );
              if (detailTarget) {
                await processProductDetails(page, detailTarget, {
                  current: currentProgress,
                  total: currentTotalForTerm
                });
              } else {
                console.warn(`[ProcessItem] detail phase skipped itemId=${currentItemId || 'n/a'} reason=no-db-target`);
              }
              markPipelineProgress(`process-done ${currentItemId || 'n/a'}`);
            } catch (itemErr) {
              if (shouldRestartPipelineForItemError(itemErr)) {
                queue.termStates[termIndex] = state;
                queue.nextProcessTerm = termIndex;
                queue.updatedAt = new Date().toISOString();
                saveBatchLinksQueue(queue);
                console.error(`[Process] Fatal processing failure. Restart required: ${toErrorText(itemErr)}`);
                throw itemErr;
              }
              console.error(`[Process] Failed processing link, skipping to next: ${toErrorText(itemErr)}`);
            }
            processedCount += 1;
            state.items.shift();
            state.processIndex = Math.max(0, Number(state.processIndex || 0)) + 1;
            state.updatedAt = new Date().toISOString();
            queue.termStates[termIndex] = state;
            queue.nextProcessTerm = termIndex;
            queue.updatedAt = new Date().toISOString();
            saveBatchLinksQueue(queue);
            console.log(`[ProcessItem] completed progress=${state.processIndex}/${Math.max(state.items.length + state.processIndex, state.processIndex)} itemId=${currentItemId || 'n/a'}`);
            markPipelineProgress(`item-committed ${currentItemId || 'n/a'}`);
          }
          if (reachedProcessLimit) break;
          queue.nextProcessTerm = termIndex + 1;
          queue.updatedAt = new Date().toISOString();
          saveBatchLinksQueue(queue);
        }
      }
      if (!reachedProcessLimit && queue.phase === 'process') {
        clearBatchLinksQueue();
        clearActiveBatch(batchId);
        if (pendingCacheWrites > 0) {
          saveTranslationCache(translationCache);
          pendingCacheWrites = 0;
        }
      }
      if (OUTPUT_JSON) {
        const outputPath = path.join(process.cwd(), 'goofish-results.json');
        fs.writeFileSync(outputPath, JSON.stringify(allItems, null, 2));
        console.log(`Cycle ${cycleIndex} saved ${allItems.length} items to ${outputPath}`);
      } else {
        console.log(`Cycle ${cycleIndex} finished in database mode.`);
      }
      if (pendingCacheWrites > 0) {
        saveTranslationCache(translationCache);
        pendingCacheWrites = 0;
      }
      if (reachedProcessLimit) {
        console.log(`[Pipeline] Hit MAX_PRODUCTS_TO_PROCESS=${MAX_PRODUCTS_TO_PROCESS}. Continuing with current batch progress.`);
      } else {
        console.log('[Pipeline] Batch completed. Generating a fresh term batch and continuing...');
      }
      await humanDelay(1000, 2500);
      markPipelineProgress('cycle-sleep-done');
    }
    if (pendingCacheWrites > 0) {
      saveTranslationCache(translationCache);
      pendingCacheWrites = 0;
    }
  } catch (e) {
    console.error('Scraper error:', e);
    process.exit(1);
  } finally {
    stopPipelineProgressWatchdog();
    await browser.close();
  }
}

async function updateExistingGoofishProducts() {
  await ensureDbReady();
  if (UPDATE_RESET_PROGRESS) {
    clearUpdateExistingProgress();
  }
  const resumeProgress = loadUpdateExistingProgress();
  const limit = Number.isFinite(UPDATE_LIMIT) && UPDATE_LIMIT > 0 ? UPDATE_LIMIT : Number.POSITIVE_INFINITY;
  let updatedCount = resumeProgress ? resumeProgress.updatedCount : 0;
  let scanned = resumeProgress ? resumeProgress.scanned : 0;
  let lastId = Math.max(UPDATE_START_ID, resumeProgress ? resumeProgress.lastId : 0);
  let batchIndex = 0;
  const updatedLog = [];
  console.log('Starting Goofish keyword update for existing products...');
  console.log('Update settings:', {
    startId: lastId,
    limit: Number.isFinite(limit) ? limit : 'all',
    batchSize: UPDATE_BATCH_SIZE,
    delayMin: UPDATE_DELAY_MIN,
    delayMax: UPDATE_DELAY_MAX,
    progressEvery: UPDATE_PROGRESS_EVERY
  });
  if (resumeProgress) {
    console.log('Resuming update progress:', {
      lastId: resumeProgress.lastId,
      scanned: resumeProgress.scanned,
      updatedCount: resumeProgress.updatedCount,
      updatedAt: resumeProgress.updatedAt
    });
  }

  const safeReconnect = async () => {
    const recovered = await recoverDbConnection('update-existing reconnect', GOOFISH_DB_CONNECT_RETRY_DELAY_MS, 1);
    if (!recovered) {
      throw new Error(`db recovery failed for update-existing reconnect after ${GOOFISH_DB_RECOVER_WAIT_MS}ms`);
    }
  };

  while (scanned < limit) {
    const take = Math.min(UPDATE_BATCH_SIZE, limit - scanned);
    let products = [];
    try {
      products = await prisma.$queryRaw`
        SELECT id, name, "purchaseUrl", "aiMetadata", "keywords"
        FROM "Product"
        WHERE id > ${lastId}
          AND ("purchaseUrl" ILIKE ${'%goofish.com%'} OR "purchaseUrl" ILIKE ${'%xianyu.com%'})
        ORDER BY id ASC
        LIMIT ${take}
      `;
    } catch (error) {
      const errMsg = String(error?.message || '');
      if (error?.code === 'P1017' || error?.code === 'P1001' || errMsg.includes('Engine is not yet connected')) {
        console.warn('DB connection issue. Reconnecting...');
        await safeReconnect();
        continue;
      }
      throw error;
    }
    console.log(`Batch ${batchIndex + 1}: loaded ${products.length} products`);
    if (products.length === 0) break;

    for (const product of products) {
      lastId = product.id;
      scanned += 1;
      if (scanned > limit) break;

      const aiMetadata = product.aiMetadata && typeof product.aiMetadata === 'object' ? product.aiMetadata : {};
      const originalTitle = typeof aiMetadata?.originalTitle === 'string' ? aiMetadata.originalTitle : '';
      const baseTitle = originalTitle || product.name || '';
      if (!baseTitle) continue;

      let titleAr = '';
      let descriptionAr = '';
      let keywords = [];
      const existingDescription = cleanAiText(sanitizeTranslationText(String(aiMetadata?.translatedDescription || '').trim()));
      const normalizedName = cleanAiText(sanitizeTranslationText(String(product.name || '').trim()));
      const hasGoodExistingDescription = existingDescription.length >= 24;
      const hasGoodExistingName = normalizedName && hasArabic(normalizedName);
      const hasStrongExistingKeywords = Array.isArray(product.keywords) && product.keywords.length >= Math.max(10, Math.floor(KEYWORDS_PER_PRODUCT * 0.7));

      if (SILICONFLOW_API_KEY) {
        if (hasGoodExistingName && hasGoodExistingDescription && hasStrongExistingKeywords) {
          titleAr = normalizedName;
          descriptionAr = existingDescription;
          keywords = ensureKeywordList(product.keywords, `${titleAr} ${descriptionAr}`.trim());
        } else {
          if (scanned % UPDATE_PROGRESS_EVERY === 0) {
            console.log(`Generating keywords for product ${product.id}...`);
          }
          const generated = await generateTitleAndKeywords(baseTitle);
          titleAr = generated.titleAr;
          descriptionAr = generated.descriptionAr;
          keywords = generated.keywords;
        }
      }

      const fallbackDescription = typeof aiMetadata?.translatedDescription === 'string' ? aiMetadata.translatedDescription : '';
      const seedText = `${titleAr || product.name} ${descriptionAr || fallbackDescription}`.trim();
      const beforeKeywords = Array.isArray(product.keywords) ? product.keywords : [];
      const finalKeywords = ensureKeywordList(
        Array.isArray(keywords) && keywords.length > 0 ? keywords : [],
        seedText
      );
      const nextMetadata = {
        ...aiMetadata,
        translatedDescription: descriptionAr || fallbackDescription || seedText
      };
      const shouldUpdateName = titleAr && (isChineseTerm(product.name) || !hasArabic(product.name));
      const keywordsSql = Prisma.join(finalKeywords);
      try {
        if (shouldUpdateName) {
          await prisma.$executeRaw`
            UPDATE "Product"
            SET "name" = ${titleAr},
                "keywords" = ARRAY[${keywordsSql}],
                "aiMetadata" = ${JSON.stringify(nextMetadata)}::jsonb,
                "updatedAt" = NOW()
            WHERE "id" = ${product.id}
          `;
        } else {
          await prisma.$executeRaw`
            UPDATE "Product"
            SET "keywords" = ARRAY[${keywordsSql}],
                "aiMetadata" = ${JSON.stringify(nextMetadata)}::jsonb,
                "updatedAt" = NOW()
            WHERE "id" = ${product.id}
          `;
        }
      } catch (error) {
        const errMsg = String(error?.message || '');
        if (error?.code === 'P1017' || error?.code === 'P1001' || errMsg.includes('Engine is not yet connected')) {
          console.warn(`DB connection issue while updating product ${product.id}. Reconnecting...`);
          await safeReconnect();
          continue;
        }
        throw error;
      }
      updatedCount += 1;
      if (updatedLog.length < 120) {
        const beforePreview = beforeKeywords.slice(0, 12);
        const afterPreview = finalKeywords.slice(0, 12);
        updatedLog.push({
          id: product.id,
          name: product.name,
          beforeCount: beforeKeywords.length,
          afterCount: finalKeywords.length,
          beforePreview,
          afterPreview
        });
      }
      if (updatedCount % UPDATE_PROGRESS_EVERY === 0) {
        console.log(`Progress: updated ${updatedCount}, scanned ${scanned}`);
      }
      saveUpdateExistingProgress({ lastId, scanned, updatedCount });
      await humanDelay(UPDATE_DELAY_MIN, UPDATE_DELAY_MAX);
    }
    batchIndex += 1;
    saveUpdateExistingProgress({ lastId, scanned, updatedCount });
    if (batchIndex % 4 === 0) {
      await safeReconnect();
    }
  }

  clearUpdateExistingProgress();
  console.log(`Existing Goofish products update completed. Updated: ${updatedCount}, Scanned: ${scanned}`);
  if (updatedLog.length > 0) {
    console.log('Updated keyword samples:', updatedLog.slice(0, 20));
  }
}

async function runDetailsOnly() {
  console.log('Starting goofish details-only mode...');
  await ensureDbReady();
  const browser = await createBrowser();
  const pages = await browser.pages();
  let page = pages[0];
  if (!page) page = await browser.newPage();
  const width = 1920 + Math.floor(Math.random() * 100) - 50;
  const height = 1080 + Math.floor(Math.random() * 100) - 50;
  await page.setViewport({ width, height });
  const ua = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
  await page.setUserAgent(ua);
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Cache-Control': 'max-age=0',
    'Upgrade-Insecure-Requests': '1'
  });
  const cookiesPath = path.join(__dirname, 'goofish-cookies.json');
  if (fs.existsSync(cookiesPath)) {
    try {
      const cookies = JSON.parse(fs.readFileSync(cookiesPath, 'utf8'));
      if (Array.isArray(cookies) && cookies.length > 0) {
        await page.setCookie(...cookies);
      }
    } catch {}
  }
  const detailsWhere = GOOFISH_DETAILS_IDS.length > 0
    ? { id: { in: GOOFISH_DETAILS_IDS } }
    : {
      purchaseUrl: { contains: 'goofish.com' },
      isActive: true
    };
  const products = await withRetry(
    () => prisma.product.findMany({
      where: detailsWhere,
      select: {
        id: true,
        name: true,
        purchaseUrl: true,
        image: true,
        imagesChecked: true,
        specs: true
      },
      orderBy: { updatedAt: 'desc' },
      take: GOOFISH_DETAILS_IDS.length > 0 ? undefined : GOOFISH_DETAILS_LIMIT
    }),
    'load details-only products',
    3,
    20000,
    800
  );
  console.log(`Details-only picked ${products.length} products.`);
  for (const p of products) {
    await processProductDetails(page, {
      id: p.id,
      url: p.purchaseUrl,
      name: p.name,
      image: p.image,
      imagesChecked: p.imagesChecked,
      specs: p.specs
    });
  }
  await browser.close();
  console.log('Details-only mode finished.');
}

if (UPDATE_EXISTING) {
  updateExistingGoofishProducts()
    .catch((error) => {
      console.error('Goofish existing update error:', error);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
} else if (GOOFISH_DETAILS_ONLY) {
  runDetailsOnly()
    .catch((error) => {
      console.error('Goofish details-only error:', error);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
} else {
  run().catch(e => {
    console.error("Pipeline failed with error:", e);
    process.exit(1);
  });
}
