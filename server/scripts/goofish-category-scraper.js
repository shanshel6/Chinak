import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import readline from 'readline';
import { fileURLToPath } from 'url';
import { Prisma, PrismaClient } from '@prisma/client';
import axios from 'axios';

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

const prisma = prismaDbUrl
  ? new PrismaClient({ datasources: { db: { url: prismaDbUrl } } })
  : new PrismaClient();
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
const ITEMS_PER_SEARCH = Math.max(1, parseInt(process.env.GOOFISH_ITEMS_PER_SEARCH || '90', 10) || 90);
const KEYWORDS_PER_PRODUCT = Math.max(10, Math.min(50, parseInt(process.env.GOOFISH_KEYWORDS_PER_PRODUCT || '30', 10) || 30));
const GOOFISH_AI_TITLE_MAX_CHARS = Math.max(40, parseInt(process.env.GOOFISH_AI_TITLE_MAX_CHARS || '140', 10) || 140);
const GOOFISH_AI_SECOND_PASS_DESCRIPTION = String(process.env.GOOFISH_AI_SECOND_PASS_DESCRIPTION || 'false').toLowerCase() === 'true';
const GOOFISH_TRANSLATION_CACHE_FLUSH_EVERY = Math.max(1, parseInt(process.env.GOOFISH_TRANSLATION_CACHE_FLUSH_EVERY || '20', 10) || 20);
const GOOFISH_AI_TASK_TIMEOUT_MS = Math.max(15000, parseInt(process.env.GOOFISH_AI_TASK_TIMEOUT_MS || '90000', 10) || 90000);
const GOOFISH_DB_WRITE_TIMEOUT_MS = Math.max(15000, parseInt(process.env.GOOFISH_DB_WRITE_TIMEOUT_MS || '120000', 10) || 120000);
const GOOFISH_SCRAPER_HEARTBEAT_MS = Math.max(5000, parseInt(process.env.GOOFISH_SCRAPER_HEARTBEAT_MS || '30000', 10) || 30000);
const GOOFISH_DB_STATEMENT_TIMEOUT_MS = Math.max(5000, parseInt(process.env.GOOFISH_DB_STATEMENT_TIMEOUT_MS || '90000', 10) || 90000);
const GOOFISH_DB_COOLDOWN_WINDOW_MS = Math.max(1000, parseInt(process.env.GOOFISH_DB_COOLDOWN_WINDOW_MS || '120000', 10) || 120000);
const GOOFISH_DB_COOLDOWN_THRESHOLD = Math.max(2, parseInt(process.env.GOOFISH_DB_COOLDOWN_THRESHOLD || '4', 10) || 4);
const GOOFISH_DB_COOLDOWN_SLEEP_MS = Math.max(1000, parseInt(process.env.GOOFISH_DB_COOLDOWN_SLEEP_MS || '15000', 10) || 15000);
const parsedRecoverWaitMs = parseInt(process.env.GOOFISH_DB_RECOVER_WAIT_MS || '120000', 10);
const GOOFISH_DB_RECOVER_WAIT_MS = Number.isFinite(parsedRecoverWaitMs) ? Math.max(0, parsedRecoverWaitMs) : 120000;
const GOOFISH_DB_RECOVER_PING_TIMEOUT_MS = Math.max(1000, parseInt(process.env.GOOFISH_DB_RECOVER_PING_TIMEOUT_MS || '12000', 10) || 12000);
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
let activeBrowser = null;
let shutdownInProgress = false;
let dbConnectivityFailureTimestamps = [];

async function runWithTimeout(task, label, timeoutMs) {
  let timer = null;
  try {
    return await Promise.race([
      Promise.resolve().then(() => task()),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function isDbConnectivityError(error) {
  const message = String(error?.message || error || '');
  const code = String(error?.code || '');
  return message.includes('Engine is not yet connected')
    || message.includes("Can't reach database server")
    || message.includes('Server has closed the connection')
    || message.includes('Timed out fetching a new connection from the connection pool')
    || code === 'P2024'
    || code === 'P1017'
    || code === 'P1001';
}

async function applyDbCooldownIfNeeded(label, error) {
  if (!isDbConnectivityError(error)) return;
  const now = Date.now();
  dbConnectivityFailureTimestamps.push(now);
  dbConnectivityFailureTimestamps = dbConnectivityFailureTimestamps.filter((ts) => now - ts <= GOOFISH_DB_COOLDOWN_WINDOW_MS);
  if (dbConnectivityFailureTimestamps.length < GOOFISH_DB_COOLDOWN_THRESHOLD) return;
  console.warn(
    `[DB Cooldown] ${dbConnectivityFailureTimestamps.length} connectivity errors within ${GOOFISH_DB_COOLDOWN_WINDOW_MS}ms while ${label}. Cooling down for ${GOOFISH_DB_COOLDOWN_SLEEP_MS}ms...`
  );
  await humanDelay(GOOFISH_DB_COOLDOWN_SLEEP_MS, GOOFISH_DB_COOLDOWN_SLEEP_MS + 400);
  dbConnectivityFailureTimestamps = [];
}

async function reconnectDb() {
  const recoverWaitMs = Math.max(0, GOOFISH_DB_RECOVER_WAIT_MS);
  const infiniteWait = recoverWaitMs <= 0;
  const start = Date.now();
  let lastPauseLogAt = 0;
  while (infiniteWait || (Date.now() - start < recoverWaitMs)) {
    const now = Date.now();
    if (now - lastPauseLogAt >= 15000) {
      const elapsedSec = Math.floor((now - start) / 1000);
      const waitLabel = infiniteWait ? 'infinite' : `${Math.floor(recoverWaitMs / 1000)}s`;
      console.warn(`[DB Pause] waiting for reconnect (${elapsedSec}s elapsed, wait=${waitLabel})`);
      lastPauseLogAt = now;
    }
    try {
      await prisma.$disconnect();
    } catch {}
    await humanDelay(1200, 2400);
    try {
      await prisma.$connect();
      await prisma.$executeRawUnsafe(`SET statement_timeout TO ${GOOFISH_DB_STATEMENT_TIMEOUT_MS}`);
      await runWithTimeout(
        () => prisma.$queryRawUnsafe('SELECT 1'),
        'recover ping',
        GOOFISH_DB_RECOVER_PING_TIMEOUT_MS
      );
      dbReady = true;
      console.warn('[DB Pause] reconnect successful, resuming.');
      return;
    } catch {
      await humanDelay(1500, 2200);
    }
  }
  throw new Error(`db recovery failed after ${GOOFISH_DB_RECOVER_WAIT_MS}ms`);
}

async function shutdownGracefully(signal) {
  if (shutdownInProgress) return;
  shutdownInProgress = true;
  console.warn(`Received ${signal}. Shutting down gracefully...`);
  try {
    if (activeBrowser) {
      await activeBrowser.close();
    }
  } catch {}
  try {
    await prisma.$disconnect();
  } catch {}
  process.exit(0);
}

process.once('SIGINT', () => {
  shutdownGracefully('SIGINT');
});
process.once('SIGTERM', () => {
  shutdownGracefully('SIGTERM');
});

if (process.env.NODE_ENV === 'production' && process.env.ALLOW_SCRAPER_IN_PROD !== 'true') {
  console.error('CRITICAL: Scraper is BLOCKED in production environment.');
  console.error('To run this script on the server, set ALLOW_SCRAPER_IN_PROD=true');
  process.exit(1);
}

// Simple SiliconFlow client using axios
async function callSiliconFlow(messages, temperature = 0.3, maxTokens = 100) {
  const apiKey = SILICONFLOW_API_KEY;
  if (!apiKey) return null;
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await axios.post('https://api.siliconflow.com/v1/chat/completions', {
        model: "Qwen/Qwen2.5-7B-Instruct",
        messages,
        temperature,
        max_tokens: maxTokens,
        stream: false
      }, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        timeout: 45000
      });
      return response.data.choices[0].message.content.trim();
    } catch (error) {
      const status = error?.response?.status;
      const isTimeout = String(error?.message || '').includes('timeout');
      // Retry on 429 (Rate Limit), 503 (Service Unavailable), and 500 (Internal Server Error)
      if (status === 429 || status === 503 || status === 500 || isTimeout) {
        console.warn(`SiliconFlow API Error (${status || 'timeout'}), retrying (attempt ${attempt}/${maxAttempts})...`);
        const waitMs = Math.min(30000, 2000 * attempt * attempt);
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
  if (parsedTitle && hasArabic(parsedTitle)) return parsedTitle.slice(0, 140);
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
    .find((line) => hasArabic(line) && !/^option\b/i.test(line));
  if (arabicLine) return arabicLine.slice(0, 140);
  return cleanAiText(raw).slice(0, 140) || fallbackTitle;
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
    .replace(/^\s*(title_ar|titlear|description_ar|descriptionar|full_description_ar|fullDescriptionAr)\s*[:：-]\s*/i, '')
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

function getCachedTranslation(cache, title) {
  const key = normalizeTranslationCacheKey(title);
  if (!key) return null;
  const entry = cache[key];
  if (!entry || typeof entry !== 'object') return null;
  const titleAr = normalizeTranslatedTitle(entry.titleAr, title);
  const descriptionAr = cleanDescriptionText(entry.descriptionAr || entry.translatedDescription || titleAr || title) || titleAr || title;
  const seedText = `${titleAr} ${descriptionAr}`.trim();
  const keywords = ensureKeywordList(entry.keywords, seedText);
  return { titleAr, descriptionAr, keywords };
}

function setCachedTranslation(cache, title, data) {
  const key = normalizeTranslationCacheKey(title);
  if (!key) return;
  const normalizedTitleAr = normalizeTranslatedTitle(data?.titleAr, title);
  const descriptionAr = cleanDescriptionText(data?.descriptionAr || data?.translatedDescription || normalizedTitleAr || title);
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
  for (const p of CHROME_PATHS) {
    if (fs.existsSync(p)) return p;
  }
  return null;
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
  for (let attempt = 0; attempt < MAX_AI_ATTEMPTS && results.length < 50; attempt += 1) {
    console.log(`[AI Term Gen] Requesting new terms from SiliconFlow (attempt ${attempt + 1})...`);
    const prompt = [
      {
        role: 'system',
        content: 'You generate Chinese e-commerce category search terms for a marketplace like Xianyu. Output only valid JSON.'
      },
      {
        role: 'user',
        content: `Generate exactly 50 unique Chinese category search terms for an e-commerce marketplace like Xianyu. 
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
      if (results.length >= 50) break;
    }
  }
  
  if (results.length > 0) {
    console.log(`[AI Term Gen] Successfully generated ${results.length} terms using SiliconFlow:`);
    console.log(results.join(', '));
  } else {
    console.log('[AI Term Gen] Failed to generate terms or API returned empty list.');
  }

  return { terms: results.slice(0, 50), usedAi };
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
        source: batchSource
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
  if (AI_ONLY_TERMS && finalTerms.length < 50) {
    throw new Error('AI-only mode could not generate 50 unique terms.');
  }
  if (finalTerms.length < 50) {
    const fallback = DEFAULT_SEARCH_TERMS
      .map(normalizeSearchTerm)
      .filter((term) => term && !existing.includes(term) && !isFoodTerm(term));
    finalTerms = [...finalTerms, ...fallback].slice(0, 50);
    source = 'fallback';
  }
  if (finalTerms.length === 0) {
    finalTerms = DEFAULT_SEARCH_TERMS.slice(0, 50);
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
  return { terms: finalTerms, startIndex: 0, batchId, source };
}

function updateActiveBatchProgress(batchId, nextIndex) {
  const history = loadSearchTermHistory();
  const active = history.activeBatch;
  if (!active || (batchId && active.id !== batchId)) return;
  const updated = {
    ...active,
    nextIndex: Math.max(0, Number(nextIndex || 0) || 0),
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

async function createBrowser() {
  const executablePath = getExecutablePath();
  if (!executablePath) {
    console.error('Chrome/Edge executable not found on system.');
    process.exit(1);
  }
  return puppeteer.launch({
    executablePath,
    headless: false,
    defaultViewport: null,
    // userDataDir: path.join(process.cwd(), 'chrome_data'), // Disabled for incognito-like behavior
    args: [
      '--start-maximized',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--excludeSwitches=enable-automation',
      '--disable-features=IsolateOrigins,site-per-process',
      '--incognito',
      '--proxy-server=http://192.168.2.150:7890',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu'
    ]
  });
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

async function translateFullTitleToArabic(title, fallbackText = '') {
  const source = String(title || '').trim().slice(0, GOOFISH_AI_TITLE_MAX_CHARS);
  if (!source || !SILICONFLOW_API_KEY) return fallbackText || source;
  try {
    const prompt = `Translate this Chinese product title to Arabic. Return Arabic only.\n${source}`;
    const result = await callSiliconFlow([{ role: "user", content: prompt }], 0.2, 120);
    const translated = cleanAiText(sanitizeTranslationText(result));
    return translated || fallbackText || source;
  } catch {
    return fallbackText || source;
  }
}

async function generateTitleAndKeywords(title) {
  const fallback = String(title || '').trim().slice(0, GOOFISH_AI_TITLE_MAX_CHARS);
  if (!SILICONFLOW_API_KEY || !fallback) {
    return { titleAr: fallback, descriptionAr: fallback, keywords: [] };
  }
  try {
    const prompt = `Return JSON only: {"title_ar":"...","description_ar":"...","keywords":["..."]}.
Translate Chinese title to Arabic.
title_ar: short ecommerce title.
description_ar: one natural sentence.
keywords: exactly ${KEYWORDS_PER_PRODUCT} Arabic single-word search terms, no duplicates.
Title: "${fallback}"`;
    const result = await callSiliconFlow([{ role: "user", content: prompt }], 0.25, 300);
    const raw = String(result || '').trim();
    if (!raw) {
        console.warn(`[AI Debug] generateTitleAndKeywords returned empty for title: ${fallback}`);
        return { titleAr: fallback, descriptionAr: fallback, keywords: [] };
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
    descriptionAr = cleanDescriptionText(descriptionAr) || titleAr || fallback;
    const seedText = `${titleAr} ${descriptionAr}`.trim();
    const keywords = ensureKeywordList(
      Array.isArray(parsed?.keywords)
        ? parsed.keywords
        : (parsed?.keywords || ''),
      seedText || fallback
    );
    return { titleAr, descriptionAr, keywords };
  } catch (e) {
    return { titleAr: fallback, descriptionAr: fallback, keywords: [] };
  }
}

async function ensureDbReady() {
  if (DISABLE_DB_WRITE) {
    if (REQUIRE_DB_WRITE) {
      throw new Error('GOOFISH_DISABLE_DB_WRITE is true while DB write is required.');
    }
    return false;
  }
  if (dbChecked) return dbReady;
  dbChecked = true;
  const maxAttempts = 6;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await prisma.$connect();
      await prisma.$executeRawUnsafe(`SET statement_timeout TO ${GOOFISH_DB_STATEMENT_TIMEOUT_MS}`);
      dbReady = true;
      console.log('Database connection established.');
      return dbReady;
    } catch (e) {
      dbReady = false;
      const code = String(e?.code || '');
      const retryable = code === 'P2024' || code === 'P1001' || code === 'P1017';
      if (!retryable || attempt === maxAttempts) {
        console.error('Database unavailable.');
        console.error(String(e?.message || e));
        if (REQUIRE_DB_WRITE) {
          throw e;
        }
        return dbReady;
      }
      console.warn(`Database connection attempt ${attempt}/${maxAttempts} failed. Retrying in 5 seconds...`);
      try { await prisma.$disconnect(); } catch {}
      await new Promise((resolve) => setTimeout(resolve, 5000));
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
    return await prisma.product.findFirst({
      where: { purchaseUrl: url },
      select: {
        id: true,
        name: true,
        keywords: true,
        aiMetadata: true
      }
    });
  } catch {
    return null;
  }
}

async function saveProductToDb(item, existingProductId = null) {
  try {
    if (!item.url || item.url.includes('search?')) {
        console.warn('Skipping item with invalid URL:', item.url);
        return; 
    }
    const ready = await ensureDbReady();
    if (!ready) {
        console.error('Database not ready, cannot save product.');
        return;
    }

    const existing = existingProductId
      ? { id: existingProductId }
      : await prisma.product.findFirst({
        where: { purchaseUrl: item.url },
        select: { id: true }
      });
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
        // Assign canonical category immediately
        await assignCategoryToProduct(existing.id, keywordsList);
        console.log(`Updated product: ${item.titleEn || item.title}`);
      } catch (updateError) {
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
            // Assign canonical category immediately
            await assignCategoryToProduct(newProduct.id, keywordsList);
        }
      } catch (createError) {
        // console.error('Prisma create failed, trying raw SQL fallback:', createError.message);
        const keywordsSql = Prisma.join(keywordsList);
        const inserted = hasDetectedCondition
          ? await prisma.$queryRaw`
              INSERT INTO "Product"
                ("name", "price", "basePriceIQD", "image", "purchaseUrl", "keywords", "neworold", "status", "isActive", "aiMetadata", "createdAt", "updatedAt")
              VALUES
                (${item.titleEn || item.title}, ${priceIQD}, ${basePriceIQD}, ${item.image}, ${item.url}, ARRAY[${keywordsSql}], ${newOrOldValue}, 'PUBLISHED', true, ${JSON.stringify(metadata)}::jsonb, NOW(), NOW())
              RETURNING "id"
            `
          : await prisma.$queryRaw`
              INSERT INTO "Product"
                ("name", "price", "basePriceIQD", "image", "purchaseUrl", "keywords", "status", "isActive", "aiMetadata", "createdAt", "updatedAt")
              VALUES
                (${item.titleEn || item.title}, ${priceIQD}, ${basePriceIQD}, ${item.image}, ${item.url}, ARRAY[${keywordsSql}], 'PUBLISHED', true, ${JSON.stringify(metadata)}::jsonb, NOW(), NOW())
              RETURNING "id"
            `;
        const insertedId = Array.isArray(inserted) ? inserted[0]?.id : null;
        newProduct = { id: insertedId };
      }
      
      // Add main image
      if (item.image && newProduct?.id) {
        await prisma.productImage.create({
          data: {
            productId: newProduct.id,
            url: item.image,
            order: 0,
            type: 'GALLERY'
          }
        });
      }
      if (newProduct?.id) {
        console.log(`Saved to DB: id=${newProduct.id} title=${item.titleEn || item.title}`);
      } else {
        console.log(`Saved to DB: id=unknown title=${item.titleEn || item.title}`);
      }
    }
  } catch (e) {
    console.error(`Failed to save product ${item.titleEn}:`, e.message);
    // Print stack trace for debugging
    if (e.stack) console.error(e.stack);
  }
}

async function run() {
  const browser = await createBrowser();
  activeBrowser = browser;
  await ensureDbReady();
  const translationCache = loadTranslationCache();
  let pendingCacheWrites = 0;
  let heartbeatState = 'startup';
  let heartbeatProduct = '';
  const heartbeat = setInterval(() => {
    const productInfo = heartbeatProduct ? ` | item: ${heartbeatProduct}` : '';
    console.log(`[Heartbeat] state=${heartbeatState}${productInfo}`);
  }, GOOFISH_SCRAPER_HEARTBEAT_MS);
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
    await page.goto('https://www.goofish.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });

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

    const ensureItemsLoaded = async () => {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const emptyState = await page.evaluate(() => {
          const emptyEl = document.querySelector('div[class*="empty-text-notfound--"]');
          if (emptyEl) return emptyEl.textContent?.trim() || '';
          const text = document.body?.innerText || '';
          if (/no items|没有.*商品|暂无|没有找到|没有内容/i.test(text)) return text;
          return '';
        });
        if (!emptyState) return true;
        console.log(`Empty state detected: ${emptyState}`);
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
        await humanDelay(3000, 5000);
      }
      return false;
    };

    const MAX_PAGES = parseInt(process.env.GOOFISH_MAX_PAGES || '3', 10);
    const seenItems = new Set();
    const allItems = [];
    let processedCount = 0;
    while (processedCount < MAX_PRODUCTS_TO_PROCESS) {
      const { terms: searchTerms, startIndex, batchId, source } = await getSearchTermsForRun();
      console.log(`Loaded ${searchTerms.length} search terms for this batch.`);
      console.log(`Batch source: ${source}.`);
      if (AI_ONLY_TERMS) {
        console.log('AI-only terms mode is enabled.');
      }
      console.log(`Starting from term ${startIndex + 1}/${searchTerms.length}.`);
      console.log('Search terms:', searchTerms.join(', '));

      for (let termIndex = startIndex; termIndex < searchTerms.length; termIndex += 1) {
        const term = searchTerms[termIndex];
        if (processedCount >= MAX_PRODUCTS_TO_PROCESS) break;
        console.log(`Starting search term: ${term}`);
        await openHomeAndSearch(page, term);
        const ok = await ensureItemsLoaded();
        if (!ok) {
          console.log(`Skipping term due to empty results: ${term}`);
          updateActiveBatchProgress(batchId, termIndex + 1);
          continue;
        }

        let pageIndex = 0;
        let termProcessedCount = 0;

        while (pageIndex < MAX_PAGES && termProcessedCount < ITEMS_PER_SEARCH) {
          pageIndex += 1;
          await closeLoginPopup(page);
          await page.waitForSelector('#content div[class^="search-container--"] div[class^="feeds-list-container--"] a[class*="feeds-item-wrap--"]', { timeout: 30000 });
          await humanDelay(2000, 3500);

          try {
            let lastHeight = 0;
            let sameHeightCount = 0;
            while (sameHeightCount < 3) {
              const scrollStep = 400 + Math.floor(Math.random() * 400);
              await page.evaluate((step) => window.scrollBy(0, step), scrollStep);
              await humanDelay(800, 1500);
              const newHeight = await page.evaluate(() => window.scrollY);
              const docHeight = await page.evaluate(() => document.body.scrollHeight);
              if (newHeight === lastHeight || (newHeight + await page.evaluate(() => window.innerHeight)) >= docHeight) {
                sameHeightCount++;
              } else {
                sameHeightCount = 0;
              }
              lastHeight = newHeight;
              if (Math.random() < 0.2) {
                await page.evaluate(() => window.scrollBy(0, -200));
                await humanDelay(500, 1000);
              }
            }
          } catch (e) {
            console.log('Scrolling error (ignored):', e.message);
          }

          let items = await page.evaluate(() => {
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

          if (items.length === 0) {
            await randomInteraction(page);
            await humanDelay(3000, 5000);
            await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
            await humanDelay(3500, 5500);
            items = await page.evaluate(() => {
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
          }

          console.log(`[${term}] Page ${pageIndex} -> ${items.length} raw items`);

          for (const it of items) {
            if (termProcessedCount >= ITEMS_PER_SEARCH || processedCount >= MAX_PRODUCTS_TO_PROCESS) break;
            
            termProcessedCount += 1;
            console.log(`[${term}] Progress: ${termProcessedCount}/${ITEMS_PER_SEARCH}`);

            const key = `${it.url}|${it.image}|${it.title}`;
            if (seenItems.has(key)) continue;
            seenItems.add(key);

            // Exclude gold/silver products based on title
            if (isExcludedProduct(it.title)) {
              console.log(`Skipping excluded product (Precious Metal): ${it.title}`);
              continue;
            }

            let cny = parseCnyPrice(it.priceText);
            
            // Try to detect "real" price from title if different from listed price
            const detectedPrice = detectRealPriceFromTitle(it.title, cny);
            if (detectedPrice !== cny && detectedPrice > 0) {
              console.log(`[Price Correction] Corrected price from ${cny} to ${detectedPrice} based on title: "${it.title}"`);
              cny = detectedPrice;
            }

            const newOrOld = detectNewOrOldFromTexts(it.title, it.conditionText);
            const realBrand = detectRealBrandFromTexts(it.title, it.conditionText);
            let titleEn = String(it.title || '').trim();
            let descriptionAr = titleEn;
            let keywords = [];
            const resolvedUrl = it.url || page.url() || '';
            const existingProduct = await findExistingProductByUrl(resolvedUrl);
            let needsDetailedDescription = false;

            if (existingProduct) {
              titleEn = String(existingProduct.name || titleEn).trim();
              descriptionAr = cleanDescriptionText(String(existingProduct?.aiMetadata?.translatedDescription || titleEn).trim()) || titleEn;
              keywords = ensureKeywordList(existingProduct.keywords, titleEn || it.title);
              needsDetailedDescription = !descriptionAr || descriptionAr.length < 20 || descriptionAr === titleEn || isChineseTerm(descriptionAr);
            }

            if (SILICONFLOW_API_KEY && (!existingProduct || needsDetailedDescription)) {
              console.log(`[AI Translation] Attempting for: ${it.title.substring(0, 30)}...`);
              heartbeatState = 'ai_translation';
              heartbeatProduct = it.title.substring(0, 40);
              const cachedTranslation = getCachedTranslation(translationCache, it.title);
              const canUseCachedDescription = cachedTranslation
                && cachedTranslation.descriptionAr
                && cachedTranslation.descriptionAr.length >= 24
                && cachedTranslation.descriptionAr !== cachedTranslation.titleAr;
              if (canUseCachedDescription) {
                console.log('AI translation cache hit.');
                titleEn = cachedTranslation.titleAr;
                descriptionAr = cachedTranslation.descriptionAr;
                keywords = cachedTranslation.keywords;
              } else {
                const generated = await runWithTimeout(
                  () => generateTitleAndKeywords(it.title),
                  `AI translation for ${it.title.substring(0, 30)}`,
                  GOOFISH_AI_TASK_TIMEOUT_MS
                );
                titleEn = generated.titleAr;
                descriptionAr = generated.descriptionAr;
                keywords = generated.keywords;
                setCachedTranslation(translationCache, it.title, generated);
                pendingCacheWrites += 1;
                if (pendingCacheWrites >= GOOFISH_TRANSLATION_CACHE_FLUSH_EVERY) {
                  saveTranslationCache(translationCache);
                  pendingCacheWrites = 0;
                }
                if (titleEn && titleEn !== it.title) {
                  console.log(`AI translation successful for: ${titleEn.slice(0, 30)}...`);
                } else {
                  console.warn('AI translation attempted but no translated output returned.');
                }
                await humanDelay(120, 260);
              }
            }

            titleEn = sanitizeTranslationText(titleEn);
            descriptionAr = cleanDescriptionText(descriptionAr);
            
            // If descriptionAr is somehow still exactly the Chinese title, or fallback,
            // we should try one more translation directly if we have the key.
            if (SILICONFLOW_API_KEY && (!descriptionAr || descriptionAr === it.title || isChineseTerm(descriptionAr) || isChineseTerm(titleEn))) {
                if (isChineseTerm(titleEn)) {
                    titleEn = await runWithTimeout(
                      () => translateFullTitleToArabic(it.title, it.title),
                      `AI title fallback for ${it.title.substring(0, 30)}`,
                      GOOFISH_AI_TASK_TIMEOUT_MS
                    );
                }
                descriptionAr = await runWithTimeout(
                  () => translateFullTitleToArabic(it.title, it.title),
                  `AI description fallback for ${it.title.substring(0, 30)}`,
                  GOOFISH_AI_TASK_TIMEOUT_MS
                );
                descriptionAr = cleanDescriptionText(descriptionAr);
            }

            const itemData = {
              title: it.title || '',
              titleEn: titleEn || '',
              descriptionAr: descriptionAr || '',
              keywords: keywords,
              newOrOld,
              realBrand,
              priceCny: cny,
              image: it.image || '',
              url: resolvedUrl
            };

            if (OUTPUT_JSON) {
              allItems.push(itemData);
            }
            heartbeatState = 'db_save';
            heartbeatProduct = (itemData.titleEn || itemData.title || '').substring(0, 40);
            let saveSucceeded = false;
            let saveAttempt = 0;
            while (!saveSucceeded) {
              saveAttempt += 1;
              heartbeatState = saveAttempt > 1 ? 'db_save_retry' : 'db_save';
              try {
                await runWithTimeout(
                  () => saveProductToDb(itemData, existingProduct?.id || null),
                  `DB save for ${heartbeatProduct || 'item'}`,
                  GOOFISH_DB_WRITE_TIMEOUT_MS
                );
                saveSucceeded = true;
              } catch (saveErr) {
                const saveErrText = String(saveErr?.message || saveErr || '');
                const timedOut = saveErrText.includes('timed out');
                const retryable = timedOut || isDbConnectivityError(saveErr);
                if (retryable) {
                  console.warn(`[DB Save] Attempt ${saveAttempt} failed. Pausing until DB reconnect, then retrying same item... ${saveErrText}`);
                  try {
                    heartbeatState = 'db_reconnect_wait';
                    await applyDbCooldownIfNeeded('db_save', saveErr);
                    await reconnectDb();
                    heartbeatState = 'db_reconnect_ok';
                  } catch (reconnectErr) {
                    console.warn(`[DB Save] Reconnect failed: ${String(reconnectErr?.message || reconnectErr || '')}`);
                    heartbeatState = 'db_reconnect_wait';
                  }
                  saveAttempt = 0;
                  continue;
                }
                console.warn(`[DB Save] Skipping item after ${saveAttempt} attempt(s) due to non-retryable error: ${saveErrText}`);
                break;
              }
            }
            if (!saveSucceeded) {
              heartbeatState = 'db_save_skipped';
              continue;
            }
            heartbeatState = 'db_save_done';
            // Log for debugging
            // console.log(`Processed item: ${itemData.titleEn || itemData.title}`);
            processedCount += 1;
            // termProcessedCount += 1;
          }

          if (termProcessedCount >= ITEMS_PER_SEARCH || processedCount >= MAX_PRODUCTS_TO_PROCESS) {
            break;
          }

          const changed = await (async () => {
            await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
            await humanDelay(1000, 2000);
            const firstBefore = items[0]?.title || '';
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
            return (firstAfter && firstAfter.trim() && firstAfter.trim() !== firstBefore.trim());
          })();

          if (!changed) break;
        }

        if (termProcessedCount < ITEMS_PER_SEARCH) {
          console.warn(`[${term}] collected ${termProcessedCount}/${ITEMS_PER_SEARCH}. Search exhausted before target.`);
        } else {
          console.log(`[${term}] collected target ${termProcessedCount}/${ITEMS_PER_SEARCH}.`);
        }
        updateActiveBatchProgress(batchId, termIndex + 1);

        await humanDelay(1400, 2600);
      }
      clearActiveBatch(batchId);
      await humanDelay(3000, 5000);
    }

    if (OUTPUT_JSON) {
      const outputPath = path.join(process.cwd(), 'goofish-results.json');
      fs.writeFileSync(outputPath, JSON.stringify(allItems, null, 2));
      console.log(`Scraping finished. Saved ${allItems.length} items to ${outputPath}`);
    } else {
      console.log('Scraping finished. Database write mode completed.');
    }
  } catch (e) {
    console.error('Scraper error:', e);
    process.exit(1);
  } finally {
    clearInterval(heartbeat);
    saveTranslationCache(translationCache);
    await browser.close();
    activeBrowser = null;
  }
}

async function updateExistingGoofishProducts() {
  await ensureDbReady();
  if (UPDATE_RESET_PROGRESS) {
    clearUpdateExistingProgress();
  }
  const resumeProgress = loadUpdateExistingProgress();
  const translationCache = loadTranslationCache();
  let pendingCacheWrites = 0;
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
    await reconnectDb();
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
      if (error?.code === 'P1017' || error?.code === 'P1001') {
        console.warn('DB connection issue. Reconnecting...');
        await applyDbCooldownIfNeeded('update_existing_fetch', error);
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
        const cached = getCachedTranslation(translationCache, baseTitle);
        if (cached) {
          titleAr = cached.titleAr;
          descriptionAr = cached.descriptionAr;
          keywords = cached.keywords;
        } else if (hasGoodExistingName && hasGoodExistingDescription && hasStrongExistingKeywords) {
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
          setCachedTranslation(translationCache, baseTitle, generated);
          pendingCacheWrites += 1;
          if (pendingCacheWrites >= GOOFISH_TRANSLATION_CACHE_FLUSH_EVERY) {
            saveTranslationCache(translationCache);
            pendingCacheWrites = 0;
          }
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
        if (error?.code === 'P1017' || error?.code === 'P1001') {
          console.warn(`DB connection issue while updating product ${product.id}. Reconnecting...`);
          await applyDbCooldownIfNeeded('update_existing_save', error);
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

  saveTranslationCache(translationCache);
  clearUpdateExistingProgress();
  console.log(`Existing Goofish products update completed. Updated: ${updatedCount}, Scanned: ${scanned}`);
  if (updatedLog.length > 0) {
    console.log('Updated keyword samples:', updatedLog.slice(0, 20));
  }
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
} else {
  run();
}
