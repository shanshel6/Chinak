import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import { promises as fsPromises } from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import axios from 'axios';
import readline from 'readline';
import { embedImage } from '../services/clipService.js';

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
const SILICONFLOW_API_KEY = String(process.env.SILICONFLOW_API_KEY || '').trim();
const GOOFISH_DB_COOLDOWN_WINDOW_MS = Math.max(1000, Number.parseInt(process.env.GOOFISH_DB_COOLDOWN_WINDOW_MS || '120000', 10) || 120000);
const GOOFISH_DB_COOLDOWN_THRESHOLD = Math.max(2, Number.parseInt(process.env.GOOFISH_DB_COOLDOWN_THRESHOLD || '4', 10) || 4);
const GOOFISH_DB_COOLDOWN_SLEEP_MS = Math.max(1000, Number.parseInt(process.env.GOOFISH_DB_COOLDOWN_SLEEP_MS || '15000', 10) || 15000);
const parsedRecoverWaitMs = Number.parseInt(process.env.GOOFISH_DB_RECOVER_WAIT_MS || '120000', 10);
const GOOFISH_DB_RECOVER_WAIT_MS = Number.isFinite(parsedRecoverWaitMs) ? Math.max(0, parsedRecoverWaitMs) : 120000;
const GOOFISH_DB_RECOVER_PING_TIMEOUT_MS = Math.max(1000, Number.parseInt(process.env.GOOFISH_DB_RECOVER_PING_TIMEOUT_MS || '12000', 10) || 12000);
let activeBrowser = null;
let shutdownInProgress = false;
let dbConnectivityFailureTimestamps = [];

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
  'Sold out',
  'This item is no longer available',
  '商品已失效' // Product invalid
];

// Simple SiliconFlow client using axios
async function callSiliconFlow(messages, temperature = 0.3, maxTokens = 500) {
  const apiKey = SILICONFLOW_API_KEY;
  if (!apiKey) return null;
  const timeoutMs = Math.max(1000, Number.parseInt(process.env.SILICONFLOW_TIMEOUT_MS || '60000', 10) || 60000);
  const retries = Math.max(1, Number.parseInt(process.env.SILICONFLOW_RETRY_COUNT || '3', 10) || 3);
  const backoffMs = Math.max(200, Number.parseInt(process.env.SILICONFLOW_RETRY_BACKOFF_MS || '2000', 10) || 2000);
  let lastError;
  for (let i = 1; i <= retries; i++) {
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
        timeout: timeoutMs
      });
      return response.data.choices[0].message.content.trim();
    } catch (error) {
      lastError = error;
      console.error(`SiliconFlow API Error (attempt ${i}/${retries}):`, error.message);
      if (error.response) {
        console.error('Response data:', error.response.data);
      }
      if (i < retries) {
        await new Promise((r) => setTimeout(r, backoffMs * i));
      }
    }
  }
  return null;
}

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

async function checkGoofishLinks() {
  console.log('Starting Goofish link checker & image updater...');
  if (SILICONFLOW_API_KEY) {
      console.log('AI Translation Enabled.');
  } else {
      console.warn('AI Translation DISABLED. No API Key found.');
  }

  const progressFilePath = path.resolve(process.env.GOOFISH_PROGRESS_FILE || 'goofish-checker-progress.json');
  const resumeProgress = await readProgress(progressFilePath);
  const noPrompt = String(process.env.GOOFISH_NO_PROMPT || '').trim() === '1';

  let startIdRaw = 0;
  if (!noPrompt && resumeProgress.lastId <= 0) {
    const startInput = await askQuestion('Start from Product ID (press Enter for beginning): ');
    startIdRaw = startInput ? parseInt(startInput.trim(), 10) : 0;
  }
  const startId = Math.max(startIdRaw || 0, resumeProgress.lastId || 0);

  console.log(`Starting check from Product ID: ${startId || 'Beginning'}`);

  const queryTimeoutMs = Math.max(1000, Number.parseInt(process.env.GOOFISH_QUERY_TIMEOUT_MS || '90000', 10) || 90000);
  const updateTimeoutMs = Math.max(1000, Number.parseInt(process.env.GOOFISH_UPDATE_TIMEOUT_MS || '180000', 10) || 180000);
  const retryCount = Math.max(1, Number.parseInt(process.env.GOOFISH_RETRY_COUNT || '5', 10) || 5);
  const retryBackoffMs = Math.max(200, Number.parseInt(process.env.GOOFISH_RETRY_BACKOFF_MS || '2000', 10) || 2000);
  const batchSize = Math.max(1, Number.parseInt(process.env.GOOFISH_BATCH_SIZE || '50', 10) || 50);
  const idScanBatch = Math.max(1, Number.parseInt(process.env.GOOFISH_ID_SCAN_BATCH || '300', 10) || 300);
  const reconnectEveryBatch = String(process.env.GOOFISH_RECONNECT_EVERY_BATCH || '0').trim() === '1';
  const parsedDbWait = Number.parseInt(process.env.GOOFISH_DB_WAIT_MS || '300000', 10);
  const dbWaitMs = Number.isFinite(parsedDbWait) ? Math.max(0, parsedDbWait) : 300000;
  const heartbeatMs = Math.max(5000, Number.parseInt(process.env.GOOFISH_HEARTBEAT_MS || '30000', 10) || 30000);
  const productTimeoutMs = Math.max(30000, Number.parseInt(process.env.GOOFISH_PRODUCT_TIMEOUT_MS || '180000', 10) || 180000);
  const mutationTimeoutMs = Math.max(3000, Number.parseInt(process.env.GOOFISH_MUTATION_TIMEOUT_MS || '12000', 10) || 12000);
  const mutationRetryCount = Math.max(1, Number.parseInt(process.env.GOOFISH_MUTATION_RETRY_COUNT || '1', 10) || 1);
  const fetchTimeoutMs = Math.max(5000, Number.parseInt(process.env.GOOFISH_FETCH_TIMEOUT_MS || '20000', 10) || 20000);
  const fetchRetryCount = Math.max(1, Number.parseInt(process.env.GOOFISH_FETCH_RETRY_COUNT || '1', 10) || 1);
  const newOrOldTimeoutMs = Math.max(5000, Number.parseInt(process.env.GOOFISH_NEWOROLD_TIMEOUT_MS || '20000', 10) || 20000);
  const newOrOldRetryCount = Math.max(1, Number.parseInt(process.env.GOOFISH_NEWOROLD_RETRY_COUNT || '2', 10) || 2);
  const statementTimeoutMs = Math.max(5000, Number.parseInt(process.env.GOOFISH_DB_STATEMENT_TIMEOUT_MS || String(Math.max(fetchTimeoutMs, newOrOldTimeoutMs, mutationTimeoutMs)), 10) || Math.max(fetchTimeoutMs, newOrOldTimeoutMs, mutationTimeoutMs));
  let currentLastId = startId || 0;
  const heartbeat = setInterval(async () => {
    try { await writeProgress(progressFilePath, { lastId: currentLastId }); } catch {}
  }, heartbeatMs);

  const dbReady = await waitForDbReady(dbWaitMs, retryCount, queryTimeoutMs, retryBackoffMs);
  if (!dbReady) {
    console.error('Database was not reachable within the wait window. Exiting.');
    await safeDbDisconnect();
    clearInterval(heartbeat);
    return;
  }

  await withRetry(
    () => prisma.$executeRawUnsafe(`SET statement_timeout TO ${statementTimeoutMs}`),
    'set statement_timeout',
    retryCount,
    Math.max(fetchTimeoutMs, mutationTimeoutMs, newOrOldTimeoutMs, 10000),
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

  const browser = await puppeteer.launch({
    executablePath,
    headless: false,
    defaultViewport: null,
    args: [
      '--start-maximized',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--excludeSwitches=enable-automation',
      '--disable-features=IsolateOrigins,site-per-process',
      '--incognito'
    ]
  });
  activeBrowser = browser;

  const configurePage = async (targetPage) => {
    const width = 1920 + Math.floor(Math.random() * 100) - 50;
    const height = 1080 + Math.floor(Math.random() * 100) - 50;
    await targetPage.setViewport({ width, height });
    await targetPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
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

  console.log('Browser launched. Processing products...');

  let processedCount = 0;
  let updatedCount = 0;
  let unavailableCount = 0;
  let embeddedCount = 0;

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
              imagesChecked: true,
                specs: true,
                image: true
            }
          }),
          'fetch products batch',
          fetchRetryCount,
          fetchTimeoutMs,
          retryBackoffMs
        );
      } catch (error) {
        console.warn(`Batch fetch primary error (code=${toErrorCode(error) || 'n/a'}): ${toErrorText(error)}`);
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
                  imagesChecked: true,
                  specs: true,
                  image: true
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
          await page.goto(product.purchaseUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        
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
            currentLastId = Number(product.id) || currentLastId;
            try { await writeProgress(progressFilePath, { lastId: product.id }); } catch {}
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
            unavailableCount++;
          } else {
            console.log(`✅ Product ${product.id} is AVAILABLE.`);
            let imageToEmbed = String(product.image || '').trim();
          
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
                await withRetry(
                  () => prisma.product.update({
                    where: { id: product.id },
                    data: { neworold: newOrOldStatus }
                  }),
                  `update neworold ${product.id}`,
                  newOrOldRetryCount,
                  newOrOldTimeoutMs,
                  retryBackoffMs
                );
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
                      2,
                      10000,
                      1000
                    );
                  } catch {}
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

                console.log(`[DEBUG] Product ${product.id} - API Key Present: ${!!SILICONFLOW_API_KEY}, Contains Chinese: ${containsChinese}`);

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
                      
                      await withRetry(
                        () => prisma.product.update({
                          where: { id: product.id },
                          data: { specs: JSON.stringify(translatedSpecs) }
                        }),
                        `update specs ${product.id}`,
                        mutationRetryCount,
                        mutationTimeoutMs,
                        retryBackoffMs
                      );
                    } else {
                        console.warn(`⚠️ Translation returned empty for Product ${product.id}. Saving raw specs.`);
                        await withRetry(
                          () => prisma.product.update({
                              where: { id: product.id },
                              data: { specs: rawSpecsText }
                          }),
                          `update specs raw ${product.id}`,
                          mutationRetryCount,
                          mutationTimeoutMs,
                          retryBackoffMs
                        );
                    }
                  } catch (err) {
                    console.error(`❌ Failed to translate specs for Product ${product.id}:`, err.message);
                    await withRetry(
                      () => prisma.product.update({
                        where: { id: product.id },
                        data: { specs: rawSpecsText }
                      }),
                      `update specs fallback ${product.id}`,
                      mutationRetryCount,
                      mutationTimeoutMs,
                      retryBackoffMs
                    );
                  }
                } else {
                  console.warn(`⚠️ SILICONFLOW_API_KEY missing. Saving raw specs for Product ${product.id}.`);
                  await withRetry(
                    () => prisma.product.update({
                      where: { id: product.id },
                      data: { specs: rawSpecsText }
                    }),
                    `update specs raw ${product.id}`,
                    mutationRetryCount,
                    mutationTimeoutMs,
                    retryBackoffMs
                  );
                }
              }
            }

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

                const mainImage = cleanImages[0];

                console.log(`Found ${cleanImages.length} images. Updating database...`);

                await withRetry(
                  () => prisma.$transaction(async (tx) => {
                    await tx.product.update({
                      where: { id: product.id },
                      data: { 
                        image: mainImage,
                        imagesChecked: true
                      }
                    });

                    await tx.productImage.deleteMany({
                      where: { productId: product.id }
                    });

                    if (cleanImages.length > 0) {
                      await tx.productImage.createMany({
                        data: cleanImages.map((url, index) => ({
                          productId: product.id,
                          url: url,
                          order: index,
                          type: 'GALLERY'
                        }))
                      });
                    }
                  }, {
                    maxWait: 15000,
                    timeout: 60000
                  }),
                  `update images ${product.id}`,
                  mutationRetryCount,
                  mutationTimeoutMs,
                  retryBackoffMs
                );
                updatedCount++;
                console.log(`Images updated for Product ${product.id}`);
                imageToEmbed = mainImage;
              } else {
                console.log('No images found with the specified selector.');
                
                await withRetry(
                  () => prisma.product.update({
                    where: { id: product.id },
                    data: { imagesChecked: true }
                  }),
                  `mark imagesChecked ${product.id}`,
                  mutationRetryCount,
                  mutationTimeoutMs,
                  retryBackoffMs
                );
                console.log(`Marked Product ${product.id} as checked (no images found).`);
              }
            }

            const normalizedImageToEmbed = String(imageToEmbed || '').trim();
            if (normalizedImageToEmbed && normalizedImageToEmbed !== 'null' && normalizedImageToEmbed !== 'undefined') {
              let cleanImageToEmbed = normalizedImageToEmbed;
              if (cleanImageToEmbed.startsWith('//')) cleanImageToEmbed = `https:${cleanImageToEmbed}`;
              cleanImageToEmbed = cleanImageToEmbed.replace(/_\d+x\d+.*$/, '').replace(/\.webp$/, '');

              console.log(`ℹ️ Generating image embedding for Product ${product.id}...`);
              try {
                const embedding = await embedImage(cleanImageToEmbed, null);
                if (embedding && embedding.length > 0) {
                  const vectorStr = `[${embedding.join(',')}]`;
                  await withRetry(
                    () => prisma.$executeRawUnsafe(
                      `UPDATE "Product" SET "imageEmbedding" = $1::vector WHERE "id" = $2`,
                      vectorStr,
                      product.id
                    ),
                    `update embedding ${product.id}`,
                    mutationRetryCount,
                    mutationTimeoutMs,
                    retryBackoffMs
                  );
                  embeddedCount++;
                  console.log(`✅ Embedding saved for Product ${product.id}`);
                } else {
                  console.warn(`⚠️ Empty embedding for Product ${product.id}`);
                }
              } catch (embedErr) {
                console.error(`❌ Embedding error for Product ${product.id}: ${toErrorText(embedErr)}`);
              }
            } else {
              console.log(`ℹ️ No valid image for embedding for Product ${product.id}`);
            }
          }
        }, `process product ${product.id}`, productTimeoutMs);

    } catch (error) {
      console.error(`Error processing Product ${product.id}:`, error.message);
      if (String(error?.message || '').includes(`process product ${product.id} timed out`)) {
        try { await page.close({ runBeforeUnload: false }); } catch {}
        page = await browser.newPage();
        await configurePage(page);
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
    console.log(`Images Updated: ${updatedCount}`);
    console.log(`Embeddings Saved: ${embeddedCount}`);
    
    clearInterval(heartbeat);
    await browser.close();
    activeBrowser = null;
    await safeDbDisconnect();
    console.log('Done.');
    process.exit(0);
  }
}

checkGoofishLinks().catch(console.error);
