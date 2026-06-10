import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import readline from 'readline';

import prisma from '../prismaClient.js';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
puppeteer.use(StealthPlugin());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ------------------------------------------------------------------
// Config
// ------------------------------------------------------------------
const START_PRODUCT_ID = 40000;
const MAX_IMAGES_PER_PRODUCT = 20;
const NAV_TIMEOUT = 60000;

// No delays — run as fast as possible
const MIN_DELAY_BETWEEN_PRODUCTS = 0;
const MAX_DELAY_BETWEEN_PRODUCTS = 0;
const MIN_PAGE_WAIT = 0;
const MAX_PAGE_WAIT = 0;

const PROGRESS_FILE = path.join(__dirname, '..', 'scrape_images_progress.json');

// ------------------------------------------------------------------
// Randomized viewport dimensions for anti-detection
// ------------------------------------------------------------------
// Choose a realistic window size each run to avoid fingerprinting patterns.
// Width between 1200‑1600px, height between 800‑1200px.
const vpWidth = randInt(1200, 1600);
const vpHeight = randInt(800, 1200);

// ------------------------------------------------------------------
// Anti-detection utilities
// ------------------------------------------------------------------

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getDelayBetweenProducts(productIndex) {
  return 0;
}

function getPageWait() {
  return 0;
}

// ------------------------------------------------------------------
// Captcha detection — only detect if a real captcha overlay is blocking the page
// ------------------------------------------------------------------
async function isCaptchaShowing(page) {
  try {
    return await page.evaluate(() => {
      // 1. Geetest captcha iframe (the most common Goofish captcha)
      const geetestIframes = document.querySelectorAll(
        'iframe[src*="geetest.com"], iframe[src*="captcha"], iframe[id*="captcha"]'
      );
      for (const iframe of geetestIframes) {
        const style = window.getComputedStyle(iframe);
        const rect = iframe.getBoundingClientRect();
        // Only count if it's actually visible and large enough to be a captcha (not a tiny hidden tracker)
        if (style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 100 && rect.height > 50) {
          return true;
        }
      }

      // 2. Geetest popup panel — the actual captcha challenge overlay
      const geetestPanel = document.querySelector(
        '.geetest_panel, .geetest_wind, .geetest_popup_wrap, [class*="geetest_panel_wrap"]'
      );
      if (geetestPanel) {
        const style = window.getComputedStyle(geetestPanel);
        const rect = geetestPanel.getBoundingClientRect();
        if (style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 100) {
          return true;
        }
      }

      // 3. Generic captcha overlay — a large overlay div that covers the page
      const overlays = document.querySelectorAll(
        '[class*="captcha_wrap"], [class*="captcha-box"], [class*="verify-box"], [id*="captcha_wrap"]'
      );
      for (const el of overlays) {
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        // Must be visible and cover a significant portion of the page
        if (style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 200 && rect.height > 100) {
          return true;
        }
      }

      // 4. Check for captcha text ONLY when page has no real content
      // (if images/content already loaded, it's not a captcha blocking the page)
      const productImgs = document.querySelectorAll('img[src*="/bao/uploaded/"]');
      const bodyText = (document.body?.innerText || '').trim();
      if (productImgs.length === 0 && bodyText.length < 200) {
        if (bodyText.includes('请完成验证') || bodyText.includes('点击验证') || bodyText.includes('滑动验证')) {
          return true;
        }
      }

      return false;
    });
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
// Check if page has meaningful product content
// ------------------------------------------------------------------
async function hasProductContent(page) {
  try {
    return await page.evaluate(() => {
      const bodyText = (document.body?.innerText || '').trim();
      // Check for product name / description indicators
      const hasProductImgs = document.querySelectorAll('img[src*="/bao/uploaded/"]').length > 0;
      const hasTitle = document.querySelector('[class*="title"], [class*="name"], h1, h2') !== null;
      const hasDesc = bodyText.length > 200; // Real product pages have lots of text
      const hasPrice = bodyText.includes('¥') || bodyText.includes('元');
      return hasProductImgs || (hasTitle && (hasDesc || hasPrice));
    });
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
// Chrome detection
// ------------------------------------------------------------------
const CHROME_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
];

function getChromeExecutablePath() {
  const envPaths = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    process.env.GOOFISH_CHROME_PATH,
    process.env.CHROME_PATH,
  ].filter(Boolean);
  for (const p of envPaths) { if (fs.existsSync(p)) return p; }
  for (const p of CHROME_PATHS) { if (fs.existsSync(p)) return p; }

  // Try 'where' command as last resort
  try {
    const r = spawnSync('where', ['chrome'], { encoding: 'utf8' });
    if (r.status === 0) {
      const first = String(r.stdout).trim().split('\n')[0].trim();
      if (first && fs.existsSync(first)) return first;
    }
  } catch { /* ignore */ }

  return null;
}

// ------------------------------------------------------------------
// Image URL helpers
// ------------------------------------------------------------------
function normalizeUrl(url) {
  if (!url || typeof url !== 'string') return '';
  let t = url.trim();
  if (!t) return '';
  if (t.startsWith('//')) t = `https:${t}`;
  return t;
}

function isBadImage(url) {
  if (!url) return true;
  const lower = url.toLowerCase();

  // Must be from alicdn for product images
  if (!lower.includes('alicdn.com')) return true;

  // Must contain /bao/uploaded/ — this is the pattern for actual product images on Goofish
  if (!lower.includes('/bao/uploaded/')) return true;

  // Must have O1CN pattern (actual product image ID)
  if (!lower.includes('o1cn')) return true;

  // Exclude known placeholder/icon patterns
  if (lower.includes('loading') || lower.includes('placeholder') || lower.includes('blank')) return true;
  if (lower.includes('logo') || lower.includes('avatar')) return true;

  // Exclude video/UI control icons (tps-X-X where X <= 150)
  const tpsMatch = lower.match(/tps-(\d+)-(\d+)/);
  if (tpsMatch) {
    const w = Number(tpsMatch[1]);
    const h = Number(tpsMatch[2]);
    if (w > 0 && h > 0 && w <= 150 && h <= 150) return true;
  }

  return false;
}

function sanitizeImageUrl(input) {
  if (typeof input !== 'string') return '';
  let url = input.trim();
  if (!url) return '';
  url = url.replace(/^[`'"]+|[`'"]+$/g, '');
  if (url.startsWith('//')) url = `https:${url}`;
  // Remove .webp suffix
  url = url.replace(/\.webp$/i, '');
  // Remove trailing underscores and whitespace one at a time
  while (url.length > 0 && (url[url.length - 1] === '_' || url[url.length - 1] === ' ')) {
    url = url.substring(0, url.length - 1);
  }
  return /^https?:\/\//i.test(url) ? url : '';
}

function getImageBaseId(url) {
  if (!url) return null;
  const m = url.match(/O1CN01\w+/i);
  return m ? m[0] : null;
}

// ------------------------------------------------------------------
// Scrape images from a single product page
// Strategy: Collect from carousel (high-res) first, then thumbnails.
// Only get images from the product image containers, filter out
// placeholders and junk images.
// ------------------------------------------------------------------
async function scrapeImagesFromPage(page) {
  // Wait briefly for product images to appear (lazy-loaded)
  try {
    await page.waitForFunction(
      () => document.querySelectorAll('img[src*="/bao/uploaded/"]').length > 0,
      { timeout: 10000 }
    );
  } catch { /* ignore timeout – we'll still try to collect whatever is present */ }

  const urlGroups = await page.evaluate(() => {
    // Extract the unique image ID from a URL
    function extractImageId(src) {
      if (!src) return null;
      const m = src.match(/O1CN01([A-Za-z0-9_]+)/i);
      return m ? m[1] : null;
    }

    // Quality score: higher = better
    function qualityScore(src) {
      if (/790x10000Q90/i.test(src)) return 3;
      if (/Q90\.jpg_\.webp/i.test(src)) return 2;
      if (/220x10000Q90/i.test(src)) return 1;
      return 0;
    }

    // Collect unique images, keeping only the highest quality version of each
    const bestVersions = new Map();

    function addImage(src) {
      if (!src) return;
      // Must be a real product image from alicdn
      if (!src.includes('alicdn.com') || !src.includes('/bao/uploaded/')) return;
      if (!/O1CN01/i.test(src)) return;
      if (/-0-mtopupload/i.test(src)) return;
      if (/\.gif/i.test(src)) return;
      if (!/\/i\d+\/O1CN01/i.test(src)) return;
      const id = extractImageId(src);
      if (!id) return;
      const q = qualityScore(src);
      const existing = bestVersions.get(id);
      if (!existing || q > existing.quality) {
        bestVersions.set(id, { src, quality: q });
      }
    }

    // STRATEGY: Collect ONLY images from the product image carousel area.
    // Goofish pages have recommendation/similar product images below the fold
    // that we must NOT collect. We identify the main product images by:
    //   1. Finding the large product image carousel (above the fold)
    //   2. Only taking images that are large enough (real product photos)
    //   3. Excluding images from recommendation/similar sections

    // Step 1: Find the main product image area
    // Goofish product images are in a carousel/slider near the top.
    // Look for the first large image container on the page.
    const allImgs = document.querySelectorAll('img[src*="/bao/uploaded/"]');

    // Find the first large product image — this marks the start of the product image area
    let firstLargeIdx = -1;
    for (let i = 0; i < allImgs.length; i++) {
      const img = allImgs[i];
      const w = img.naturalWidth || img.width || 0;
      const h = img.naturalHeight || img.height || 0;
      // Real product images are at least 200x200
      if (w >= 200 && h >= 200) {
        firstLargeIdx = i;
        break;
      }
    }

    if (firstLargeIdx === -1) {
      // No large images found — page might still be loading or captcha
      return [];
    }

    // Step 2: Collect consecutive large images starting from the first one
    // Stop when we hit a small image (likely a recommendation thumbnail)
    // or when images are from a clearly different section
    for (let i = firstLargeIdx; i < allImgs.length; i++) {
      const img = allImgs[i];
      const w = img.naturalWidth || img.width || 0;
      const h = img.naturalHeight || img.height || 0;
      const src = img.src || img.getAttribute('data-src') || '';

      // Skip hidden images
      const style = window.getComputedStyle(img);
      if (style.display === 'none' || style.visibility === 'hidden') continue;

      // If image is too small, it's likely a recommendation thumbnail — skip it and everything after
      if (w > 0 && h > 0 && w < 200 && h < 200) break;

      // Skip images from recommendation/similar sections
      const parent = img.closest('[class*="recommend"], [class*="similar"], [class*="related"], [class*="other"], [class*="more"]');
      if (parent) break;

      addImage(src);
    }

    return Array.from(bestVersions.values()).map(v => v.src);
  });

  if (urlGroups.length === 0) return [];

  // Process and sanitize URLs
  const seen = new Set();
  const good = [];

  for (const raw of urlGroups) {
    const normalized = normalizeUrl(raw);
    const sanitized = sanitizeImageUrl(normalized);
    if (!sanitized) continue;
    if (isBadImage(sanitized)) continue;

    const baseId = getImageBaseId(sanitized);
    if (baseId && seen.has(baseId)) continue;
    if (baseId) seen.add(baseId);

    good.push(sanitized);
  }

  // Enforce max images per product (Goofish typically has 1-8 images)
  const MAX = 8;
  if (good.length > MAX) {
    console.log(`    ⚠️  Found ${good.length} images, trimming to ${MAX}`);
    console.log(`    All ${good.length} images before trim:`);
    for (let i = 0; i < good.length; i++) {
      console.log(`      [${i + 1}] ${good[i]}`);
    }
    return good.slice(0, MAX);
  }

  return good;
}

async function scrapeProductImages(purchaseUrl, page) {
  console.log(`    Navigating to: ${purchaseUrl}`);
  let soldOut = false;

  try {
    // Set referer to look like we came from Goofish homepage
    await page.setExtraHTTPHeaders({
      'Referer': 'https://www.goofish.com/',
    });
    // Navigate using window.location.href to appear more natural
    await page.evaluate((url) => { window.location.href = url; }, purchaseUrl);
    // Wait for navigation to complete
    await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
    console.log(`    Page loaded, URL: ${page.url()}`);
  } catch (navErr) {
    console.log(`    Navigation error: ${navErr.message}`);
    // Fallback to goto
    try {
      await page.goto(purchaseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch (navErr2) {
      console.log(`    Fallback also failed: ${navErr2.message}`);
      return { images: [], soldOut: false };
    }
  }

  // Wait for the page to actually render content
  console.log(`    Waiting for page to render...`);
  await new Promise((r) => setTimeout(r, 2000));

  // Check page title to detect login redirect
  const pageUrl = page.url();
  const pageTitle = await page.title();
  console.log(`    Page title: ${pageTitle}`);

  // If redirected to login page, skip
  if (pageTitle.includes('登录') || pageTitle.includes('login') || pageUrl.includes('login')) {
    console.log(`    Redirected to login page, skipping`);
    return { images: [], soldOut: false };
  }

  // Check if product is sold out (卖掉了 / 已下架 / 商品不存在)
  try {
    soldOut = await page.evaluate(() => {
      // Check for sold-out badge with various class patterns
      const soldBadge = document.querySelector('.banned--Uy6Se2D8') ||
                        document.querySelector('[class*="banned"]') ||
                        document.querySelector('[class*="sold"]');
      if (soldBadge && soldBadge.innerText.includes('卖掉了')) return true;
      // Check for other unavailable indicators
      const bodyText = document.documentElement?.innerText || '';
      if (bodyText.includes('卖掉了')) return true;
      if (bodyText.includes('已下架')) return true;
      if (bodyText.includes('商品不存在')) return true;
      if (bodyText.includes('宝贝不存在')) return true;
      // Check if page title is generic (product didn't load)
      const title = document.title || '';
      if (title === '闲鱼 - 闲不住？上闲鱼！' || title === '闲鱼') {
        // Page didn't load the product — might be removed/sold
        return false; // Don't mark as sold out, just skip (page issue)
      }
      return false;
    });
    if (soldOut) {
      console.log(`    ⚠️  Product is sold out/unavailable`);
      return { images: [], soldOut: true };
    }
  } catch { /* ignore */ }

  // Wait for product images to appear (they're lazy-loaded)
  // Use waitForFunction which is more reliable than evaluate for this
  let hasImgs = false;
  try {
    await page.waitForFunction(
      () => document.querySelectorAll('img[src*="/bao/uploaded/"]').length > 0,
      { timeout: 15000 }
    );
    hasImgs = true;
    console.log(`    Product images detected after waiting`);
  } catch {
    console.log(`    No product images appeared after 15s wait — possible captcha`);
  }

  // Also check if page has any meaningful content at all
  let bodyLen = 0;
  try {
    bodyLen = await page.evaluate(() => {
      return (document.documentElement?.innerText?.trim() || document.body?.innerText?.trim() || '').length;
    });
  } catch (evalErr) {
    console.log(`    Evaluate error: ${evalErr.message}`);
  }
  console.log(`    Content check: imgs=${hasImgs}, bodyLen=${bodyLen}`);

  // Check for captcha — if detected, pause and wait for user
  const captchaShowing = await isCaptchaShowing(page);
  if (captchaShowing) {
    console.log('');
    console.log('    🔒 CAPTCHA DETECTED — Please solve the captcha in the browser.');
    console.log('    After solving, press ENTER here to continue...');
    await promptEnter('    Press ENTER to continue...');
  }

  // Check if page has meaningful product content (name, desc, etc.)
  const hasContent = await hasProductContent(page);
  if (!hasContent) {
    console.log('');
    console.log('    ⚠️  No product content detected (no name/description/images).');
    console.log('    This may be a captcha or blocked page.');
    console.log('    Please fix the issue in the browser, then press ENTER to continue...');
    await promptEnter('    Press ENTER to continue...');

    // Re-check after user intervention
    const stillNoContent = !(await hasProductContent(page));
    if (stillNoContent) {
      console.log(`    Still no content after user prompt, skipping product`);
      return { images: [], soldOut: false };
    }
  }

  // Final content check after all interventions
  try {
    bodyLen = await page.evaluate(() => {
      return (document.documentElement?.innerText?.trim() || document.body?.innerText?.trim() || '').length;
    });
  } catch { /* ignore */ }

  // Scrape images from the page
  const images = await scrapeImagesFromPage(page);
  console.log(`    Found ${images.length} images`);
  for (let i = 0; i < images.length; i++) {
    console.log(`      [${i + 1}] ${images[i]}`);
  }

  // Return sold-out flag along with images
  return { images: images.slice(0, MAX_IMAGES_PER_PRODUCT), soldOut };
}

// ------------------------------------------------------------------
// Progress persistence
// ------------------------------------------------------------------
function loadProgress() {
  try {
    if (fs.existsSync(PROGRESS_FILE)) {
      return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
    }
  } catch { /* ignore */ }
  return { lastProcessedId: START_PRODUCT_ID - 1, totalImagesAdded: 0, totalProductsScraped: 0, totalProductsSkipped: 0 };
}

function saveProgress(progress) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

// ------------------------------------------------------------------
// Prompt user to press Enter (used once for initial login)
// ------------------------------------------------------------------
function promptEnter(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, () => {
      rl.close();
      resolve();
    });
  });
}

// ------------------------------------------------------------------
// Main
// ------------------------------------------------------------------
async function main() {
  console.log('========================================');
  console.log('  Batch Product Image Scraper');
  console.log('  Starting from product ID:', START_PRODUCT_ID);
  console.log('========================================\n');

  const progress = loadProgress();
  console.log(`Progress loaded: last processed ID = ${progress.lastProcessedId}`);
  console.log(`  Total images added so far: ${progress.totalImagesAdded}`);
  console.log(`  Total products scraped so far: ${progress.totalProductsScraped}`);
  console.log(`  Total products skipped so far: ${progress.totalProductsSkipped}\n`);

  // Launch Chrome — match pipeline's incognito + anti-detection approach
  let browser;
  try {
    const executablePath = getChromeExecutablePath();
    if (!executablePath) {
      console.error('Chrome executable not found. Please install Chrome or set CHROME_PATH env var.');
      process.exit(1);
    }

    browser = await puppeteer.launch({
      headless: false,
      defaultViewport: null,
      executablePath,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars',
        '--excludeSwitches=enable-automation',
        '--disable-features=IsolateOrigins,site-per-process',
        '--incognito',
        '--disable-dev-shm-usage',
        '--disable-popup-blocking',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows',
        `--window-size=${vpWidth},${vpHeight}`,
        '--disable-extensions',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-sync',
      ],
      ignoreDefaultArgs: ['--enable-automation'],
    });
  } catch (launchErr) {
    console.error('Failed to launch Chrome:', launchErr.message);
    console.error('Try closing all Chrome windows and running again.');
    process.exit(1);
  }

  // With --incognito flag, all pages are already incognito.
  // Close any initial blank tab and create our page — matches pipeline approach.
  const pages = await browser.pages();
  const page = pages[0] || await browser.newPage();
  // Close any extra blank tabs
  for (const p of pages) {
    if (p !== page) try { await p.close(); } catch { /* ignore */ }
  }
  console.log('✅ Chrome incognito window ready!');

  // Randomize viewport slightly (like pipeline)
  const vw = 1920 + Math.floor(Math.random() * 100) - 50;
  const vh = 1080 + Math.floor(Math.random() * 100) - 50;
  await page.setViewport({ width: vw, height: vh });

  // Always delete old cookies first — fresh login every run
  const cookiesPath = path.join(__dirname, '..', 'goofish-cookies.json');
  try {
    if (fs.existsSync(cookiesPath)) {
      fs.unlinkSync(cookiesPath);
      console.log('   Deleted old cookies file.');
    }
  } catch (delErr) {
    console.warn(`   Failed to delete old cookies: ${delErr.message}`);
  }

  // Clear any existing cookies in the browser context
  try {
    const existingCookies = await page.cookies();
    if (existingCookies.length > 0) {
      await page.deleteCookie(...existingCookies);
      console.log(`   Cleared ${existingCookies.length} existing browser cookies.`);
    }
  } catch (clearErr) {
    console.warn(`   Failed to clear browser cookies: ${clearErr.message}`);
  }

  // Navigate to Goofish homepage — user must log in fresh every time
  console.log('');
  console.log('   ⚠️  Fresh login required. A browser window will open.');
  console.log('   Please log in to Goofish in the browser.');
  console.log('   After logging in, press ENTER here to save cookies and start scraping.');
  console.log('');

  try {
    await page.goto('https://www.goofish.com/', {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
  } catch (navErr) {
    console.warn(`   Homepage load failed: ${navErr.message}`);
  }

  await promptEnter('   Press ENTER after logging in...');

  // Check if captcha is showing after login — solve it before saving cookies
  const postLoginCaptcha = await isCaptchaShowing(page);
  if (postLoginCaptcha) {
    console.log('');
    console.log('   🔒 CAPTCHA detected after login — Please solve it in the browser.');
    console.log('   After solving, press ENTER to save cookies and continue...');
    await promptEnter('   Press ENTER after solving captcha...');
  }

  // Save the fresh cookies (after captcha is solved)
  try {
    const cookies = await page.cookies();
    fs.writeFileSync(cookiesPath, JSON.stringify(cookies, null, 2));
    console.log(`   Saved ${cookies.length} fresh cookies.`);
  } catch (saveErr) {
    console.warn(`   Failed to save cookies: ${saveErr.message}`);
  }

  console.log('   Scraping will begin automatically...\n');

  // Rotate user agents — use same versions as pipeline (more common = less suspicious)
  const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
  ];
  const ua = USER_AGENTS[randInt(0, USER_AGENTS.length - 1)];
  await page.setUserAgent(ua);
  console.log(`   Using User-Agent: ${ua}`);

  // Match pipeline's HTTP headers
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Cache-Control': 'max-age=0',
    'Upgrade-Insecure-Requests': '1',
  });
  page.setDefaultNavigationTimeout(NAV_TIMEOUT);

  // Inject anti-detection scripts — match pipeline's fingerprint masking
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'language', { get: () => 'zh-CN' });
    Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en'] });
    Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
    window.chrome = { runtime: {} };
  });


  let done = false;

  while (!done) {
    // Fetch ONE product at a time in sequential order (40000, 40001, 40002...)
    const product = await prisma.product.findFirst({
      where: {
        id: { gt: progress.lastProcessedId },
      },
      orderBy: { id: 'asc' },
      select: { id: true, purchaseUrl: true, image: true },
    });

    if (!product) {
      console.log('\n✅ No more products to process. Done!');
      done = true;
      break;
    }

    const { id: productId, purchaseUrl } = product;

    // Skip products without a purchase URL (but still advance progress)
    if (!purchaseUrl) {
      console.log(`\n--- Skipping product ${productId} (no URL) ---`);
      progress.lastProcessedId = productId;
      progress.totalProductsSkipped++;
      saveProgress(progress);
      continue;
    }

    console.log(`\n--- Processing product ${productId} ---`);

    try {
      const result = await scrapeProductImages(purchaseUrl, page);
      const imageUrls = result.images;
      const soldOut = result.soldOut;

      // If product is sold out, archive it
      if (soldOut) {
        await prisma.product.update({
          where: { id: productId },
          data: { status: 'ARCHIVED', isActive: false },
        });
        console.log(`  [${productId}] 🗑️  Sold out — archived and deactivated.`);
        progress.lastProcessedId = productId;
        progress.totalProductsSkipped++;
        saveProgress(progress);
      } else if (imageUrls.length === 0) {
        console.log(`  [${productId}] No images found.`);
        progress.lastProcessedId = productId;
        progress.totalProductsScraped++;
        saveProgress(progress);
      } else {
        // Get existing images to avoid duplicates
        const existing = await prisma.productImage.findMany({
          where: { productId },
          select: { url: true },
        });
        const existingSet = new Set(existing.map((img) => sanitizeImageUrl(img.url)).filter(Boolean));

        const newUrls = imageUrls.filter((url) => !existingSet.has(url));

        if (newUrls.length > 0) {
          await prisma.$transaction(async (tx) => {
            // Set main image if product doesn't have one
            await tx.product.update({
              where: { id: productId },
              data: { image: newUrls[0] },
            });

            // Insert new gallery images
            await tx.productImage.createMany({
              data: newUrls.map((url, idx) => ({
                productId,
                url,
                order: existing.length + idx,
                type: 'GALLERY',
              })),
            });
          });

          console.log(`  [${productId}] ✅ Added ${newUrls.length} images (total found: ${imageUrls.length})`);
          for (let i = 0; i < newUrls.length; i++) {
            console.log(`      [${i + 1}] ${newUrls[i]}`);
          }
          progress.totalImagesAdded += newUrls.length;
        } else {
          console.log(`  [${productId}] All ${imageUrls.length} images already exist, skipped.`);
          for (let i = 0; i < imageUrls.length; i++) {
            console.log(`      [${i + 1}] ${imageUrls[i]}`);
          }
        }

        progress.lastProcessedId = productId;
        progress.totalProductsScraped++;
        saveProgress(progress);
      }
    } catch (err) {
      console.error(`  [${productId}] ❌ Error: ${err.message || err}`);
      progress.lastProcessedId = productId;
      progress.totalProductsSkipped++;
      saveProgress(progress);
    }

    // Print running totals
    console.log(`\n📊 Running totals:`);
    console.log(`  Last processed ID : ${progress.lastProcessedId}`);
    console.log(`  Images added       : ${progress.totalImagesAdded}`);
    console.log(`  Products scraped   : ${progress.totalProductsScraped}`);
    console.log(`  Products skipped   : ${progress.totalProductsSkipped}`);

    // No delay between products (set to 0)
    const productsSoFar = progress.totalProductsScraped + progress.totalProductsSkipped;
    const delayMs = getDelayBetweenProducts(productsSoFar);
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
  }

  try { await page.close(); } catch { /* ignore */ }
  try { await browser.close(); } catch { /* ignore */ }

  console.log('\n========================================');
  console.log('  FINAL RESULTS');
  console.log('========================================');
  console.log(`  Last processed ID  : ${progress.lastProcessedId}`);
  console.log(`  Total images added  : ${progress.totalImagesAdded}`);
  console.log(`  Products scraped    : ${progress.totalProductsScraped}`);
  console.log(`  Products skipped    : ${progress.totalProductsSkipped}`);
  console.log('========================================\n');

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  prisma.$disconnect();
  process.exit(1);
});
