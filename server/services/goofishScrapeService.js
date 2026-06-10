import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import vanillaPuppeteer from 'puppeteer-core';
import puppeteerExtra from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { sanitizeProductImageUrl } from './productImageVectorService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const puppeteer = puppeteerExtra.addExtra(vanillaPuppeteer);
puppeteer.use(StealthPlugin());

const CHROME_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
];

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0'
];

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function getChromeExecutablePath() {
  const envPaths = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    process.env.GOOFISH_CHROME_PATH,
    process.env.CHROME_PATH
  ].filter(Boolean);

  for (const candidate of envPaths) {
    if (fs.existsSync(candidate)) return candidate;
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
    for (const candidate of linuxPaths) {
      if (fs.existsSync(candidate)) return candidate;
    }
    const commands = ['google-chrome-stable', 'google-chrome', 'chromium-browser', 'chromium', 'chrome'];
    for (const command of commands) {
      try {
        const result = spawnSync('which', [command], { encoding: 'utf8' });
        if (result.status === 0) {
          const resolved = String(result.stdout || '').trim().split('\n')[0];
          if (resolved && fs.existsSync(resolved)) return resolved;
        }
      } catch {
        // ignore
      }
    }
    return null;
  }

  for (const candidate of CHROME_PATHS) {
    if (fs.existsSync(candidate)) return candidate;
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

async function createBrowser() {
  let executablePath = getChromeExecutablePath();
  const headless = process.env.GOOFISH_HEADLESS === 'false' ? false : 'new';

  const launchOptions = {
    headless,
    defaultViewport: null,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--excludeSwitches=enable-automation',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-dev-shm-usage',
      '--disable-popup-blocking',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows'
    ]
  };

  if (process.env.PROXY_SERVER) {
    launchOptions.args.push(`--proxy-server=${process.env.PROXY_SERVER}`);
  }

  if (!executablePath && process.platform === 'linux') {
    if (installChromeForLinux()) {
      executablePath = getChromeExecutablePath() || findChromeInPuppeteerCache();
    }
  }

  if (executablePath) {
    launchOptions.executablePath = executablePath;
  }

  if (!executablePath) {
    throw new Error('Chrome executable not found on system and could not be installed.');
  }

  return puppeteer.launch(launchOptions);
}

function normalizeRawImageUrl(url) {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  return trimmed;
}

function isPlaceholderAlicdnImage(src) {
  if (!src || typeof src !== 'string') return false;
  const normalized = src.trim().toLowerCase();
  if (!normalized.includes('alicdn.com')) return false;
  if (normalized.includes('loading') || normalized.includes('placeholder') || normalized.includes('blank') || normalized.includes('logo') || normalized.includes('icon') || normalized.includes('avatar')) {
    return true;
  }
  if (normalized.includes('/imgextra/') && normalized.endsWith('-2-tps-2-2.png')) {
    return true;
  }
  const tpsMatch = normalized.match(/-2-tps-(\d+)-(\d+)\.png$/);
  if (tpsMatch) {
    const w = Number(tpsMatch[1]);
    const h = Number(tpsMatch[2]);
    if (w > 0 && h > 0 && w <= 20 && h <= 20) {
      return true;
    }
  }
  return false;
}

function filterImageUrls(urls) {
  const seen = new Set();
  const filtered = [];

  for (const rawUrl of urls) {
    const normalized = normalizeRawImageUrl(rawUrl);
    const sanitized = sanitizeProductImageUrl(normalized);
    if (!sanitized) continue;
    if (seen.has(sanitized)) continue;
    seen.add(sanitized);

    const lower = sanitized.toLowerCase();
    if (lower.includes('alicdn.com')) {
      if (isPlaceholderAlicdnImage(lower)) continue;
      if (lower.includes('100x100') || lower.includes('50x50') || lower.includes('40x40') || lower.includes('70x70')) continue;
      const sizeMatch = lower.match(/_(\d+)x(\d+)\./);
      if (sizeMatch) {
        const width = Number(sizeMatch[1]);
        const height = Number(sizeMatch[2]);
        if (width > 0 && height > 0 && (width < 200 || height < 200)) continue;
      }
      const tpsMatch = lower.match(/-2-tps-(\d+)-(\d+)\.(png|jpe?g|webp)$/);
      if (tpsMatch) {
        const width = Number(tpsMatch[1]);
        const height = Number(tpsMatch[2]);
        if (width > 0 && height > 0 && (width < 100 || height < 100)) continue;
      }
    }

    if (/\.(png|jpe?g|webp)$/.test(lower) || lower.includes('alicdn.com') || lower.includes('taobao.com')) {
      filtered.push(sanitized);
    }
  }

  return filtered;
}

async function extractImageCandidates(page) {
  const candidateUrls = await page.evaluate(() => {
    const attrs = ['data-src', 'data-lazy-src', 'src', 'data-imgurl', 'data-original', 'data-url'];
    const urls = [];

    const collectFromElement = (el) => {
      for (const attr of attrs) {
        const value = el.getAttribute(attr);
        if (value) {
          urls.push(value);
        }
      }
      if (el.src) urls.push(el.src);
    };

    const images = Array.from(document.querySelectorAll('img'));
    images.forEach(collectFromElement);

    const bgElements = Array.from(document.querySelectorAll('[style*="background-image"]'));
    for (const el of bgElements) {
      const style = el.style.backgroundImage || '';
      const match = style.match(/url\(["']?(.*?)["']?\)/);
      if (match?.[1]) urls.push(match[1]);
    }

    return urls.filter((value) => typeof value === 'string' && value.trim().length > 0);
  });

  return filterImageUrls(candidateUrls);
}

async function scrollPageForImages(page) {
  const step = 400;
  const viewportHeight = page.viewport()?.height || 800;
  const totalHeight = await page.evaluate(() => document.body.scrollHeight || 0);
  const scrollSteps = Math.ceil(Math.min(totalHeight / step, 20));

  for (let i = 0; i < scrollSteps; i += 1) {
    await page.evaluate((distance) => window.scrollBy(0, distance), step);
    await delay(250);
  }
  await delay(600);
  await page.evaluate(() => window.scrollTo(0, 0));
}

export async function scrapeGoofishProductImages(productUrl, options = {}) {
  const maxImages = Math.max(1, Number(options.maxImages || 8));
  const timeoutMs = Math.max(30000, Number(options.timeoutMs || 120000));

  const browser = await createBrowser();
  let page;
  try {
    page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 820 });
    await page.setUserAgent(USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]);
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7',
      'Cache-Control': 'max-age=0'
    });
    page.setDefaultNavigationTimeout(Math.min(90000, timeoutMs));

    await page.goto(productUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await delay(1500);
    await scrollPageForImages(page);

    let imageUrls = await extractImageCandidates(page);
    if (imageUrls.length === 0) {
      await delay(1200);
      await scrollPageForImages(page);
      imageUrls = await extractImageCandidates(page);
    }

    if (imageUrls.length === 0) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await delay(1500);
      imageUrls = await extractImageCandidates(page);
    }

    return imageUrls.slice(0, maxImages);
  } finally {
    try {
      if (page) await page.close();
    } catch {
      // ignore
    }
    try {
      await browser.close();
    } catch {
      // ignore
    }
  }
}
