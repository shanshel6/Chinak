import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import { promises as fsPromises } from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import readline from 'readline';

console.log('[DEBUG] goofish-link-checker.js: File loaded fresh from rebuild.');

// Setup environment
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.join(__dirname, '..', '.env');
dotenv.config({ path: envPath });

// Enable stealth mode to avoid detection
puppeteer.use(StealthPlugin());

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
const GOOFISH_START_ID = Math.max(0, Number.parseInt(process.env.GOOFISH_START_ID || '0', 10) || 0);
const GOOFISH_REPROCESS_ALL = String(process.env.GOOFISH_REPROCESS_ALL || '').toLowerCase() === 'true';
const GOOFISH_ARCHIVE_UNAVAILABLE = String(process.env.GOOFISH_ARCHIVE_UNAVAILABLE || 'true').toLowerCase() !== 'false';
const GOOFISH_DB_COOLDOWN_WINDOW_MS = Math.max(1000, Number.parseInt(process.env.GOOFISH_DB_COOLDOWN_WINDOW_MS || '120000', 10) || 120000);
const GOOFISH_DB_COOLDOWN_THRESHOLD = Math.max(2, Number.parseInt(process.env.GOOFISH_DB_COOLDOWN_THRESHOLD || '4', 10) || 4);
const GOOFISH_DB_COOLDOWN_SLEEP_MS = Math.max(1000, Number.parseInt(process.env.GOOFISH_DB_COOLDOWN_SLEEP_MS || '15000', 10) || 15000);
const parsedRecoverWaitMs = Number.parseInt(process.env.GOOFISH_DB_RECOVER_WAIT_MS || '5000', 10);
const GOOFISH_DB_RECOVER_WAIT_MS = Number.isFinite(parsedRecoverWaitMs) ? Math.max(0, parsedRecoverWaitMs) : 5000;
const GOOFISH_DB_RECOVER_PING_TIMEOUT_MS = Math.max(1000, Number.parseInt(process.env.GOOFISH_DB_RECOVER_PING_TIMEOUT_MS || '5000', 10) || 5000);
const GOOFISH_HEADLESS = !['0', 'false', 'no', 'off'].includes(String(process.env.GOOFISH_HEADLESS || '0').trim().toLowerCase());
console.log(`[Config] GOOFISH_HEADLESS raw="${process.env.GOOFISH_HEADLESS || '(unset)'}" resolved=${GOOFISH_HEADLESS} (${GOOFISH_HEADLESS ? 'headless' : 'visible'})`);
const GOOFISH_COOKIES_PATH = path.join(__dirname, 'goofish-cookies.json');
const GOOFISH_ENTRY_URLS = String(process.env.GOOFISH_ENTRY_URLS || 'https://www.goofish.com/,https://2.taobao.com/')
  .split(',')
  .map((url) => url.trim())
  .filter(Boolean);
const GOOFISH_PAGE_SETTLE_MIN_MS = Math.max(0, Number.parseInt(process.env.GOOFISH_PAGE_SETTLE_MIN_MS || '1800', 10) || 1800);
const GOOFISH_PAGE_SETTLE_MAX_MS = Math.max(GOOFISH_PAGE_SETTLE_MIN_MS, Number.parseInt(process.env.GOOFISH_PAGE_SETTLE_MAX_MS || '3200', 10) || 3200);
const GOOFISH_BETWEEN_PRODUCTS_MIN_MS = Math.max(0, Number.parseInt(process.env.GOOFISH_BETWEEN_PRODUCTS_MIN_MS || '1200', 10) || 1200);
const GOOFISH_BETWEEN_PRODUCTS_MAX_MS = Math.max(GOOFISH_BETWEEN_PRODUCTS_MIN_MS, Number.parseInt(process.env.GOOFISH_BETWEEN_PRODUCTS_MAX_MS || '2400', 10) || 2400);
const CNY_TO_IQD_RATE = Number.parseFloat(process.env.GOOFISH_CNY_TO_IQD_RATE || '200') || 200;
const PRICE_PROFIT_MULTIPLIER = Number.parseFloat(process.env.GOOFISH_PRICE_PROFIT_MULTIPLIER || '1.1') || 1.1;
const GOOFISH_USE_CHROME_PROFILE = String(process.env.GOOFISH_USE_CHROME_PROFILE || '0').trim() === '1';
const GOOFISH_AI_CALL_TIMEOUT_MS = Math.max(5000, Number.parseInt(process.env.GOOFISH_AI_CALL_TIMEOUT_MS || '45000', 10) || 45000);
const GOOFISH_AI_RETRY_MAX_ATTEMPTS = Math.max(1, Number.parseInt(process.env.GOOFISH_AI_RETRY_MAX_ATTEMPTS || '3', 10) || 3);
const SILICONFLOW_MODEL = process.env.SILICONFLOW_MODEL || 'Qwen/Qwen3-235B-A22B-Instruct-2507';
const GOOFISH_AI_RATE_LIMIT_DELAY_MS = Math.max(0, Number.parseInt(process.env.GOOFISH_AI_RATE_LIMIT_DELAY_MS || '200', 10) || 200);
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15'
];
let activeBrowser = null;
let shutdownInProgress = false;
let dbConnectivityFailureTimestamps = [];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const humanDelay = async (minMs, maxMs) => {
  const min = Math.max(0, Number(minMs) || 0);
  const max = Math.max(min, Number(maxMs) || min);
  const waitMs = min + Math.floor(Math.random() * (max - min + 1));
  await sleep(waitMs);
};

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
};

const safeDbConnect = async () => {
  try {
    await withTimeout(() => prisma.$connect(), 'db connect', 10000);
    return true;
  } catch {
    return false;
  }
};

const recoverDbConnection = async (label, backoffMs, attemptIndex) => {
  const recoverWaitMs = Math.max(1000, GOOFISH_DB_RECOVER_WAIT_MS || 120000);
  const start = Date.now();
  let lastPauseLogAt = 0;
  while (Date.now() - start < recoverWaitMs) {
    const now = Date.now();
    if (now - lastPauseLogAt >= 15000) {
      const elapsedSec = Math.floor((now - start) / 1000);
      const waitLabel = `${Math.floor(recoverWaitMs / 1000)}s`;
      console.warn(`[DB Pause] ${label}: waiting for reconnect (${elapsedSec}s elapsed, wait=${waitLabel})`);
      lastPauseLogAt = now;
    }
    await safeDbDisconnect();
    const delayMs = Math.max(1000, Math.min(15000, backoffMs * Math.max(1, attemptIndex)));
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    const connected = await safeDbConnect();
    if (!connected) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      continue;
    }
    try {
      await withTimeout(() => prisma.$queryRawUnsafe('SELECT 1'), `recover ping ${label}`, GOOFISH_DB_RECOVER_PING_TIMEOUT_MS);
      console.warn(`[DB Pause] ${label}: reconnect successful, resuming.`);
      return true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }
  return false;
};

const withRetry = async (run, label, retries = 5, timeoutMs = 60000, backoffMs = 1500) => {
  let lastError;
  for (let i = 1; i <= retries; i++) {
    try {
      return await withTimeout(run, label, timeoutMs);
    } catch (error) {
      lastError = error;
      const msg = toErrorText(error);
      const retryable = isDbConnectivityError(error);
      if (!retryable || i === retries) break;
      console.warn(`${label} failed (attempt ${i}/${retries}), retrying... ${msg}`);
      await applyDbCooldownIfNeeded(label, error);
      const recovered = await recoverDbConnection(label, backoffMs, i);
      if (!recovered) {
        lastError = new Error(`db recovery failed for ${label} after ${GOOFISH_DB_RECOVER_WAIT_MS}ms`);
        break;
      }
    }
  }
  throw lastError;
};

const toErrorText = (error) => String(error?.message || error || 'unknown error');
const toErrorCode = (error) => String(error?.code || '');
const isDbConnectivityError = (error) => {
  const msg = toErrorText(error);
  const code = toErrorCode(error);
  return msg.includes('Timed out fetching a new connection from the connection pool')
    || msg.includes("Can't reach database server")
    || msg.includes('timed out after')
    || msg.includes('Server has closed the connection')
    || msg.includes('Engine is not yet connected')
    || code === 'P2024'
    || code === 'P1017'
    || code === 'P1001';
};

const applyDbCooldownIfNeeded = async (label, error) => {
  if (!isDbConnectivityError(error)) return;
  const now = Date.now();
  dbConnectivityFailureTimestamps.push(now);
  dbConnectivityFailureTimestamps = dbConnectivityFailureTimestamps.filter((ts) => now - ts <= GOOFISH_DB_COOLDOWN_WINDOW_MS);
  if (dbConnectivityFailureTimestamps.length < GOOFISH_DB_COOLDOWN_THRESHOLD) return;
  console.warn(
    `[DB Cooldown] ${dbConnectivityFailureTimestamps.length} connectivity errors within ${GOOFISH_DB_COOLDOWN_WINDOW_MS}ms while ${label}. Cooling down for ${GOOFISH_DB_COOLDOWN_SLEEP_MS}ms...`
  );
  await safeDbDisconnect();
  await new Promise((resolve) => setTimeout(resolve, GOOFISH_DB_COOLDOWN_SLEEP_MS));
  await safeDbConnect();
  dbConnectivityFailureTimestamps = [];
};

const waitForDbReady = async (maxWaitMs, retryCount, timeoutMs, backoffMs) => {
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
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  return false;
};

const shutdownGracefully = async (signal) => {
  if (shutdownInProgress) return;
  shutdownInProgress = true;
  console.warn(`Received ${signal}. Shutting down gracefully...`);
  try {
    if (activeBrowser) {
      await withTimeout(() => activeBrowser.close(), 'browser close', 10000);
    }
  } catch {}
  try {
    await safeDbDisconnect();
  } catch {}
  process.exit(0);
};

process.once('SIGINT', () => {
  shutdownGracefully('SIGINT');
});
process.once('SIGTERM', () => {
  shutdownGracefully('SIGTERM');
});

// Indicators that a product is gone
const UNAVAILABLE_KEYWORDS = [
  '卖掉了', // Sold out (Primary indicator)
  '宝贝不存在', // Baby does not exist
  '下架', // Taken off shelf
  '删除', // Deleted
  '转移', // Transferred
  '很抱歉', // Very sorry
  '糟糕！宝贝被删掉了', // Oops! The item has been deleted
  'Sold out',
  'This item is no longer available',
  '商品已失效' // Product invalid
];

const RENTAL_SERVICE_KEYWORDS = [
  '出租',
  '租赁',
  '租借',
  '租用',
  '日租',
  '月租',
  '年租',
  '代租',
  '陪玩',
  '上门服务',
  '上门维修',
  '维修服务',
  '清洗服务',
  '上门清洗',
  '保洁',
  '家政',
  '洗车',
  '洗车服务',
  '洗护服务',
  '安装服务',
  '上门安装',
  '搬家',
  '跑腿',
  '代办服务',
  '预约',
  '代拍',
  '代购'
];

function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise((resolve) => rl.question(query, (answer) => {
    rl.close();
    resolve(answer);
  }));
}

async function readProgress(progressFilePath) {
  try {
    const raw = await fsPromises.readFile(progressFilePath, 'utf8');
    const data = JSON.parse(raw);
    const lastId = Number.parseInt(String(data?.lastId ?? '0'), 10) || 0;
    return { lastId };
  } catch {
    return { lastId: 0 };
  }
}

async function writeProgress(progressFilePath, progress) {
  const dir = path.dirname(progressFilePath);
  await fsPromises.mkdir(dir, { recursive: true });

  const tmpPath = `${progressFilePath}.tmp`;
  const payload = JSON.stringify(
    {
      lastId: progress.lastId,
      updatedAt: new Date().toISOString(),
    },
    null,
    2
  );

  await fsPromises.writeFile(tmpPath, payload, 'utf8');
  try {
    await fsPromises.rename(tmpPath, progressFilePath);
  } catch {
    try { await fsPromises.unlink(progressFilePath); } catch {}
    await fsPromises.rename(tmpPath, progressFilePath);
  }
}

async function recreateCheckerPage(browser, configurePage, currentPage = null) {
  if (currentPage) {
    try { await currentPage.close({ runBeforeUnload: false }); } catch {}
  }
  const nextPage = await browser.newPage();
  await configurePage(nextPage);
  return nextPage;
}

async function ensureProductPageOpen(page, browser, configurePage, targetUrl, options = {}) {
  const attempts = Math.max(1, Number(options.attempts) || 3);
  const gotoTimeoutMs = Math.max(5000, Number(options.gotoTimeoutMs) || 60000);
  const readyTimeoutMs = Math.max(3000, Number(options.readyTimeoutMs) || 15000);
  const normalizedTargetUrl = String(targetUrl || '').trim();
  if (!normalizedTargetUrl) {
    throw new Error('Missing product URL');
  }

  let workingPage = page;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      if (!workingPage || workingPage.isClosed()) {
        workingPage = await recreateCheckerPage(browser, configurePage);
      }
      await workingPage.goto(normalizedTargetUrl, { waitUntil: 'domcontentloaded', timeout: gotoTimeoutMs });
      await workingPage.waitForFunction(
        () => document.readyState === 'interactive' || document.readyState === 'complete',
        { timeout: readyTimeoutMs }
      );
      await workingPage.waitForSelector('body', { timeout: readyTimeoutMs });
      await humanDelay(GOOFISH_PAGE_SETTLE_MIN_MS, GOOFISH_PAGE_SETTLE_MAX_MS);
      await closeLoginPopupIfPresent(workingPage);
      await workingPage.waitForSelector(
        '.item-main-window-list--od7DK4Fm, img.fadeInImg--DnykYtf4, .item-body--P2hJb44_, .item-main--N18QxQe1, img[src*="alicdn.com"], [class*="detail"], [class*="price"]',
        { timeout: 7000 }
      ).catch(() => {});
      await humanDelay(700, 1400);

      const finalUrl = String(workingPage.url() || '');
      const finalHost = (() => {
        try { return new URL(finalUrl).hostname; } catch { return ''; }
      })();
      const targetHost = (() => {
        try { return new URL(normalizedTargetUrl).hostname; } catch { return ''; }
      })();

      if (!finalUrl || finalUrl === 'about:blank') {
        throw new Error('Page stayed blank after navigation');
      }
      if (targetHost && finalHost && !finalHost.includes(targetHost) && !finalHost.includes('login.taobao.com') && !finalHost.includes('login.tmall.com')) {
        throw new Error(`Navigation landed on unexpected host: ${finalHost}`);
      }

      return workingPage;
    } catch (error) {
      const isLastAttempt = attempt === attempts;
      if (isLastAttempt) {
        throw new Error(`Could not open ${normalizedTargetUrl}: ${error.message}`);
      }
      console.warn(`Open URL failed (attempt ${attempt}/${attempts}) for ${normalizedTargetUrl}: ${error.message}`);
      workingPage = await recreateCheckerPage(browser, configurePage, workingPage);
      await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
    }
  }

  return workingPage;
}

async function restoreCheckerCookies(page) {
  try {
    if (!fs.existsSync(GOOFISH_COOKIES_PATH)) return false;
    const cookies = JSON.parse(fs.readFileSync(GOOFISH_COOKIES_PATH, 'utf8'));
    if (!Array.isArray(cookies) || cookies.length === 0) return false;
    await page.setCookie(...cookies);
    console.log('Restored cookies from goofish-cookies.json');
    return true;
  } catch (error) {
    console.warn(`Failed to restore cookies: ${error.message}`);
    return false;
  }
}

async function saveCheckerCookies(page) {
  try {
    const cookies = await page.cookies();
    fs.writeFileSync(GOOFISH_COOKIES_PATH, JSON.stringify(cookies, null, 2));
  } catch (error) {
    console.warn(`Failed to save cookies: ${error.message}`);
  }
}

async function closeLoginPopupIfPresent(page) {
  try {
    const closeBtnSelector = '.closeIconBg--cubvOqVh, img.closeIcon--gwB7wNKs, .closeIcon--gwB7wNKs';
    const closeBtn = await page.$(closeBtnSelector);
    if (!closeBtn) return false;
    await closeBtn.click();
    await sleep(1200);
    console.log('Closed Goofish login popup.');
    return true;
  } catch {
    return false;
  }
}

async function collectAvailabilitySignals(page) {
  return page.evaluate((unavailableKeywords) => {
    const text = String(document.body?.innerText || '').replace(/\s+/g, ' ').trim();
    const title = String(document.title || '').trim();
    const href = String(window.location.href || '');
    const itemId = (() => {
      try { return new URL(href).searchParams.get('id') || ''; } catch { return ''; }
    })();
    const imageCount = Array.from(document.images || []).filter((img) => {
      const width = Number(img.naturalWidth || img.width || 0);
      const height = Number(img.naturalHeight || img.height || 0);
      return width >= 120 && height >= 120;
    }).length;
    const hasProductShell = Boolean(
      document.querySelector('.item-main-window-list--od7DK4Fm, .item-body--P2hJb44_, .item-main--N18QxQe1, [class*="item-main"], [class*="item-body"], [class*="price"], [class*="desc"]')
    );
    const hasPrice = /(?:^|[\s(])(?:¥|￥)\s*\d/.test(text) || /价格|现价|到手价/.test(text);
    const hasProductIdentity = Boolean(itemId && href.includes(itemId) && textLengthSafe(text) >= 500);
    const hasLoginPopup = Boolean(
      document.querySelector('.closeIconBg--cubvOqVh, img.closeIcon--gwB7wNKs, .closeIcon--gwB7wNKs')
    );
    const hasNetworkError = Boolean(
      document.querySelector('[class*="error-container"]')
      || text.includes('网络不见了')
      || text.includes('快停止散发魅力')
    );
    const matchedKeyword = unavailableKeywords.find((keyword) => text.includes(keyword) || title.includes(keyword)) || '';
    const isLogin = href.includes('login.taobao.com') || href.includes('login.tmall.com') || (hasLoginPopup && !hasPrice && text.length < 3000);
    const textLength = text.length;
    function textLengthSafe(value) {
      return String(value || '').length;
    }
    const looksLoaded = (
      document.readyState === 'complete' &&
      !isLogin &&
      !hasNetworkError &&
      (
        (hasPrice && textLength >= 300)
        || (hasProductShell && hasProductIdentity && imageCount >= 1)
      )
    );

    // Extract description text - ONLY from main content container to avoid related products
    let description = '';
    const descSelectors = [
      '.main--Nu33bWl6 .desc--GaIUKUQY', // Most specific: desc inside main container
      '.main--Nu33bWl6',                 // Main container itself
      '[class*="main--"] .desc--GaIUKUQY', // Desc inside any main container
      '[class*="main--"]',              // Any main container
      '.desc--GaIUKUQY',
      '[class*="desc--"]',
      '.item-desc--fHfY0Q3N',
      '.desc-text',
      '.item-desc',
      '#desc',
      '[class*="description"]',
      '[class*="detail"]',
    ];
    for (const selector of descSelectors) {
      const els = Array.from(document.querySelectorAll(selector));
      // For main container selectors, look inside for nested desc; otherwise use the element itself
      let candidates = els.map((el) => {
        if (el.matches('[class*="main--"]') && !el.matches('[class*="desc--"]')) {
          const innerDesc = el.querySelector('.desc--GaIUKUQY, [class*="desc--"]');
          return innerDesc || el;
        }
        return el;
      });
      // Pick the element with the longest text (most likely the actual description, not a label)
      const bestEl = candidates.filter((el) => el.innerText.length > 50).sort((a, b) => b.innerText.length - a.innerText.length)[0];
      if (bestEl) {
        description = bestEl.innerText.trim();
        break;
      }
    }
    // DO NOT fall back to full page text - only use targeted description containers
    // This prevents detecting prices from related products, headers, or footers

    return {
      href,
      title,
      readyState: document.readyState,
      textLength,
      imageCount,
      hasProductShell,
      hasPrice,
      hasProductIdentity,
      hasLoginPopup,
      hasNetworkError,
      matchedKeyword,
      isLogin,
      looksLoaded,
      description,
    };
  }, UNAVAILABLE_KEYWORDS);
}

async function extractPricesWithAI(description) {
  const apiKey = process.env.SILICONFLOW_API_KEY;
  if (!apiKey) {
    console.warn('[AI Price Extraction] No SILICONFLOW_API_KEY found, skipping price extraction');
    return null;
  }

  // Log full description being sent to AI for debugging
  console.log(`[AI Price Extraction] Sending description to AI (${description.length} chars):\n---BEGIN DESC---\n${description}\n---END DESC---`);

  for (let attempt = 1; attempt <= GOOFISH_AI_RETRY_MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GOOFISH_AI_CALL_TIMEOUT_MS);
    try {
      const response = await fetch('https://api.siliconflow.com/v1/chat/completions', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: SILICONFLOW_MODEL,
          messages: [
            {
              role: 'system',
              content: 'You are a price extraction assistant for an Iraqi e-commerce platform. Extract all real product prices from product descriptions. Prices are usually in Chinese Yuan (元/块/人民币/¥/￥).\n\nCRITICAL RULES:\n1. You MUST translate EVERY option/variant name to Arabic (Iraqi dialect).\n2. NEVER use generic names like "خيار 1" or "option 1" or "Option A".\n3. You MUST translate the actual Chinese text from the description into proper Arabic.\n\nEXAMPLE INPUT:\n0.9米三件套（学生床 被套150*200） 32元包邮\n1.2米三件套（宿舍床 被套150*200） 35元包邮\n1.5米四件套（被套150*200）38元包邮\n\nEXAMPLE OUTPUT:\n{\n  "lowestPriceCny": 32,\n  "highestPriceCny": 38,\n  "priceVariants": [\n    {"nameAr": "طقم 3 قطع 0.9 متر (سرير طالب، غطاء لحاف 150×200)", "priceCny": 32},\n    {"nameAr": "طقم 3 قطع 1.2 متر (سرير سكن، غطاء لحاف 150×200)", "priceCny": 35},\n    {"nameAr": "طقم 4 قطع 1.5 متر (غطاء لحاف 150×200)", "priceCny": 38}\n  ]\n}\n\nReturn JSON ONLY with: lowestPriceCny, highestPriceCny, and priceVariants (array of objects with nameAr and priceCny). Only extract prices clearly stated in the description. If only one price exists, return one variant.'
            },
            {
              role: 'user',
              content: `Extract real prices from this product description and translate option names to Arabic:\n\n${description}`
            }
          ],
          temperature: 0.1,
          max_tokens: 500
        })
      });

      const responseText = await response.text();
      if (!response.ok) {
        console.warn(`[AI Price Extraction] SiliconFlow HTTP ${response.status}: ${responseText.slice(0, 300)}`);
        throw new Error(`SiliconFlow HTTP ${response.status}`);
      }

      const data = JSON.parse(responseText);
      const content = data.choices?.[0]?.message?.content;

      if (!content) {
        console.warn(`[AI Price Extraction] No content in AI response: ${responseText.slice(0, 300)}`);
        return null;
      }

      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.warn(`[AI Price Extraction] No JSON found in AI response: ${content.slice(0, 300)}`);
        return null;
      }

      const priceData = JSON.parse(jsonMatch[0]);
      const variantNames = priceData.priceVariants?.map((v, i) => `[${i + 1}] "${v.nameAr}" = ¥${v.priceCny}`).join(', ') || 'none';
      console.log(`[AI Price Extraction] Extracted CNY prices: lowest=¥${priceData.lowestPriceCny}, highest=¥${priceData.highestPriceCny}, variants=${priceData.priceVariants?.length || 0}`);
      console.log(`[AI Price Extraction] Options: ${variantNames}`);
      await sleep(GOOFISH_AI_RATE_LIMIT_DELAY_MS);
      return priceData;
    } catch (error) {
      const errorMessage = error?.name === 'AbortError' ? `timed out after ${GOOFISH_AI_CALL_TIMEOUT_MS}ms` : error.message;
      const isServerError = /\b(502|503|504)\b/.test(errorMessage);
      console.error(`[AI Price Extraction] Error (attempt ${attempt}/${GOOFISH_AI_RETRY_MAX_ATTEMPTS}): ${errorMessage}`);
      if (attempt < GOOFISH_AI_RETRY_MAX_ATTEMPTS) {
        const backoffMs = isServerError ? 3000 * (2 ** (attempt - 1)) : 1200 * attempt;
        console.log(`[AI Price Extraction] Retrying in ${backoffMs}ms...`);
        await sleep(backoffMs);
      }
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

function translateFallbackVariantName(name, index) {
  const cleaned = String(name || '').replace(/[：:：\-–—]*\s*$/, '').trim();
  
  // Check if name contains Chinese characters
  const hasChinese = /[\u4e00-\u9fff]/.test(cleaned);
  
  const replacements = [
    // Sizes
    ['小号', 'صغير'],
    ['中号', 'متوسط'],
    ['大号', 'كبير'],
    ['特大', 'كبير جداً'],
    ['均码', 'مقاس واحد'],
    ['均', 'مقاس واحد'],
    ['S', 'صغير'],
    ['M', 'متوسط'],
    ['L', 'كبير'],
    ['XL', 'كبير جداً'],
    ['XXL', 'ضخم'],
    ['XXXL', 'ضخم جداً'],
    
    // Common terms
    ['新款', 'موديل جديد'],
    ['包邮', 'شحن مجاني'],
    ['正品', 'أصلي'],
    ['特价', 'عرض خاص'],
    ['清仓', 'تخليص'],
    ['秒杀', 'عرض محدود'],
    ['限量', 'كمية محدودة'],
    ['现货', 'متوفر فوراً'],
    ['亏本', 'خسارة'],
    ['处理', 'تصفية'],
    ['二手', 'مستعمل'],
    ['全新', 'جديد'],
    ['闲置', 'غير مستخدم'],
    ['转卖', 'إعادة بيع'],
    ['单人', 'شخص واحد'],
    ['双人', 'شخصين'],
    ['加厚', 'ثقيل'],
    ['薄款', 'خفيف'],
    ['纯棉', 'قطن خالص'],
    ['全棉', 'قطن 100%'],
    ['水洗棉', 'قطن مغسول'],
    ['磨毛', 'مخملي'],
    ['珊瑚绒', 'صوف مرجاني'],
    ['法兰绒', 'صوف فلانيل'],
    ['长绒棉', 'قطن طويل التيلة'],
    ['真丝', 'حرير طبيعي'],
    ['仿真丝', 'حرير صناعي'],
    ['涤纶', 'بوليستر'],
    ['混纺', 'مزيج'],
    ['针织', 'محبوك'],
    ['提花', 'منقوش'],
    ['印花', 'مطبوع'],
    ['刺绣', 'مطرز'],
    ['蕾丝', 'دانتيل'],
    ['花边', 'كشكشة'],
    ['条纹', 'مخطط'],
    ['格子', 'مربعات'],
    ['纯色', 'لون واحد'],
    ['卡通', 'كرتوني'],
    ['简约', 'بسيط'],
    ['田园', 'ريفي'],
    ['欧式', 'أوروبي'],
    ['日式', 'ياباني'],
    ['韩式', 'كوري'],
    ['中式', 'صيني'],
    ['复古', '复古'],
    ['现代', 'حديث'],
    ['可爱', 'لطيف'],
    ['商务', 'رسمي'],
    ['休闲', 'كاجوال'],
    ['运动', 'رياضي'],
    ['户外', 'خارجي'],
    ['家用', 'منزلي'],
    ['宿舍', 'سكن'],
    ['学生', 'طالب'],
    ['儿童', 'أطفال'],
    ['成人', 'بالغين'],
    ['男款', 'رجالي'],
    ['女款', 'نسائي'],
    ['通用', 'عام'],
    ['标准', 'قياسي'],
    ['加大', 'كبير جداً'],
    ['定制', 'مخصص'],
    ['现货', 'متوفر'],
    ['预售', 'طلب مسبق'],
    ['款', 'موديل'],
    ['式', 'طراز'],
    ['型', 'نوع'],
    ['版', 'إصدار'],
    ['套装', 'طقم'],
    ['组合', 'مجموعة'],
    ['搭配', 'تنسيق'],
    ['系列', 'سلسلة'],
    ['风格', 'أسلوب'],
    
    // Colors
    ['黑色', 'أسود'],
    ['白色', 'أبيض'],
    ['红色', 'أحمر'],
    ['蓝色', 'أزرق'],
    ['绿色', 'أخضر'],
    ['黄色', 'أصفر'],
    ['粉色', 'وردي'],
    ['紫色', 'بنفسجي'],
    ['灰色', 'رمادي'],
    ['棕色', 'بني'],
    ['金色', 'ذهبي'],
    ['银色', 'فضي'],
    
    // Material/Type
    ['棉', 'قطن'],
    ['丝绸', 'حرير'],
    ['麻', 'كتان'],
    ['羊毛', 'صوف'],
    ['皮革', 'جلد'],
    ['pu皮', 'جلد صناعي'],
    ['网面', 'شبكة'],
    ['帆布', 'قماش'],
    
    // Dining/Bedding
    ['双人食', 'طقم لشخصين'],
    ['四人食', 'طقم لأربعة أشخاص'],
    ['六人食', 'طقم لستة أشخاص'],
    ['八人食', 'طقم لثمانية أشخاص'],
    ['十人食', 'طقم لعشرة أشخاص'],
    ['单件', 'قطعة واحدة'],
    ['双件', 'قطعتين'],
    ['三件', 'ثلاث قطع'],
  ];
  
  let translated = cleaned;
  for (const [from, to] of replacements) {
    translated = translated.replaceAll(from, to);
  }
  
  // If still has Chinese characters after translation, use generic label
  if (hasChinese && /[\u4e00-\u9fff]/.test(translated)) {
    return `خيار ${index + 1}`;
  }
  
  return translated && translated !== cleaned ? translated : `خيار ${index + 1}`;
}

function extractPricesLocally(description) {
  const text = String(description || '').replace(/\r/g, '\n');
  const lines = text.split(/\n|<br\s*\/?>/i).map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const variants = [];
  const seen = new Set();

  for (const line of lines) {
    const matches = [...line.matchAll(/(?:^|[^\d])(\d{1,6}(?:\.\d{1,2})?)\s*(?:元|块|￥|¥)/g)];
    for (const match of matches) {
      const priceCny = Number(match[1]);
      if (!Number.isFinite(priceCny) || priceCny <= 0) continue;
      const beforePrice = line.slice(0, match.index + match[0].indexOf(match[1])).replace(/^[-–—\s]+/, '').trim();
      const name = beforePrice || line.replace(match[0], '').trim();
      const key = `${name}-${priceCny}`;
      if (seen.has(key)) continue;
      seen.add(key);
      variants.push({
        nameAr: name, // Store raw Chinese name — AI translation will happen later if needed
        priceCny,
      });
    }
  }

  if (!variants.length) return null;
  variants.sort((a, b) => a.priceCny - b.priceCny);
  return {
    lowestPriceCny: variants[0].priceCny,
    highestPriceCny: variants[variants.length - 1].priceCny,
    priceVariants: variants,
    source: 'local_regex',
  };
}

function hasExplicitChinesePrice(description) {
  const text = String(description || '');
  return /(?:\d{1,6}(?:\.\d{1,2})?\s*(?:元|块|人民币|￥|¥))|(?:(?:元|块|人民币|￥|¥)\s*\d{1,6}(?:\.\d{1,2})?)/.test(text);
}

async function extractPricesWithFallback(description) {
  if (!hasExplicitChinesePrice(description)) {
    return null;
  }

  const localPriceData = extractPricesLocally(description);
  if (localPriceData && localPriceData.priceVariants.length >= 2) {
    console.log(`[Local Price Extraction] Extracted CNY prices without AI: lowest=¥${localPriceData.lowestPriceCny}, highest=¥${localPriceData.highestPriceCny}, variants=${localPriceData.priceVariants.length}`);
    return localPriceData;
  }

  const aiPriceData = await extractPricesWithAI(description);
  if (normalizeExtractedPriceData(aiPriceData)) return aiPriceData;

  if (localPriceData) {
    console.log(`[Local Price Extraction] Extracted CNY prices: lowest=¥${localPriceData.lowestPriceCny}, highest=¥${localPriceData.highestPriceCny}, variants=${localPriceData.priceVariants.length}`);
  }
  return localPriceData;
}

function detectRentalOrService(text) {
  const normalized = String(text || '').replace(/\s+/g, '');
  return RENTAL_SERVICE_KEYWORDS.find((keyword) => normalized.includes(keyword)) || '';
}

async function archiveRentalOrServiceProduct(product, reason, mutationRetryCount, mutationTimeoutMs, retryBackoffMs) {
  await withRetry(
    () => prisma.product.update({
      where: { id: product.id },
      data: {
        isActive: false,
        status: 'ARCHIVED',
      },
    }),
    `archive rental/service ${product.id}`,
    mutationRetryCount,
    mutationTimeoutMs,
    retryBackoffMs
  );
  console.log(`🚫 Product ${product.id} archived because it looks like rental/service. Keyword: ${reason}`);
}

function roundIqd(value) {
  return Math.ceil((Number(value) || 0) / 250) * 250;
}

function convertCnyToIqdWithProfit(cny) {
  return roundIqd((Number(cny) || 0) * CNY_TO_IQD_RATE * PRICE_PROFIT_MULTIPLIER);
}

function normalizeExtractedPriceData(priceData, originalDescription = '') {
  const rawVariants = Array.isArray(priceData?.priceVariants) ? priceData.priceVariants : [];
  
  // Extract original Chinese names from description if AI returned generic names
  const extractChineseNames = (desc) => {
    const lines = desc.split(/\n|<br\s*\/?>/i);
    const namePricePairs = [];
    for (const line of lines) {
      const cleaned = line.replace(/\s+/g, ' ').trim();
      // Match patterns like "0.9米三件套（学生床 被套150*200） 32元包邮" or "黑色 15元" or "大号：25元"
      const match = cleaned.match(/^([\s\S]*?)\s*(?:[:：]\s*)?\s*(\d{1,6}(?:\.\d{1,2})?)\s*(?:元|块|人民币|￥|¥)/);
      if (match) {
        let name = match[1].trim();
        const price = parseFloat(match[2]);
        // Clean up the name - remove trailing punctuation and whitespace
        name = name.replace(/[，,；;：:\(\)（）]+$/, '').trim();
        if (name && price && name.length > 1) {
          namePricePairs.push({ name, price });
        }
      }
    }
    return namePricePairs;
  };
  
  const chineseNames = extractChineseNames(originalDescription);
  if (chineseNames.length > 0) {
    console.log(`[Price Fallback] Extracted ${chineseNames.length} name-price pairs from description: ${chineseNames.map(c => `${c.name}=${c.price}`).join(', ')}`);
  }
  
  const variants = rawVariants
    .map((variant, index) => {
      const priceCny = Number(variant?.priceCny ?? variant?.price ?? 0);
      if (!Number.isFinite(priceCny) || priceCny <= 0) return null;
      const priceIqd = convertCnyToIqdWithProfit(priceCny);
      
      let nameAr = String(variant?.nameAr || variant?.name || '').trim();
      const originalNameAr = nameAr;
      
      // If AI returned generic name or no name, try to use original Chinese name from description
      const isGenericName = /خيار\s*\d+/i.test(nameAr) || /option\s*\d+/i.test(nameAr) || /variant\s*\d+/i.test(nameAr);
      if (isGenericName || !nameAr) {
        // Try to find matching Chinese name by price — keep raw Chinese for AI translation later
        const matchedChinese = chineseNames.find(cp => Math.abs(cp.price - priceCny) < 0.01);
        if (matchedChinese) {
          nameAr = matchedChinese.name;
          console.log(`[Price Fallback] Variant ${index + 1}: AI returned "${originalNameAr}" → using raw Chinese "${nameAr}" (will translate with AI)`);
        } else {
          console.log(`[Price Fallback] Variant ${index + 1}: AI returned generic "${originalNameAr}" and no Chinese match found for price=${priceCny}`);
        }
      }
      
      if (!/[\u4e00-\u9fff]/.test(nameAr) && nameAr) {
        console.log(`[Price Fallback] Variant ${index + 1}: Using Arabic name "${nameAr}" (price=${priceCny})`);
      }
      
      return {
        nameAr,
        priceCny,
        priceIqd,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.priceIqd - b.priceIqd);

  if (!variants.length) return null;

  return {
    lowestPriceIqd: variants[0].priceIqd,
    highestPriceIqd: variants[variants.length - 1].priceIqd,
    variants,
  };
}

async function translateNamesWithAI(chineseNames) {
  if (!chineseNames?.length) return null;
  const apiKey = process.env.SILICONFLOW_API_KEY;
  if (!apiKey) {
    console.warn('[Name Translation] No SILICONFLOW_API_KEY, skipping name translation');
    return null;
  }

  const namesList = chineseNames.map((n, i) => `${i + 1}. ${n}`).join('\n');

  for (let attempt = 1; attempt <= GOOFISH_AI_RETRY_MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GOOFISH_AI_CALL_TIMEOUT_MS);

    try {
      const response = await fetch('https://api.siliconflow.com/v1/chat/completions', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: SILICONFLOW_MODEL,
          messages: [
            {
              role: 'system',
              content: 'You are a Chinese to Arabic (Iraqi dialect) translator for product variant names. Translate each Chinese product option name to clear, natural Arabic. Preserve numbers and measurements. Return EXACTLY one Arabic translation per line, in the same order as the input. No numbers, no bullets, no explanations, no JSON. Just plain text, one line per translation.'
            },
            {
              role: 'user',
              content: `Translate these Chinese product option names to Arabic (one per line):\n\n${namesList}`
            }
          ],
          temperature: 0.1,
          max_tokens: 2000
        })
      });

      if (!response.ok) {
        const isServerError = [502, 503, 504].includes(response.status);
        console.warn(`[Name Translation] SiliconFlow HTTP ${response.status}`);
        if (isServerError && attempt < GOOFISH_AI_RETRY_MAX_ATTEMPTS) {
          const backoffMs = 3000 * (2 ** (attempt - 1));
          console.log(`[Name Translation] Retrying in ${backoffMs}ms...`);
          await sleep(backoffMs);
          continue;
        }
        return null;
      }

      const data = await response.json();
      let content = data.choices?.[0]?.message?.content;
      if (!content) {
        console.warn('[Name Translation] No content in AI response');
        return null;
      }

      // Strip markdown code fences if present
      content = content.replace(/```(?:json)?\s*/g, '').replace(/```\s*$/g, '').trim();

      console.log(`[Name Translation] Raw AI response:\n---\n${content}\n---`);

      // Parse line-separated translations — one per line, in order
      const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 0);

      // Filter out numbered list prefixes like "1. " — match number+dot+space at start only
      const translations = lines.map(l => l.replace(/^\s*\d+\.\s+/, '').trim()).filter(l => l.length > 0);

      // Handle case where AI returned fewer translations than names (truncation)
      if (translations.length < chineseNames.length) {
        console.warn(`[Name Translation] Mismatch: got ${translations.length} translations for ${chineseNames.length} names. Filling remaining with raw Chinese.`);
        while (translations.length < chineseNames.length) {
          translations.push(chineseNames[translations.length]);
        }
      } else if (translations.length > chineseNames.length) {
        // AI returned extra lines, trim to match
        translations.length = chineseNames.length;
      }

      console.log(`[Name Translation] Success — ${chineseNames.length} names translated`);
      await sleep(GOOFISH_AI_RATE_LIMIT_DELAY_MS);
      return translations;
    } catch (error) {
      const errorMessage = error?.name === 'AbortError' ? `timed out after ${GOOFISH_AI_CALL_TIMEOUT_MS}ms` : error.message;
      const isServerError = /\b(502|503|504)\b/.test(errorMessage);
      console.error(`[Name Translation] Error (attempt ${attempt}/${GOOFISH_AI_RETRY_MAX_ATTEMPTS}): ${errorMessage}`);
      if (attempt < GOOFISH_AI_RETRY_MAX_ATTEMPTS) {
        const backoffMs = isServerError ? 3000 * (2 ** (attempt - 1)) : 1200 * attempt;
        console.log(`[Name Translation] Retrying in ${backoffMs}ms...`);
        await sleep(backoffMs);
      }
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

async function updateProductPricesFromDescription(product, priceData, mutationRetryCount, mutationTimeoutMs, retryBackoffMs, originalDescription = '') {
  const normalized = normalizeExtractedPriceData(priceData, originalDescription);
  if (!normalized) return false;

  // If any variant names still contain Chinese characters, batch-translate them with AI
  const chineseNamesToTranslate = normalized.variants
    .filter((v) => /[\u4e00-\u9fff]/.test(v.nameAr))
    .map((v) => v.nameAr);

  if (chineseNamesToTranslate.length > 0) {
    console.log(`[Name Translation] ${chineseNamesToTranslate.length} variant names still have Chinese, calling AI batch translation...`);
    const translations = await translateNamesWithAI(chineseNamesToTranslate);
    if (translations) {
      let transIndex = 0;
      normalized.variants.forEach((v) => {
        if (/[\u4e00-\u9fff]/.test(v.nameAr) && translations[transIndex]) {
          const oldName = v.nameAr;
          v.nameAr = String(translations[transIndex]).trim();
          console.log(`[Name Translation] Variant: "${oldName}" → "${v.nameAr}"`);
          transIndex++;
        }
      });
    }
  }

  let priceInfo = '';
  priceInfo = '\n\n💰 خيارات الأسعار:\n';
  normalized.variants.forEach((variant) => {
    priceInfo += `  - ${variant.nameAr}: ${variant.priceIqd} د.ع\n`;
  });

  const existingMetadata = product.aiMetadata && typeof product.aiMetadata === 'object' && !Array.isArray(product.aiMetadata)
    ? product.aiMetadata
    : {};
  const existingDescription = String(existingMetadata.translatedDescription || '')
    .replace(/الوصف[\s\S]*?(?=المواصفات|💰 خيارات الأسعار|$)/m, '')
    .replace(/\n\n📋[\s\S]*$/m, '')
    .replace(/\n\n💰[\s\S]*$/m, '')
    .trim();
  const nextMetadata = {
    ...existingMetadata,
    translatedDescription: `${existingDescription}${priceInfo}`.trim(),
    realPriceRange: {
      source: 'goofish_description_ai',
      currency: 'IQD',
      lowestPriceIqd: normalized.lowestPriceIqd,
      highestPriceIqd: normalized.highestPriceIqd,
      variants: normalized.variants,
      updatedAt: new Date().toISOString(),
    },
  };

  await withRetry(
    async () => {
      await prisma.$transaction(async (tx) => {
        await tx.product.update({
          where: { id: product.id },
          data: {
            price: normalized.lowestPriceIqd,
            basePriceIQD: normalized.lowestPriceIqd,
            aiMetadata: nextMetadata,
          },
        });

        await tx.productVariant.deleteMany({ where: { productId: product.id } });
        await tx.productOption.deleteMany({ where: { productId: product.id } });

        if (normalized.variants.length > 1) {
          await tx.productOption.create({
            data: {
              productId: product.id,
              name: 'السعر',
              values: JSON.stringify(normalized.variants.map((variant) => variant.nameAr)),
              originalValues: JSON.stringify(normalized.variants.map((variant) => variant.nameAr)),
            },
          });
          await tx.productVariant.createMany({
            data: normalized.variants.map((variant) => ({
              productId: product.id,
              combination: JSON.stringify({ السعر: variant.nameAr }),
              price: variant.priceIqd,
              basePriceIQD: variant.priceIqd,
              isPriceCombined: true,
            })),
          });
        }
      }, {
        timeout: Math.max(mutationTimeoutMs, 30000),
        maxWait: Math.max(5000, Math.floor(mutationTimeoutMs / 2)),
      });
    },
    `update real prices ${product.id}`,
    mutationRetryCount,
    Math.max(mutationTimeoutMs, 20000),
    retryBackoffMs
  );

  console.log(`[AI Price Extraction] Updated product ${product.id}: ${normalized.lowestPriceIqd} - ${normalized.highestPriceIqd} IQD`);
  return true;
}

async function extractDescriptionFromPage(page) {
  return page.evaluate(() => {
    try {
      const container = document.querySelector('.main--Nu33bWl6');
      if (!container) return null;

      const descEl = container.querySelector('.desc--GaIUKUQY');
      if (!descEl) return null;

      let text = descEl.innerText?.trim() || '';
      // Clean up extra whitespace and newlines
      text = text.replace(/\s+/g, ' ').trim();

      return text.length > 10 ? text : null;
    } catch (e) {
      return null;
    }
  });
}

async function translateDescriptionWithAI(description) {
  if (!description || description.length < 10) return null;
  const apiKey = process.env.SILICONFLOW_API_KEY;
  if (!apiKey) {
    console.warn('[Description Translation] No SILICONFLOW_API_KEY');
    return null;
  }

  for (let attempt = 1; attempt <= GOOFISH_AI_RETRY_MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GOOFISH_AI_CALL_TIMEOUT_MS);

    try {
      const response = await fetch('https://api.siliconflow.com/v1/chat/completions', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: SILICONFLOW_MODEL,
          messages: [
            {
              role: 'system',
              content: 'You are a Chinese to Arabic (Iraqi dialect) translator for product descriptions. Translate the Chinese product description to clear, natural Arabic. Keep brand names in English if they are English. Keep model numbers and codes as-is. Use appropriate Iraqi Arabic terminology. Return ONLY the translated Arabic text, no explanations, no markdown, no extra text.'
            },
            {
              role: 'user',
              content: description
            }
          ],
          temperature: 0.1,
          max_tokens: 3000
        })
      });

      if (!response.ok) {
        const isServerError = [502, 503, 504].includes(response.status);
        console.warn(`[Description Translation] HTTP ${response.status}`);
        if (isServerError && attempt < GOOFISH_AI_RETRY_MAX_ATTEMPTS) {
          const backoffMs = 3000 * (2 ** (attempt - 1));
          console.log(`[Description Translation] Retrying in ${backoffMs}ms...`);
          await sleep(backoffMs);
          continue;
        }
        return null;
      }

      const data = await response.json();
      let content = data.choices?.[0]?.message?.content;
      if (!content) {
        console.warn('[Description Translation] No content in AI response');
        return null;
      }

      content = content.replace(/```\s*/g, '').trim();
      await sleep(GOOFISH_AI_RATE_LIMIT_DELAY_MS);
      return content;
    } catch (error) {
      const errorMessage = error?.name === 'AbortError' ? `timed out after ${GOOFISH_AI_CALL_TIMEOUT_MS}ms` : error.message;
      const isServerError = /\b(502|503|504)\b/.test(errorMessage);
      console.error(`[Description Translation] Error (attempt ${attempt}/${GOOFISH_AI_RETRY_MAX_ATTEMPTS}): ${errorMessage}`);
      if (attempt < GOOFISH_AI_RETRY_MAX_ATTEMPTS) {
        const backoffMs = isServerError ? 3000 * (2 ** (attempt - 1)) : 1200 * attempt;
        console.log(`[Description Translation] Retrying in ${backoffMs}ms...`);
        await sleep(backoffMs);
      }
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

async function mergeDescriptionIntoMetadata(product, translatedDescription, mutationRetryCount, mutationTimeoutMs, retryBackoffMs) {
  if (!translatedDescription || translatedDescription.length < 10) return false;

  // Fetch latest aiMetadata from DB to avoid overwriting concurrent updates
  const latestProduct = await withRetry(
    () => prisma.product.findUnique({
      where: { id: product.id },
      select: { aiMetadata: true }
    }),
    `fetch metadata for description merge ${product.id}`,
    5,
    60000,
    3000
  );

  const existingMetadata = latestProduct?.aiMetadata && typeof latestProduct.aiMetadata === 'object' && !Array.isArray(latestProduct.aiMetadata)
    ? latestProduct.aiMetadata
    : {};

  const currentDesc = String(existingMetadata.translatedDescription || '');
  // Strip existing description, specs, and price sections to rebuild cleanly
  const cleanDesc = currentDesc
    .replace(/الوصف[\s\S]*?(?=المواصفات|💰 خيارات الأسعار|$)/m, '')
    .replace(/\n\n📋[\s\S]*$/m, '')
    .replace(/\n\n💰[\s\S]*$/m, '')
    .trim();

  // Preserve existing specs and price sections if present
  const specsMatch = currentDesc.match(/\n\n📋[\s\S]*$/m);
  const specsSection = specsMatch ? specsMatch[0] : '';
  const priceMatch = currentDesc.match(/\n\n💰[\s\S]*$/m);
  const priceSection = priceMatch ? priceMatch[0] : '';

  // Format new description with header
  const newDescSection = `الوصف:\n${translatedDescription}`;
  const newDesc = `${newDescSection}${specsSection}${priceSection}`.trim();

  const nextMetadata = {
    ...existingMetadata,
    translatedDescription: newDesc,
    translatedDescriptionRaw: translatedDescription,
    descriptionUpdatedAt: new Date().toISOString()
  };

  await withRetry(
    () => prisma.product.update({
      where: { id: product.id },
      data: { aiMetadata: nextMetadata }
    }),
    `update description metadata ${product.id}`,
    mutationRetryCount,
    mutationTimeoutMs,
    retryBackoffMs
  );

  console.log(`[Description] Updated product ${product.id} with translated description`);
  return true;
}

async function extractSpecsFromPage(page) {
  return page.evaluate(() => {
    try {
      const container = document.querySelector('.labels--ndhPFgp8');
      if (!container) return null;

      const specs = {};
      const items = container.querySelectorAll('.item--qI9ENIfp');
      for (const item of items) {
        const labelEl = item.querySelector('.label--ejJeaTRV');
        const valueEl = item.querySelector('.value--EyQBSInp');
        if (!labelEl || !valueEl) continue;

        const key = labelEl.innerText?.replace(/[\n\r\s\uff1a?:：]/g, '').trim() || '';
        const value = valueEl.innerText?.trim() || '';

        if (key && value && key.length < 50 && value.length < 200) {
          specs[key] = value;
        }
      }

      return Object.keys(specs).length > 0 ? specs : null;
    } catch (e) {
      return null;
    }
  });
}

function formatSpecsText(specs) {
  if (!specs || typeof specs !== 'object' || Object.keys(specs).length === 0) return '';
  const lines = Object.entries(specs)
    .map(([key, value]) => `  - ${key}: ${value}`)
    .join('\n');
  return `\n\n📋 المواصفات:\n${lines}`;
}

async function translateSpecsWithAI(specs) {
  if (!specs || Object.keys(specs).length === 0) return null;
  const apiKey = process.env.SILICONFLOW_API_KEY;
  if (!apiKey) {
    console.warn('[Specs Translation] No SILICONFLOW_API_KEY');
    return null;
  }

  // Build a simple line-by-line input instead of JSON
  const specsLines = Object.entries(specs).map(([k, v], i) => `${i + 1}. ${k}: ${v}`).join('\n');

  for (let attempt = 1; attempt <= GOOFISH_AI_RETRY_MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GOOFISH_AI_CALL_TIMEOUT_MS);

    try {
      const response = await fetch('https://api.siliconflow.com/v1/chat/completions', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: SILICONFLOW_MODEL,
          messages: [
            {
              role: 'system',
              content: 'You are a Chinese to Arabic (Iraqi dialect) translator for product specifications. Translate BOTH the key (label) AND value into natural Arabic - translating keys is MANDATORY. Keep brand names in English if they are English. Keep model numbers and codes as-is. Return EXACTLY one translated line per spec in this format: "ArabicKey: ArabicValue". One per line, in the same order. No numbers, no bullets, no markdown, no explanations, no JSON. Key translations to memorize: 品牌→الماركة, 成色→الحالة, 适用性别→الجنس, 适用季节→الموسم, 尺码→المقاس, 适用人群→الفئة المستهدفة, 材质→المادة, 颜色→اللون.'
            },
            {
              role: 'user',
              content: `Translate these product specs to Arabic (one per line, format "ArabicKey: ArabicValue" - translate BOTH keys and values):\n\n${specsLines}`
            }
          ],
          temperature: 0.1,
          max_tokens: 1500
        })
      });

      if (!response.ok) {
        const isServerError = [502, 503, 504].includes(response.status);
        console.warn(`[Specs Translation] HTTP ${response.status}`);
        if (isServerError && attempt < GOOFISH_AI_RETRY_MAX_ATTEMPTS) {
          const backoffMs = 3000 * (2 ** (attempt - 1));
          console.log(`[Specs Translation] Retrying in ${backoffMs}ms...`);
          await sleep(backoffMs);
          continue;
        }
        return null;
      }

      const data = await response.json();
      let content = data.choices?.[0]?.message?.content;
      if (!content) {
        console.warn('[Specs Translation] No content in AI response');
        return null;
      }

      content = content.replace(/```\s*/g, '').trim();

      // Parse line-separated key:value pairs
      const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 0);
      const result = {};
      let index = 0;
      for (const line of lines) {
        // Strip any leading numbering like "1. "
        const cleanLine = line.replace(/^\s*\d+\.\s+/, '').trim();
        const colonIndex = cleanLine.indexOf(':');
        if (colonIndex > 0) {
          const key = cleanLine.substring(0, colonIndex).trim();
          const value = cleanLine.substring(colonIndex + 1).trim();
          if (key && value) {
            result[key] = value;
            index++;
          }
        }
      }

      const originalKeys = Object.keys(specs);
      if (Object.keys(result).length < originalKeys.length) {
        console.warn(`[Specs Translation] Mismatch: got ${Object.keys(result).length} specs for ${originalKeys.length}.`);
      }

      const finalResult = Object.keys(result).length > 0 ? result : null;
      if (finalResult) await sleep(GOOFISH_AI_RATE_LIMIT_DELAY_MS);
      return finalResult;
    } catch (error) {
      const errorMessage = error?.name === 'AbortError' ? `timed out after ${GOOFISH_AI_CALL_TIMEOUT_MS}ms` : error.message;
      const isServerError = /\b(502|503|504)\b/.test(errorMessage);
      console.error(`[Specs Translation] Error (attempt ${attempt}/${GOOFISH_AI_RETRY_MAX_ATTEMPTS}): ${errorMessage}`);
      if (attempt < GOOFISH_AI_RETRY_MAX_ATTEMPTS) {
        const backoffMs = isServerError ? 3000 * (2 ** (attempt - 1)) : 1200 * attempt;
        console.log(`[Specs Translation] Retrying in ${backoffMs}ms...`);
        await sleep(backoffMs);
      }
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

async function mergeSpecsIntoDescription(product, translatedSpecs, mutationRetryCount, mutationTimeoutMs, retryBackoffMs) {
  if (!translatedSpecs || Object.keys(translatedSpecs).length === 0) return false;

  const specsText = formatSpecsText(translatedSpecs);
  if (!specsText) return false;

  // Fetch latest aiMetadata from DB to avoid overwriting concurrent updates
  const latestProduct = await withRetry(
    () => prisma.product.findUnique({
      where: { id: product.id },
      select: { aiMetadata: true }
    }),
    `fetch metadata for specs merge ${product.id}`,
    5,
    60000,
    3000
  );

  const existingMetadata = latestProduct?.aiMetadata && typeof latestProduct.aiMetadata === 'object' && !Array.isArray(latestProduct.aiMetadata)
    ? latestProduct.aiMetadata
    : {};

  const currentDesc = String(existingMetadata.translatedDescription || '');
  // Strip existing specs and price sections, but preserve description
  const cleanDesc = currentDesc
    .replace(/\n\n📋[\s\S]*$/m, '')
    .replace(/\n\n💰[\s\S]*$/m, '')
    .trim();

  // Preserve existing price section if present
  const priceMatch = currentDesc.match(/\n\n💰[\s\S]*$/m);
  const priceSection = priceMatch ? priceMatch[0] : '';

  const newDesc = `${cleanDesc}${specsText}${priceSection}`.trim();

  const nextMetadata = {
    ...existingMetadata,
    translatedDescription: newDesc,
    translatedSpecs,
    specsUpdatedAt: new Date().toISOString()
  };

  await withRetry(
    () => prisma.product.update({
      where: { id: product.id },
      data: { aiMetadata: nextMetadata }
    }),
    `update specs metadata ${product.id}`,
    mutationRetryCount,
    mutationTimeoutMs,
    retryBackoffMs
  );

  console.log(`[Specs] Updated product ${product.id} with ${Object.keys(translatedSpecs).length} translated specs`);
  return true;
}

async function waitForAvailabilitySignals(page, options = {}) {
  const timeoutMs = Math.max(3000, Number(options.timeoutMs) || 30000);
  const pollMs = Math.max(250, Number(options.pollMs) || 1000);
  const start = Date.now();
  let latest = null;

  while (Date.now() - start < timeoutMs) {
    latest = await collectAvailabilitySignals(page);
    if (latest.isLogin) {
      return { state: 'login', snapshot: latest };
    }
    if (latest.matchedKeyword) {
      return { state: 'unavailable', snapshot: latest };
    }
    if (latest.looksLoaded) {
      return { state: 'available', snapshot: latest };
    }
    await sleep(pollMs);
  }

  latest = latest || await collectAvailabilitySignals(page);
  if (latest.isLogin) {
    return { state: 'login', snapshot: latest };
  }
  if (latest.matchedKeyword) {
    return { state: 'unavailable', snapshot: latest };
  }
  return { state: 'unknown', snapshot: latest };
}

async function checkGoofishLinks() {
  console.log('Starting Goofish availability checker...');

  const progressFilePath = path.resolve(process.env.GOOFISH_PROGRESS_FILE || 'goofish-checker-progress.json');
  const resumeProgress = await readProgress(progressFilePath);
  const noPrompt = String(process.env.GOOFISH_NO_PROMPT || '').trim() === '1';

  let startIdRaw = 0;
  if (GOOFISH_REPROCESS_ALL) {
    console.log('🔄 GOOFISH_REPROCESS_ALL=true — resetting progress and reprocessing all products from beginning');
    resumeProgress.lastId = 0;
    try { await writeProgress(progressFilePath, { lastId: 0 }); } catch {}
  }
  if (!noPrompt && resumeProgress.lastId <= 0) {
    const startInput = await askQuestion('Start from Product ID (press Enter for beginning): ');
    startIdRaw = startInput ? parseInt(startInput.trim(), 10) : 0;
  }
  const startId = Math.max(startIdRaw || 0, resumeProgress.lastId || 0, GOOFISH_START_ID);

  console.log(`Starting check from Product ID: ${startId || 'Beginning'}`);

  const queryTimeoutMs = 15000;
  const retryCount = 2;
  const retryBackoffMs = 1000;
  const batchSize = Math.max(1, Number.parseInt(process.env.GOOFISH_BATCH_SIZE || '50', 10) || 50);
  const idScanBatch = Math.max(1, Number.parseInt(process.env.GOOFISH_ID_SCAN_BATCH || '300', 10) || 300);
  const reconnectEveryBatch = String(process.env.GOOFISH_RECONNECT_EVERY_BATCH || '0').trim() === '1';
  const parsedDbWait = Number.parseInt(process.env.GOOFISH_DB_WAIT_MS || '300000', 10);
  const dbWaitMs = 15000;
  const heartbeatMs = Math.max(5000, Number.parseInt(process.env.GOOFISH_HEARTBEAT_MS || '30000', 10) || 30000);
  const productTimeoutMs = Math.max(30000, Number.parseInt(process.env.GOOFISH_PRODUCT_TIMEOUT_MS || '180000', 10) || 180000);
  const mutationTimeoutMs = 15000;
  const mutationRetryCount = 2;
  const fetchTimeoutMs = 15000;
  const fetchRetryCount = 2;
  const statementTimeoutMs = Math.max(5000, Number.parseInt(process.env.GOOFISH_DB_STATEMENT_TIMEOUT_MS || String(Math.max(fetchTimeoutMs, mutationTimeoutMs)), 10) || Math.max(fetchTimeoutMs, mutationTimeoutMs));
  let currentLastId = startId || 0;
  const heartbeat = setInterval(async () => {
    try { await writeProgress(progressFilePath, { lastId: currentLastId }); } catch {}
  }, heartbeatMs);

  const dbReady = await waitForDbReady(dbWaitMs, 3, 10000, 2000);
  if (!dbReady) {
    console.error('Database was not reachable within the wait window. Exiting for restart.');
    await safeDbDisconnect();
    clearInterval(heartbeat);
    process.exit(99);
  }

  await withRetry(
    () => prisma.$executeRawUnsafe(`SET statement_timeout TO ${statementTimeoutMs}`),
    'set statement_timeout',
    retryCount,
    Math.max(fetchTimeoutMs, mutationTimeoutMs, 10000),
    retryBackoffMs
  );

  const goofishWhere = {
    isActive: true,
    AND: [
      {
        OR: [
          { purchaseUrl: { contains: 'goofish.com' } },
          { purchaseUrl: { contains: 'xianyu.com' } }
        ]
      },
      {
        NOT: { purchaseUrl: { contains: 'taobao.com' } }
      }
    ]
  };

  let totalProducts = null;
  try {
    totalProducts = await withRetry(
      () => prisma.product.count({ where: goofishWhere }),
      'count products',
      retryCount,
      queryTimeoutMs,
      retryBackoffMs
    );
  } catch {
    console.warn('Failed to count products. Continuing without total.');
  }

  // 2. Launch Browser
  const CHROME_PATHS = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
  ];

  let executablePath = null;
  for (const p of CHROME_PATHS) {
    if (fs.existsSync(p)) {
      executablePath = p;
      break;
    }
  }

  if (!executablePath) {
    console.error('Chrome/Edge executable not found on system.');
    process.exit(1);
  }

  // Get user's Chrome profile directory
  const userProfile = process.env.USERPROFILE || process.env.HOME || '';
  const userDataDir = process.env.GOOFISH_USER_DATA_DIR || (userProfile ? `${userProfile}\\AppData\\Local\\Google\\Chrome\\User Data` : '');

  const launchArgs = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--excludeSwitches=enable-automation',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      ...(GOOFISH_USE_CHROME_PROFILE ? [] : ['--incognito']),
      ...(GOOFISH_HEADLESS ? [
        '--disable-gpu',
        '--hide-scrollbars',
        '--mute-audio',
        '--window-size=1920,1080'
      ] : ['--start-maximized'])
    ];

  // Add user-data-dir to use user's Chrome profile
  if (GOOFISH_USE_CHROME_PROFILE && userDataDir && fs.existsSync(userDataDir)) {
    launchArgs.push(`--user-data-dir=${userDataDir}`);
    console.log(`Using Chrome profile: ${userDataDir}`);
  } else if (GOOFISH_USE_CHROME_PROFILE) {
    console.warn('Chrome profile directory not found, using default profile');
  } else {
    console.log('Using pipeline-style incognito browser with saved cookie file.');
  }

  if (process.env.PROXY_SERVER) {
    launchArgs.push(`--proxy-server=${process.env.PROXY_SERVER}`);
  } else if (process.platform === 'win32') {
    launchArgs.push('--proxy-server=http://127.0.0.1:7890');
  }
  const browser = await puppeteer.launch({
    executablePath,
    headless: GOOFISH_HEADLESS ? 'new' : false,
    defaultViewport: null,
    args: launchArgs
  });
  activeBrowser = browser;

  const configurePage = async (targetPage) => {
    const width = 1920 + Math.floor(Math.random() * 100) - 50;
    const height = 1080 + Math.floor(Math.random() * 100) - 50;
    await targetPage.setViewport({ width, height });
    const ua = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
    await targetPage.setUserAgent(ua);
    console.log(`Using User-Agent: ${ua}`);
    await targetPage.setExtraHTTPHeaders({
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Cache-Control': 'max-age=0',
      'Upgrade-Insecure-Requests': '1'
    });
    await targetPage.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      Object.defineProperty(navigator, 'language', { get: () => 'zh-CN' });
      Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en'] });
      Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
      window.chrome = { runtime: {} };
    });
  };

  const pages = await browser.pages();
  let page = pages.length > 0 ? pages[0] : await browser.newPage();
  await configurePage(page);
  const restoredCookies = await restoreCheckerCookies(page);
  if (restoredCookies && GOOFISH_ENTRY_URLS.length > 0) {
    for (const entryUrl of GOOFISH_ENTRY_URLS) {
      try {
        await page.goto(entryUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await sleep(1200);
        await closeLoginPopupIfPresent(page);
        await saveCheckerCookies(page);
        console.log(`Warmed checker session via ${entryUrl}`);
        break;
      } catch (error) {
        console.warn(`Checker warmup failed for ${entryUrl}: ${error.message}`);
      }
    }
  }

  console.log(`Browser launched in ${GOOFISH_HEADLESS ? 'hidden/headless' : 'visible'} mode.`);

  // Login wait - wait for user to manually log in before starting
  // Disabled - auto-start
  // if (!GOOFISH_HEADLESS) {
  //   console.log('\n========================================');
  //   console.log('  LOGIN WAIT');
  //   console.log('========================================');
  //   console.log('Please log in to Goofish/Xianyu in the browser.');
  //   console.log('Press Enter when you are ready to start checking...');
  //   await askQuestion('');
  // }

  console.log('Starting availability check...\n');

  let processedCount = 0;
  let unavailableCount = 0;
  let consecutiveUnverifiedLoads = 0;
  let consecutiveBatchFailures = 0;

  try {
    let lastId = startId > 0 ? startId - 1 : 0;
    while (true) {
      const batchWhere = {
        ...goofishWhere,
        id: { gt: lastId }
      };
      if (reconnectEveryBatch) {
        await safeDbDisconnect();
        await withRetry(() => prisma.$connect(), 'reconnect', retryCount, fetchTimeoutMs, retryBackoffMs);
      }

      let products = [];
      try {
        products = await withRetry(
          () => prisma.product.findMany({
            where: batchWhere,
            orderBy: { id: 'asc' },
            take: batchSize,
            select: {
              id: true,
              name: true,
              purchaseUrl: true,
              aiMetadata: true
            }
          }),
          'fetch products batch',
          fetchRetryCount,
          fetchTimeoutMs,
          retryBackoffMs
        );
      } catch (error) {
        consecutiveBatchFailures++;
        console.warn(`Batch fetch primary error (code=${toErrorCode(error) || 'n/a'}): ${toErrorText(error)}`);
        if (consecutiveBatchFailures >= 2) {
          console.error(`[Restart] ${consecutiveBatchFailures} consecutive batch failures. Exiting for restart.`);
          await writeProgress(progressFilePath, { lastId: currentLastId });
          await safeDbDisconnect();
          clearInterval(heartbeat);
          process.exit(99);
        }
        try {
          await withRetry(
            () => prisma.$queryRawUnsafe('SELECT 1'),
            'db probe after batch fetch failure',
            1,
            5000,
            500
          );
          console.warn('DB probe after batch fetch failure: OK');
        } catch (probeError) {
          console.warn(`DB probe after batch fetch failure: FAILED (code=${toErrorCode(probeError) || 'n/a'}) ${toErrorText(probeError)}`);
        }
        console.warn(`Batch fetch failed. Falling back to id-scan after id ${lastId}.`);
        if (isDbConnectivityError(error)) {
          const recovered = await waitForDbReady(dbWaitMs, retryCount, queryTimeoutMs, retryBackoffMs);
          if (!recovered) {
            throw new Error('Database connection could not be recovered after batch fetch failure.');
          }
        }
        await safeDbDisconnect();
        try {
          await withRetry(
            () => prisma.$connect(),
            'reconnect after batch fetch failure',
            2,
            10000,
            1000
          );
        } catch {}
        try {
          const idRows = await withRetry(
            () => prisma.$queryRawUnsafe(
              `SELECT id FROM "Product" WHERE id > ${lastId} AND "isActive" = true ORDER BY id ASC LIMIT ${idScanBatch}`
            ),
            'fetch id scan',
            fetchRetryCount,
            fetchTimeoutMs,
            retryBackoffMs
          );
          const ids = Array.isArray(idRows) ? idRows.map((r) => r.id).filter(Boolean) : [];
          if (ids.length > 0) {
            products = await withRetry(
              () => prisma.product.findMany({
                where: {
                  id: { in: ids },
                  isActive: true
                },
                orderBy: { id: 'asc' },
                select: {
                  id: true,
                  name: true,
                  purchaseUrl: true,
                  aiMetadata: true
                }
              }),
              'fetch products by ids',
              fetchRetryCount,
              fetchTimeoutMs,
              retryBackoffMs
            );
            products = products.filter((p) =>
              p.purchaseUrl && (p.purchaseUrl.includes('goofish.com') || p.purchaseUrl.includes('xianyu.com')) && !p.purchaseUrl.includes('taobao.com')
            );
          }
        } catch (singleError) {
          console.warn(`Id-scan fetch failed after id ${lastId}. Retrying same position without skipping.`);
          if (isDbConnectivityError(singleError)) {
            const recovered = await waitForDbReady(dbWaitMs, retryCount, queryTimeoutMs, retryBackoffMs);
            if (!recovered) {
              throw new Error('Database connection could not be recovered after id-scan failure.');
            }
          } else {
            await new Promise((r) => setTimeout(r, 2000));
          }
          continue;
        }
      }
      if (!products.length) break;
      lastId = products[products.length - 1].id;

      for (const product of products) {
      const resumeLastId = Math.max(0, Number(product.id) - 1);
      currentLastId = resumeLastId;
      try { await writeProgress(progressFilePath, { lastId: resumeLastId }); } catch {}
      processedCount++;
      const totalLabel = totalProducts ? `${processedCount}/${totalProducts}` : `${processedCount}`;
      console.log(`\n[${totalLabel}] Checking Product ID ${product.id}: ${product.name},`);
      console.log(`URL: \`${product.purchaseUrl}\``);

      if (!product.purchaseUrl) {
        console.log(`⚠️ No purchase URL for Product ${product.id}. Skipping.`);
        currentLastId = Number(product.id) || currentLastId;
        try { await writeProgress(progressFilePath, { lastId: product.id }); } catch {}
        continue;
      }

      try {
        await withTimeout(async () => {
          await humanDelay(GOOFISH_BETWEEN_PRODUCTS_MIN_MS, GOOFISH_BETWEEN_PRODUCTS_MAX_MS);
          page = await ensureProductPageOpen(page, browser, configurePage, product.purchaseUrl, {
            attempts: 3,
            gotoTimeoutMs: 60000,
            readyTimeoutMs: 30000
          });

          const availability = await waitForAvailabilitySignals(page, {
            timeoutMs: 30000,
            pollMs: 1000
          });

          if (availability.state === 'login') {
            console.warn('⚠️ Redirected to login page. Cannot verify status accurately. Skipping.');
            consecutiveUnverifiedLoads++;
            currentLastId = Number(product.id) || currentLastId;
            await saveCheckerCookies(page);
            try { await writeProgress(progressFilePath, { lastId: product.id }); } catch {}
            if (consecutiveUnverifiedLoads >= 3) {
              page = await recreateCheckerPage(browser, configurePage, page);
              consecutiveUnverifiedLoads = 0;
              console.warn('Recreated browser page after repeated login/popup loads.');
            }
            return;
          }

          if (availability.state === 'unavailable') {
            consecutiveUnverifiedLoads = 0;
            console.log(`❌ Product ${product.id} is UNAVAILABLE. Reason: Found keyword: ${availability.snapshot.matchedKeyword}`);
            await saveCheckerCookies(page);

            await withRetry(
              () => prisma.product.update({
                where: { id: product.id },
                data: {
                  isActive: false,
                  ...(GOOFISH_ARCHIVE_UNAVAILABLE ? { status: 'ARCHIVED' } : {})
                }
              }),
              `update isActive ${product.id}`,
              mutationRetryCount,
              mutationTimeoutMs,
              retryBackoffMs
            );
            unavailableCount++;
          } else if (availability.state === 'available') {
            consecutiveUnverifiedLoads = 0;
            await saveCheckerCookies(page);
            console.log(`✅ Product ${product.id} is AVAILABLE. Loaded text=${availability.snapshot.textLength}, images=${availability.snapshot.imageCount}, hasPrice=${availability.snapshot.hasPrice}, hasProductShell=${availability.snapshot.hasProductShell}`);

            const productText = `${product.name || ''}\n${availability.snapshot.description || ''}`;
            const rentalServiceKeyword = detectRentalOrService(productText);
            if (rentalServiceKeyword) {
              await archiveRentalOrServiceProduct(product, rentalServiceKeyword, mutationRetryCount, mutationTimeoutMs, retryBackoffMs);
              unavailableCount++;
              return;
            }

            if (availability.snapshot.description && availability.snapshot.description.length > 50) {
              // Check if product already has IQD prices in description
              const existingDesc = product.aiMetadata?.translatedDescription || '';
              const hasIqdPrices = /د\.?\s*ع.*\d/.test(existingDesc);
              
              if (!hasIqdPrices || GOOFISH_REPROCESS_ALL) {
                const descSnippet = availability.snapshot.description.substring(0, 120).replace(/\n/g, ' ');
                const hasPriceSign = /(?:^|[\s(])(?:¥|￥)\s*\d|(?:元|块|人民币)\s*\d{1,6}|\d{1,6}\s*(?:元|块|人民币)/.test(availability.snapshot.description);
                console.log(`[Price Check] Product ${product.id}: descLen=${availability.snapshot.description.length}, hasPriceSign=${hasPriceSign}, descStart="${descSnippet}..."`);
                const priceData = await extractPricesWithFallback(availability.snapshot.description);
                if (priceData) {
                  await updateProductPricesFromDescription(product, priceData, mutationRetryCount, mutationTimeoutMs, retryBackoffMs, availability.snapshot.description);
                }
              } else {
                console.log(`[AI Price Extraction] Product ${product.id} already has IQD prices, skipping AI extraction`);
              }

              // --- Description extraction from Xianyu/Goofish page ---
              try {
                const existingDescForDesc = product.aiMetadata?.translatedDescription || '';
                const hasDescriptionSection = /الوصف/.test(existingDescForDesc);
                if (!hasDescriptionSection || GOOFISH_REPROCESS_ALL) {
                  const rawDescription = await extractDescriptionFromPage(page);
                  if (rawDescription) {
                    console.log(`[Description] Found description on page for Product ${product.id}:`, rawDescription.substring(0, 100) + '...');
                    const translatedDescription = await translateDescriptionWithAI(rawDescription);
                    if (translatedDescription && translatedDescription.length > 10) {
                      await mergeDescriptionIntoMetadata(product, translatedDescription, mutationRetryCount, mutationTimeoutMs, retryBackoffMs);
                    } else {
                      console.warn(`[Description] AI translation failed for Product ${product.id}, skipping description update`);
                    }
                  } else {
                    console.log(`[Description] No description found on page for Product ${product.id}`);
                  }
                } else {
                  console.log(`[Description] Product ${product.id} already has description section, skipping`);
                }
              } catch (descErr) {
                console.error(`[Description] Error extracting description for Product ${product.id}: ${descErr.message}`);
              }

              // --- Specs extraction from Xianyu/Goofish page ---
              try {
                const existingDescForSpecs = product.aiMetadata?.translatedDescription || '';
                const hasSpecsSection = /المواصفات/.test(existingDescForSpecs);
                if (!hasSpecsSection || GOOFISH_REPROCESS_ALL) {
                  const rawSpecs = await extractSpecsFromPage(page);
                  if (rawSpecs) {
                    console.log(`[Specs] Found ${Object.keys(rawSpecs).length} specs on page for Product ${product.id}:`, JSON.stringify(rawSpecs));
                    const translatedSpecs = await translateSpecsWithAI(rawSpecs);
                    if (translatedSpecs && Object.keys(translatedSpecs).length > 0) {
                      await mergeSpecsIntoDescription(product, translatedSpecs, mutationRetryCount, mutationTimeoutMs, retryBackoffMs);
                    } else {
                      console.warn(`[Specs] AI translation failed for Product ${product.id}, skipping specs update`);
                    }
                  } else {
                    console.log(`[Specs] No specs section found on page for Product ${product.id}`);
                  }
                } else {
                  console.log(`[Specs] Product ${product.id} already has specs section, skipping`);
                }
              } catch (specsErr) {
                console.error(`[Specs] Error extracting specs for Product ${product.id}: ${specsErr.message}`);
              }
            }
          } else {
            consecutiveUnverifiedLoads++;
            await saveCheckerCookies(page);
            console.warn(
              `⚠️ Product ${product.id} page did not load enough to verify availability. Skipping. ` +
              `(readyState=${availability.snapshot?.readyState || 'n/a'}, text=${availability.snapshot?.textLength || 0}, images=${availability.snapshot?.imageCount || 0}, hasPrice=${availability.snapshot?.hasPrice || false}, hasProductShell=${availability.snapshot?.hasProductShell || false}, hasLoginPopup=${availability.snapshot?.hasLoginPopup || false}, hasNetworkError=${availability.snapshot?.hasNetworkError || false})`
            );
            if (availability.snapshot?.hasNetworkError) {
              console.warn('Detected Goofish network error page. Reloading once before continuing.');
              try {
                await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
                await humanDelay(3000, 5000);
              } catch (reloadError) {
                console.warn(`Reload after network error failed: ${reloadError.message}`);
              }
            }
            if (consecutiveUnverifiedLoads >= 3) {
              page = await recreateCheckerPage(browser, configurePage, page);
              consecutiveUnverifiedLoads = 0;
              console.warn('Recreated browser page after repeated unverified/blank loads.');
            }
          }
        }, `process product ${product.id}`, productTimeoutMs);

    } catch (error) {
      console.error(`Error processing Product ${product.id}:`, error.message);
      if (String(error?.message || '').includes(`process product ${product.id} timed out`)) {
        page = await recreateCheckerPage(browser, configurePage, page);
        console.warn(`Recreated browser page after timeout on Product ${product.id}.`);
      }
    }
    currentLastId = Number(product.id) || currentLastId;
    try { await writeProgress(progressFilePath, { lastId: Number(product.id) || lastId }); } catch {}
    }
  }
  } catch (err) {
    console.error('Fatal error during processing:', err);
  } finally {
    console.log('\n--- Summary ---');
    console.log(`Processed: ${processedCount}`);
    console.log(`Unavailable/Removed: ${unavailableCount}`);
    
    clearInterval(heartbeat);
    await browser.close();
    activeBrowser = null;
    await safeDbDisconnect();
    console.log('Done.');
    process.exit(0);
  }
}

checkGoofishLinks().catch(console.error);
