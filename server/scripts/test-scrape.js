import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vanillaPuppeteer from 'puppeteer-core';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function normalizeUrl(url) {
  if (!url || typeof url !== 'string') return '';
  let t = url.trim();
  if (!t) return '';
  if (t.startsWith('//')) t = 'https:' + t;
  return t;
}

function isBadImage(url) {
  if (!url) return true;
  const lower = url.toLowerCase();
  if (!lower.includes('alicdn.com')) return true;
  if (!lower.includes('/bao/uploaded/')) return true;
  if (!lower.includes('o1cn')) return true;
  if (lower.includes('loading') || lower.includes('placeholder') || lower.includes('blank')) return true;
  if (lower.includes('logo') || lower.includes('avatar')) return true;
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
  if (url.startsWith('//')) url = 'https:' + url;
  url = url.replace(/[)\]}",:;]+$/g, '');
  url = url.replace(/[#?].*$/, '');
  url = url.replace(/\.webp$/i, '');
  return /^https?:\/\//i.test(url) ? url : '';
}

async function scrapeImagesFromPage(page) {
  const urls = await page.evaluate(() => {
    const results = [];
    const seen = new Set();

    function extractSrc(img) {
      if (!img) return null;
      const src = img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || img.src;
      if (!src || typeof src !== 'string') return null;
      if (!src.includes('alicdn.com') || !src.includes('/bao/uploaded/')) return null;
      if (!/O1CN01/i.test(src)) return null;
      if (/tps-\d+-\d+/.test(src)) {
        const m = src.match(/tps-(\d+)-(\d+)/);
        if (m && Number(m[1]) <= 150 && Number(m[2]) <= 150) return null;
      }
      return src;
    }

    const carouselContainer = document.querySelector('.item-main-window-carousel--OJQgNH3d');
    if (carouselContainer) {
      const carouselImgs = carouselContainer.querySelectorAll('img.ant-image-img');
      carouselImgs.forEach((img) => {
        const src = extractSrc(img);
        if (!src) return;
        const baseId = src.match(/O1CN01\w+/i)?.[0];
        if (baseId && seen.has(baseId)) return;
        if (baseId) seen.add(baseId);
        results.push(src);
      });
    }

    if (results.length === 0) {
      const thumbItems = document.querySelectorAll('.item-main-window-list-item--gXUlMEkj');
      thumbItems.forEach((item) => {
        const img = item.querySelector('img.fadeInImg--DnykYtf4') || item.querySelector('img');
        const src = extractSrc(img);
        if (!src) return;
        const baseId = src.match(/O1CN01\w+/i)?.[0];
        if (baseId && seen.has(baseId)) return;
        if (baseId) seen.add(baseId);
        results.push(src);
      });
    }

    return results;
  });

  if (urls.length === 0) return [];

  const seen = new Set();
  const good = [];

  for (const raw of urls) {
    const normalized = normalizeUrl(raw);
    const sanitized = sanitizeImageUrl(normalized);
    if (!sanitized) continue;
    if (isBadImage(sanitized)) continue;
    const baseId = sanitized.match(/O1CN01\w+/i)?.[0];
    if (baseId && seen.has(baseId)) continue;
    if (baseId) seen.add(baseId);
    good.push(sanitized);
  }

  return good;
}

async function main() {
  const testUrl = 'https://www.goofish.com/item?spm=a21ybx.home.feedsCnxh.8.4c053da69mYsTp&id=1006749651041&categoryId=202149254';
  
  const chromePaths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];
  
  let executablePath = null;
  for (const p of chromePaths) {
    if (fs.existsSync(p)) {
      executablePath = p;
      break;
    }
  }
  
  if (!executablePath) {
    console.log('Chrome not found');
    return;
  }

  const browser = await vanillaPuppeteer.launch({
    headless: true,
    defaultViewport: { width: 1280, height: 820 },
    executablePath,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36');
  
  console.log('Navigating to:', testUrl);
  await page.goto(testUrl, { waitUntil: 'networkidle2', timeout: 60000 });
  
  console.log('Waiting for carousel...');
  try {
    await page.waitForSelector('.item-main-window-carousel--OJQgNH3d', { timeout: 15000 });
    console.log('Carousel found!');
  } catch (e) {
    console.log('Carousel selector not found, continuing...');
  }
  
  await new Promise(r => setTimeout(r, 3000));
  
  const images = await scrapeImagesFromPage(page);
  console.log('\nFound', images.length, 'images:\n');
  images.forEach((img, i) => console.log((i + 1) + '.', img));
  
  await browser.close();
}

main().catch(console.error);