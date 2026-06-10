import prisma from '../prismaClient.js';
import vanillaPuppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CHROME_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];

function getChromePath() {
  for (const p of CHROME_PATHS) { if (fs.existsSync(p)) return p; }
  return null;
}

const executablePath = getChromePath();
if (!executablePath) { console.error('Chrome not found'); process.exit(1); }

const browser = await vanillaPuppeteer.launch({
  headless: false,
  executablePath,
  args: ['--no-sandbox', '--incognito'],
});

const page = await browser.newPage();

// Load cookies
const cookiesPath = path.join(__dirname, '..', 'goofish-cookies.json');
if (fs.existsSync(cookiesPath)) {
  const cookies = JSON.parse(fs.readFileSync(cookiesPath, 'utf8'));
  await page.setCookie(...cookies);
  console.log(`Loaded ${cookies.length} cookies`);
}

// Test URL
const testUrl = 'https://www.goofish.com/item?spm=a21ybx.item.itemCnxh.35.66223da6x3uTFn&id=1047989467245&categoryId=0';

// First navigate to homepage to establish session
await page.goto('https://www.goofish.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
await new Promise(r => setTimeout(r, 3000));

// Then navigate to product page using window.location.href
await page.evaluate((url) => { window.location.href = url; }, testUrl);
await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 });
await new Promise(r => setTimeout(r, 5000));

const title = await page.title();
console.log('Title:', title);

// Count all /bao/uploaded/ images
const allCount = await page.evaluate(() => document.querySelectorAll('img[src*="/bao/uploaded/"]').length);
console.log('All /bao/uploaded/ images:', allCount);

// Get carousel images
const carouselImgs = await page.evaluate(() => {
  const carousel = document.querySelector('.item-main-window-carousel--OJQgNH3d');
  if (!carousel) return [];
  return Array.from(carousel.querySelectorAll('img')).map(img => img.src);
});
console.log('Carousel images:', carouselImgs.length);

// Get thumbnail images
const thumbImgs = await page.evaluate(() => {
  const items = document.querySelectorAll('.item-main-window-list-item--gXUlMEkj');
  return Array.from(items).map(item => {
    const img = item.querySelector('img');
    return img ? img.src : null;
  }).filter(Boolean);
});
console.log('Thumbnail images:', thumbImgs.length);

// Now test our new extraction logic
const extracted = await page.evaluate(() => {
  function extractImageId(src) {
    if (!src) return null;
    const m = src.match(/O1CN01([A-Za-z0-9_]+)/i);
    return m ? m[1] : null;
  }
  function isRealProductImage(src) {
    if (!src) return false;
    if (!src.includes('alicdn.com') || !src.includes('/bao/uploaded/')) return false;
    if (!/O1CN01/i.test(src)) return false;
    if (/-0-mtopupload/i.test(src)) return false;
    if (/\.gif/i.test(src)) return false;
    if (!/\/i\d+\/\d+\/O1CN01/i.test(src)) return false;
    return true;
  }
  function qualityScore(src) {
    if (/790x10000Q90/i.test(src)) return 3;
    if (/Q90\.jpg_\.webp/i.test(src)) return 2;
    if (/220x10000Q90/i.test(src)) return 1;
    return 0;
  }
  const bestVersions = new Map();
  function addImage(src) {
    if (!isRealProductImage(src)) return;
    const id = extractImageId(src);
    if (!id) return;
    const q = qualityScore(src);
    const existing = bestVersions.get(id);
    if (!existing || q > existing.quality) {
      bestVersions.set(id, { src, quality: q });
    }
  }
  const carousel = document.querySelector('.item-main-window-carousel--OJQgNH3d');
  if (carousel) {
    carousel.querySelectorAll('img').forEach(img => addImage(img.src || img.getAttribute('data-src')));
  }
  if (bestVersions.size === 0) {
    document.querySelectorAll('.item-main-window-list-item--gXUlMEkj').forEach(item => {
      const img = item.querySelector('img');
      addImage(img ? (img.src || img.getAttribute('data-src')) : null);
    });
  }
  return Array.from(bestVersions.values()).map(v => ({ src: v.src, quality: v.quality }));
});

console.log('\n=== EXTRACTED IMAGES ===');
console.log('Count:', extracted.length);
extracted.forEach((img, i) => {
  const size = img.quality === 3 ? 'FULL' : img.quality === 2 ? 'MED' : 'THUMB';
  console.log(`  [${i+1}] (${size}) ${img.src.substring(0, 120)}`);
});

await browser.close();
await prisma.$disconnect();
