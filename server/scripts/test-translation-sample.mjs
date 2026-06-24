#!/usr/bin/env node

/**
 * test-translation-sample.mjs
 *
 * Picks 20 random products from the database, translates their
 * aiMetadata.originalTitle (Chinese) to Arabic using the FREE Google
 * Translate API (no API key needed), and writes results to
 * test-translation-results.json.
 *
 * Uses the same googleTranslate logic from audit-and-fix-products.js.
 */

import prisma from '../prismaClient.js';
import axios from 'axios';
import fs from 'fs';
import path from 'path';

const OUTPUT_FILE = path.resolve(process.cwd(), 'test-translation-results.json');
const SAMPLE_SIZE = 20;

// ---------- Google Translate (free, no API key) ----------
const googleTranslateCache = new Map();
let lastGoogleCallAt = 0;
const GOOGLE_MIN_INTERVAL_MS = 500;

// ---------- MyMemory Translate (Fallback) ----------
const myMemoryCache = new Map();
let lastMyMemoryCallAt = 0;
const MYMEMORY_MIN_INTERVAL_MS = 500;

function delayGoogleCall() {
  const wait = GOOGLE_MIN_INTERVAL_MS - (Date.now() - lastGoogleCallAt);
  if (wait > 0) return new Promise((r) => setTimeout(r, wait));
  return Promise.resolve();
}

function delayMyMemoryCall() {
  const wait = MYMEMORY_MIN_INTERVAL_MS - (Date.now() - lastMyMemoryCallAt);
  if (wait > 0) return new Promise((r) => setTimeout(r, wait));
  return Promise.resolve();
}

function tryParseJsonp(text) {
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) return null;
  const slice = text.slice(firstBrace, lastBrace + 1);
  try { return JSON.parse(slice); } catch { return null; }
}

function extractTranslatedText(parsed) {
  if (!parsed) return null;
  try {
    const outer = Array.isArray(parsed) ? parsed[0] : null;
    if (Array.isArray(outer) && Array.isArray(outer[0])) {
      return String(outer[0][0] || '').trim() || null;
    }
  } catch {}
  return null;
}

async function googleTranslate(text, sourceLang = 'auto', targetLang = 'en') {
  const src = String(text || '').trim();
  if (!src) return null;
  const cacheKey = `${sourceLang}::${src}`;
  if (googleTranslateCache.has(cacheKey)) return googleTranslateCache.get(cacheKey);

  await delayGoogleCall();
  const url = 'https://translate.googleapis.com/translate_a/single';
  const params = {
    client: 'gtx',
    sl: sourceLang,
    tl: targetLang,
    dt: 't',
    q: src.slice(0, 1200)
  };
  for (let attempt = 1; attempt <= 3; attempt++) {
    lastGoogleCallAt = Date.now();
    try {
      const res = await axios.get(url, {
        params,
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': '*/*'
        },
        validateStatus: (s) => s >= 200 && s < 500
      });
      if (res.status >= 200 && res.status < 300) {
        const parsed = typeof res.data === 'string' ? tryParseJsonp(res.data) : res.data;
        const translated = extractTranslatedText(parsed);
        if (translated) {
          googleTranslateCache.set(cacheKey, translated);
          return translated;
        }
      }
      if (attempt < 3) await new Promise((r) => setTimeout(r, 600 * attempt));
    } catch {
      if (attempt < 3) await new Promise((r) => setTimeout(r, 600 * attempt));
    }
  }
  return null;
}

async function myMemoryTranslate(text, sourceLang = 'auto', targetLang = 'en') {
  const src = String(text || '').trim();
  if (!src) return null;
  const cacheKey = `${sourceLang}::${src}`;
  if (myMemoryCache.has(cacheKey)) return myMemoryCache.get(cacheKey);

  await delayMyMemoryCall();
  const langpair = `${sourceLang}|${targetLang}`;
  const url = 'https://api.mymemory.translated.net/get';
  
  for (let attempt = 1; attempt <= 2; attempt++) {
    lastMyMemoryCallAt = Date.now();
    try {
      const res = await axios.get(url, {
        params: { q: src.slice(0, 500), langpair },
        timeout: 10000,
        validateStatus: (s) => s >= 200 && s < 500
      });
      
      if (res.status === 200 && res.data?.responseData?.translatedText) {
        const translated = String(res.data.responseData.translatedText).trim();
        if (translated && !translated.includes('MYMEMORY WARNING') && !translated.includes('YOU HAVE EXCEEDED')) {
          myMemoryCache.set(cacheKey, translated);
          return translated;
        }
      }
      if (attempt < 2) await new Promise((r) => setTimeout(r, 1000 * attempt));
    } catch {
      if (attempt < 2) await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
  return null;
}

async function universalTranslate(text, sourceLang = 'auto', targetLang = 'en') {
  let translated = await googleTranslate(text, sourceLang, targetLang);
  if (translated) return translated;
  return myMemoryTranslate(text, sourceLang, targetLang);
}

// ---------- Main ----------
async function main() {
  console.log('============================================================');
  console.log('  Test Translation — Arabic to English (Google + MyMemory)');
  console.log('  Testing fallback logic');
  console.log('============================================================\n');

  const testArabicTerms = [
    'هاتف محمول',
    'ملابس رجالية',
    'حذاء رياضي',
    'ساعة يد فاخرة',
    'نظارات شمسية'
  ];

  console.log(`Testing ${testArabicTerms.length} Arabic terms...\n`);

  for (const term of testArabicTerms) {
    console.log(`  🔍  Arabic Query: "${term}"`);
    try {
      const translatedEn = await universalTranslate(term, 'ar', 'en');
      if (translatedEn) {
        console.log(`      ✅  English: "${translatedEn}"`);
      } else {
        console.log(`      ❌  Translation failed`);
      }
    } catch (err) {
      console.log(`      ❌  Error: ${err.message}`);
    }
    console.log('');
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});