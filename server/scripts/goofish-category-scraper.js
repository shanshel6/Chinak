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

const prisma = new PrismaClient();
const CNY_TO_IQD_RATE = 200;
const PRICE_PROFIT_MULTIPLIER = 1.15;

const DEEPINFRA_API_KEY = process.env.DEEPINFRA_API_KEY;
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
const KEYWORDS_PER_PRODUCT = 15;
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
const MAX_AI_ATTEMPTS = 3;
let dbReady = false;
let dbChecked = false;

if (process.env.NODE_ENV === 'production' && process.env.ALLOW_SCRAPER_IN_PROD !== 'true') {
  console.error('CRITICAL: Scraper is BLOCKED in production environment.');
  console.error('To run this script on the server, set ALLOW_SCRAPER_IN_PROD=true');
  process.exit(1);
}

// Simple DeepInfra client using axios
async function callDeepInfra(messages, temperature = 0.3, maxTokens = 100) {
  if (!DEEPINFRA_API_KEY) return null;
  try {
    const response = await axios.post('https://api.deepinfra.com/v1/openai/chat/completions', {
      model: "google/gemma-3-12b-it",
      messages,
      temperature,
      max_tokens: maxTokens
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DEEPINFRA_API_KEY}`
      },
      timeout: 30000
    });
    return response.data.choices[0].message.content.trim();
  } catch (error) {
    console.error('DeepInfra API Error:', error.message);
    return null;
  }
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

function normalizeArabicKeyword(value) {
  return cleanAiText(value)
    .replace(/[\u0610-\u061A\u0640\u064B-\u065F\u0670\u06D6-\u06ED]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeTranslatedTitle(aiText, fallbackTitle) {
  const raw = String(aiText || '').trim();
  if (!raw) return fallbackTitle;
  const lines = raw.split('\n').map((line) => cleanAiText(line)).filter(Boolean);
  const arabicLine = lines.find((line) => hasArabic(line) && !/^option\b/i.test(line));
  if (arabicLine) return arabicLine.slice(0, 140);
  return cleanAiText(raw).slice(0, 140) || fallbackTitle;
}

function normalizeKeywordList(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.map((k) => normalizeArabicKeyword(k)).filter(Boolean))];
  }
  if (typeof value !== 'string') return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return [...new Set(parsed.map((k) => normalizeArabicKeyword(k)).filter(Boolean))];
    }
  } catch {}
  return [...new Set(trimmed.split(/,|،|\n/).map((k) => normalizeArabicKeyword(k)).filter(Boolean))];
}

function buildKeywordCandidatesFromText(text) {
  const clean = cleanAiText(sanitizeTranslationText(text));
  if (!clean) return [];
  const words = clean
    .split(/\s+/)
    .map((word) => normalizeArabicKeyword(word))
    .filter((word) => word && word.length >= 2);
  if (words.length === 0) return [];
  const candidates = [];
  for (let size = 1; size <= 4; size += 1) {
    for (let i = 0; i <= words.length - size; i += 1) {
      candidates.push(words.slice(i, i + size).join(' '));
    }
  }
  return [...new Set(candidates)];
}

function ensureKeywordList(value, seedText = '') {
  const normalized = normalizeKeywordList(value)
    .filter((k) => k.length >= 2)
    .slice(0, KEYWORDS_PER_PRODUCT);
  if (normalized.length >= KEYWORDS_PER_PRODUCT) return normalized.slice(0, KEYWORDS_PER_PRODUCT);
  const extras = buildKeywordCandidatesFromText(seedText);
  for (const kw of extras) {
    if (normalized.length >= KEYWORDS_PER_PRODUCT) break;
    if (!normalized.includes(kw)) normalized.push(kw);
  }
  const padPool = normalized.length > 0 ? [...normalized] : extras;
  let idx = 0;
  while (normalized.length < KEYWORDS_PER_PRODUCT && padPool.length > 0) {
    normalized.push(padPool[idx % padPool.length]);
    idx += 1;
  }
  return normalized.slice(0, KEYWORDS_PER_PRODUCT);
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
  const titleLine = normalized.match(/(?:^|\n)\s*title_ar\s*[:：]\s*(.+)/i)?.[1]?.trim();
  const descriptionLine = normalized.match(/(?:^|\n)\s*(?:description_ar|full_description_ar)\s*[:：]\s*(.+)/i)?.[1]?.trim();
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
  const descriptionAr = cleanAiText(sanitizeTranslationText(entry.descriptionAr || entry.translatedDescription || titleAr || title)) || titleAr || title;
  const keywords = ensureKeywordList(entry.keywords, title);
  return { titleAr, descriptionAr, keywords };
}

function setCachedTranslation(cache, title, data) {
  const key = normalizeTranslationCacheKey(title);
  if (!key) return;
  const normalizedTitleAr = normalizeTranslatedTitle(data?.titleAr, title);
  cache[key] = {
    titleAr: normalizedTitleAr,
    descriptionAr: cleanAiText(sanitizeTranslationText(data?.descriptionAr || data?.translatedDescription || normalizedTitleAr || title)),
    keywords: ensureKeywordList(data?.keywords, normalizedTitleAr || title),
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

function isChineseTerm(term) {
  return /[\u4e00-\u9fff]/.test(term);
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
  const existingSet = new Set(existingTerms.map(normalizeSearchTerm));
  let results = [];
  let usedAi = false;
  for (let attempt = 0; attempt < MAX_AI_ATTEMPTS && results.length < 50; attempt += 1) {
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
Return a JSON array only, no other text or punctuation.`
      }
    ];
    const raw = await callDeepInfra(prompt, 0.4, 220);
    if (!raw) continue;
    usedAi = true;
    const cleaned = raw.trim().replace(/^```json/i, '').replace(/^```/i, '').replace(/```$/i, '').trim();
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
    const candidates = Array.isArray(parsed) ? parsed : [];
    for (const entry of candidates) {
      const term = normalizeSearchTerm(entry);
      if (!term || term.length < 2) continue;
      if (!isChineseTerm(term)) continue;
      if (isFoodTerm(term)) continue;
      if (existingSet.has(term)) continue;
      if (!results.includes(term)) results.push(term);
      if (results.length >= 50) break;
    }
  }
  return { terms: results.slice(0, 50), usedAi };
}

async function getSearchTermsForRun() {
  const history = loadSearchTermHistory();
  const activeBatch = history.activeBatch;
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
  if (AI_ONLY_TERMS && !DEEPINFRA_API_KEY) {
    throw new Error('AI-only mode is enabled but DEEPINFRA_API_KEY is missing.');
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
      '--proxy-server=http://192.168.2.150:7890'
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
  const source = String(title || '').trim();
  if (!source || !DEEPINFRA_API_KEY) return fallbackText || source;
  try {
    const prompt = `Translate this full Chinese product title into natural Arabic while preserving all product attributes.
Return only Arabic text. Do not include labels, keys, JSON, or explanations.
Chinese title: "${source}"`;
    const result = await callDeepInfra([{ role: "user", content: prompt }], 0.25, 220);
    const translated = cleanAiText(sanitizeTranslationText(result));
    return translated || fallbackText || source;
  } catch {
    return fallbackText || source;
  }
}

async function generateTitleAndKeywords(title) {
  const fallback = String(title || '').trim();
  if (!DEEPINFRA_API_KEY || !fallback) {
    return { titleAr: fallback, descriptionAr: fallback, keywords: [] };
  }
  try {
    const prompt = `Translate this Chinese product title into Arabic in two forms and generate exactly 15 Arabic search keywords (Iraqi-friendly, no diacritics).
Return valid JSON only with this shape:
{"title_ar":"...","description_ar":"...","keywords":["..."]}
"title_ar" must be short and suitable as ecommerce card title.
"description_ar" must be a fuller natural Arabic rendering of the full title text.
Title: "${fallback}"`;
    const result = await callDeepInfra([{ role: "user", content: prompt }], 0.35, 160);
    const raw = String(result || '').trim();
    if (!raw) return { titleAr: fallback, descriptionAr: fallback, keywords: [] };
    const parsed = parseAiTranslationPayload(raw);
    const titleAr = normalizeTranslatedTitle(parsed?.title_ar || raw, fallback);
    let descriptionAr = cleanAiText(
      sanitizeTranslationText(parsed?.description_ar || titleAr || fallback)
    ) || titleAr || fallback;
    if (!descriptionAr || descriptionAr.length < 24 || descriptionAr === titleAr) {
      descriptionAr = await translateFullTitleToArabic(fallback, descriptionAr || titleAr || fallback);
    }
    const keywords = ensureKeywordList(
      Array.isArray(parsed?.keywords)
        ? parsed.keywords
        : (parsed?.keywords || ''),
      titleAr || fallback
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
  try {
    await prisma.$connect();
    dbReady = true;
    console.log('Database connection established.');
  } catch (e) {
    dbReady = false;
    console.error('Database unavailable.');
    console.error(String(e?.message || e));
    if (REQUIRE_DB_WRITE) {
      throw e;
    }
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
    if (!item.url || item.url.includes('search?')) return; // Skip if invalid URL
    const ready = await ensureDbReady();
    if (!ready) return;

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
    const priceIQD = Math.round(basePriceIQD * PRICE_PROFIT_MULTIPLIER);
    if (existing) {
      try {
        await prisma.product.update({
          where: { id: existing.id },
          data: {
            name: item.titleEn || item.title,
            price: priceIQD,
            basePriceIQD,
            keywords: keywordsList,
            aiMetadata: metadata,
            updatedAt: new Date(),
            ...(hasDetectedCondition ? { neworold: newOrOldValue } : {})
          }
        });
      } catch (updateError) {
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
      }
      // console.log(`Updated product: ${item.titleEn}`);
    } else {
      let newProduct;
      try {
        newProduct = await prisma.product.create({
          data: {
            name: item.titleEn || item.title,
            price: priceIQD,
            basePriceIQD,
            image: item.image,
            purchaseUrl: item.url,
            status: 'PUBLISHED',
            isActive: true,
            keywords: keywordsList,
            aiMetadata: metadata,
            ...(hasDetectedCondition ? { neworold: newOrOldValue } : {})
          }
        });
      } catch (createError) {
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
      console.log(`Saved to DB: ${item.titleEn}`);
    }
  } catch (e) {
    console.error(`Failed to save product ${item.titleEn}:`, e.message);
  }
}

async function run() {
  const browser = await createBrowser();
  await ensureDbReady();
  const translationCache = loadTranslationCache();
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

    const MAX_PAGES = parseInt(process.env.GOOFISH_MAX_PAGES || '40', 10);
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
            const key = `${it.url}|${it.image}|${it.title}`;
            if (seenItems.has(key)) continue;
            seenItems.add(key);

            const cny = parseCnyPrice(it.priceText);
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
              descriptionAr = cleanAiText(sanitizeTranslationText(String(existingProduct?.aiMetadata?.translatedDescription || titleEn).trim())) || titleEn;
              keywords = ensureKeywordList(existingProduct.keywords, titleEn || it.title);
              needsDetailedDescription = !descriptionAr || descriptionAr.length < 20 || descriptionAr === titleEn;
            }

            if (DEEPINFRA_API_KEY && (!existingProduct || needsDetailedDescription)) {
              const cachedTranslation = getCachedTranslation(translationCache, it.title);
              const canUseCachedDescription = cachedTranslation
                && cachedTranslation.descriptionAr
                && cachedTranslation.descriptionAr.length >= 24
                && cachedTranslation.descriptionAr !== cachedTranslation.titleAr;
              if (canUseCachedDescription) {
                titleEn = cachedTranslation.titleAr;
                descriptionAr = cachedTranslation.descriptionAr;
                keywords = cachedTranslation.keywords;
              } else {
                const generated = await generateTitleAndKeywords(it.title);
                titleEn = generated.titleAr;
                descriptionAr = generated.descriptionAr;
                keywords = generated.keywords;
                setCachedTranslation(translationCache, it.title, generated);
                console.log(`Translated: ${it.title.substring(0, 15)}... -> ${titleEn.substring(0, 20)}...`);
                await humanDelay(120, 260);
              }
            }

            titleEn = sanitizeTranslationText(titleEn);
            descriptionAr = sanitizeTranslationText(descriptionAr);

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
            await saveProductToDb(itemData, existingProduct?.id || null);
            processedCount += 1;
            termProcessedCount += 1;
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
    saveTranslationCache(translationCache);
    await browser.close();
  }
}

run();
