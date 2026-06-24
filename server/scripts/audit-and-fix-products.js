#!/usr/bin/env node

/**
 * audit-and-fix-products.js
 *
 * For each product (one by one):
 *   1. Check if image is working → if broken, DELETE product from DB
 *   2. Call DeepSeek AI → get Arabic name + Arabic desc + English name + isOriginal + brandName
 *   3. Generate search embedding from ENGLISH name only (CLIP no Arabic)
 *   4. Save to DB: name=Arabic, description=Arabic, textEmbedding=English,
 *      aiMetadata.originalTitle (keeps the ORIGINAL CHINESE title, never overwritten),
 *      aiMetadata.originalTitleEnglish, aiMetadata.translatedDescription,
 *      aiMetadata.isOriginal, aiMetadata.brandName
 *
 * IMPORTANT: originalTitle must ALWAYS stay in Chinese. Translation is done FROM
 * the Chinese title (either p.name if it still has Chinese chars, or the existing
 * aiMetadata.originalTitle if p.name was already translated to Arabic).
 */

import prisma from '../prismaClient.js';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { embedText } from '../services/clipService.js';
import { translateProduct } from '../services/translationService.js';

const WORKER_DELAY_MS = 500;
const HARD_TITLE_MAX_CHARS = 140;
const HEAD_TIMEOUT_MS = 2500;
const PROGRESS_FILE = path.resolve(process.cwd(), 'audit-progress.json');
const LOCK_FILE = path.resolve(process.cwd(), 'audit-fix.lock');
const SAVE_PROGRESS_INTERVAL = 10;

// ----------------- Database Retry Logic -----------------
// Retry database operations that fail with P1017 (connection closed) or network errors
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

function isRetryableError(error) {
  if (!error) return false;
  const code = error.code;
  const message = error.message || '';
  // Prisma error codes
  if (code === 'P1017') return true; // Server has closed the connection
  if (code === 'P1008') return true; // Operations timed out
  if (code === 'P1002') return true; // Database server was not found
  if (code === 'P1001') return true; // Can't reach database server
  // Connection related messages
  if (message.includes('connection')) return true;
  if (message.includes('timeout')) return true;
  if (message.includes('ECONNRESET')) return true;
  if (message.includes('ECONNREFUSED')) return true;
  if (message.includes('closed')) return true;
  return false;
}

async function withRetry(operation, operationName = 'Database operation') {
  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isRetryableError(error)) {
        throw error; // Non-retryable error, throw immediately
      }
      if (attempt < MAX_RETRIES) {
        const delay = RETRY_DELAY_MS * attempt; // Exponential backoff
        console.log(`  ⚠️  ${operationName} failed (attempt ${attempt}/${MAX_RETRIES}): ${error.code || error.message}. Retrying in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  console.log(`  ❌  ${operationName} failed after ${MAX_RETRIES} attempts: ${lastError.code || lastError.message}`);
  throw lastError;
}

// ----------------- Free Google Translate (any -> en) -----------------
// Uses the public, unofficial Google Translate endpoint (no API key required).
// NOTE: This endpoint is intended for low-volume / non-production use.
// We add retry + backoff and never throw — on failure we fall back to a
// reasonable text (so the embedding step can still run) and the script
// never blocks.
const googleTranslateCache = new Map(); // key = `${sourceLang}::${text}`
let lastGoogleCallAt = 0;
const GOOGLE_MIN_INTERVAL_MS = 200;

// ----------------- MyMemory Translate (Fallback) -----------------
// Free tier: 1000 words/day (more if you provide email, but we'll stick to anonymous)
const myMemoryCache = new Map();
let lastMyMemoryCallAt = 0;
const MYMEMORY_MIN_INTERVAL_MS = 500;

// ----------------- Lingva Translate (Third Fallback) -----------------
// Open-source, free, no API key required.
// Multiple public instances for redundancy.
const LINGVA_INSTANCES = [
  'https://lingva.lunar.icu',
  'https://translate.plausibility.cloud',
  'https://lingva.thedaviddelta.com',
  'https://lingva.garudalinux.org',
  'https://lingva.billz.xyz',
];
const lingvaCache = new Map();
let lastLingvaCallAt = 0;
const LINGVA_MIN_INTERVAL_MS = 400;
let currentLingvaInstanceIndex = 0;

// ----------------- LibreTranslate (Fourth Fallback) -----------------
// Open-source, free, no API key required.
// Multiple public instances for redundancy.
const LIBRE_INSTANCES = [
  'https://libretranslate.de',
  'https://libretranslate.pussthecat.org',
  'https://translate.argosopentech.com',
  'https://libretranslate.terrylight.workers.dev',
];
const libreCache = new Map();
let lastLibreCallAt = 0;
const LIBRE_MIN_INTERVAL_MS = 500;
let currentLibreInstanceIndex = 0;

// ----------------- Bing Translate (Fifth Fallback) -----------------
// Uses Microsoft Bing Translate unofficial endpoint (no API key required).
// Multiple language code mappings for compatibility.
const BING_INSTANCES = [
  'https://www.bing.com/translator/api/translate',
];
const bingCache = new Map();
let lastBingCallAt = 0;
const BING_MIN_INTERVAL_MS = 600;
let currentBingInstanceIndex = 0;

// ----------------- Seznam Translate (Sixth Fallback) -----------------
// Czech dictionary/translation service, free, no API key required.
const SEZNAM_INSTANCES = [
  'https://slovnik.seznam.cz/api/v1/translate',
];
const seznamCache = new Map();
let lastSeznamCallAt = 0;
const SEZNAM_MIN_INTERVAL_MS = 500;
let currentSeznamInstanceIndex = 0;

// ----------------- Youdao Translate (Seventh Fallback) -----------------
// Chinese translation service, free, no API key required.
const YOUDAO_INSTANCES = [
  'https://fanyi.youdao.com/translate',
];
const youdaoCache = new Map();
let lastYoudaoCallAt = 0;
const YOUDAO_MIN_INTERVAL_MS = 600;
let currentYoudaoInstanceIndex = 0;

// ----------------- Yandex Translate (Eighth Fallback) -----------------
// Russian translation service, free, no API key required.
const YANDEX_INSTANCES = [
  'https://translate.yandex.net/api/v1.5/tr.json/translate',
];
const yandexCache = new Map();
let lastYandexCallAt = 0;
const YANDEX_MIN_INTERVAL_MS = 500;
let currentYandexInstanceIndex = 0;

// ----------------- Papago Translate (Ninth Fallback) -----------------
// Korean Naver translation service, free, no API key required.
const PAPAGO_INSTANCES = [
  'https://papago.naver.com/apis/n2mt/translate',
];
const papagoCache = new Map();
let lastPapagoCallAt = 0;
const PAPAGO_MIN_INTERVAL_MS = 600;
let currentPapagoInstanceIndex = 0;

// ----------------- WordReference (Tenth Fallback) -----------------
// Dictionary-based translation, free, no API key required.
const WORDREFERENCE_INSTANCES = [
  'https://api.wordreference.com/0.8/80143/translate',
];
const wordreferenceCache = new Map();
let lastWordReferenceCallAt = 0;
const WORDREFERENCE_MIN_INTERVAL_MS = 500;
let currentWordReferenceInstanceIndex = 0;

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

function delayLingvaCall() {
  const wait = LINGVA_MIN_INTERVAL_MS - (Date.now() - lastLingvaCallAt);
  if (wait > 0) return new Promise((r) => setTimeout(r, wait));
  return Promise.resolve();
}

function delayLibreCall() {
  const wait = LIBRE_MIN_INTERVAL_MS - (Date.now() - lastLibreCallAt);
  if (wait > 0) return new Promise((r) => setTimeout(r, wait));
  return Promise.resolve();
}

function delayBingCall() {
  const wait = BING_MIN_INTERVAL_MS - (Date.now() - lastBingCallAt);
  if (wait > 0) return new Promise((r) => setTimeout(r, wait));
  return Promise.resolve();
}

function delaySeznamCall() {
  const wait = SEZNAM_MIN_INTERVAL_MS - (Date.now() - lastSeznamCallAt);
  if (wait > 0) return new Promise((r) => setTimeout(r, wait));
  return Promise.resolve();
}

function delayYoudaoCall() {
  const wait = YOUDAO_MIN_INTERVAL_MS - (Date.now() - lastYoudaoCallAt);
  if (wait > 0) return new Promise((r) => setTimeout(r, wait));
  return Promise.resolve();
}

function delayYandexCall() {
  const wait = YANDEX_MIN_INTERVAL_MS - (Date.now() - lastYandexCallAt);
  if (wait > 0) return new Promise((r) => setTimeout(r, wait));
  return Promise.resolve();
}

function delayPapagoCall() {
  const wait = PAPAGO_MIN_INTERVAL_MS - (Date.now() - lastPapagoCallAt);
  if (wait > 0) return new Promise((r) => setTimeout(r, wait));
  return Promise.resolve();
}

function delayWordReferenceCall() {
  const wait = WORDREFERENCE_MIN_INTERVAL_MS - (Date.now() - lastWordReferenceCallAt);
  if (wait > 0) return new Promise((r) => setTimeout(r, wait));
  return Promise.resolve();
}

function tryParseJsonp(text) {
  // Google sometimes returns JSONP like: jQuery...({...}) or callback({...})
  // Try to extract the JSON object.
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) return null;
  const slice = text.slice(firstBrace, lastBrace + 1);
  try { return JSON.parse(slice); } catch { return null; }
}

function extractTranslatedText(parsed) {
  if (!parsed) return null;
  // Response shape: [[["translated text",null,null,null,"X chars original"],...], null, ...]
  try {
    const outer = Array.isArray(parsed) ? parsed[0] : null;
    if (Array.isArray(outer) && Array.isArray(outer[0])) {
      return String(outer[0][0] || '').trim() || null;
    }
  } catch {}
  return null;
}

/**
 * Generic free Google Translate call.
 * @param {string} text         Source text.
 * @param {string} sourceLang   BCP-47-ish code, e.g. "ar", "zh-CN", "auto".
 * @param {string} targetLang   BCP-47-ish code, e.g. "en".
 * @returns {Promise<string|null>} Translated text, or null on failure.
 */
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
      // 429 / 5xx — back off
      if (attempt < 3) await new Promise((r) => setTimeout(r, 600 * attempt));
    } catch {
      if (attempt < 3) await new Promise((r) => setTimeout(r, 600 * attempt));
    }
  }
  return null; // Let the caller decide to try MyMemory
}

/**
 * MyMemory Translate API (free)
 * Documentation: https://mymemory.translated.net/doc/spec.php
 */
async function myMemoryTranslate(text, sourceLang = 'auto', targetLang = 'en') {
  const src = String(text || '').trim();
  if (!src) return null;
  const cacheKey = `${sourceLang}::${src}`;
  if (myMemoryCache.has(cacheKey)) return myMemoryCache.get(cacheKey);

  await delayMyMemoryCall();
  // MyMemory uses langpair=src|target
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
        // MyMemory sometimes returns an error message as the translation if limits are hit
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

/**
 * Lingva Translate API (free, open-source, no key required).
 * Tries multiple public instances for redundancy.
 * Docs: https://github.com/thedaviddelta/lingva-translate
 */
async function lingvaTranslate(text, sourceLang = 'auto', targetLang = 'en') {
  const src = String(text || '').trim();
  if (!src) return null;
  const cacheKey = `${sourceLang}::${targetLang}::${src}`;
  if (lingvaCache.has(cacheKey)) return lingvaCache.get(cacheKey);

  await delayLingvaCall();

  // Normalize lang codes for Lingva (it uses zh-CN, not zh)
  const srcNorm = sourceLang === 'zh' ? 'zh-CN' : sourceLang;
  const tgtNorm = targetLang === 'zh' ? 'zh-CN' : targetLang;

  // Try each instance, cycling through on failure
  const instancesToTry = [];
  for (let i = 0; i < LINGVA_INSTANCES.length; i++) {
    const idx = (currentLingvaInstanceIndex + i) % LINGVA_INSTANCES.length;
    instancesToTry.push(LINGVA_INSTANCES[idx]);
  }

  for (const instance of instancesToTry) {
    const url = `${instance}/api/v1/${encodeURIComponent(srcNorm)}/${encodeURIComponent(tgtNorm)}/${encodeURIComponent(src.slice(0, 500))}`;
    for (let attempt = 1; attempt <= 2; attempt++) {
      lastLingvaCallAt = Date.now();
      try {
        const res = await axios.get(url, {
          timeout: 12000,
          headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
          validateStatus: (s) => s >= 200 && s < 500
        });
        if (res.status === 200 && res.data?.translation) {
          const translated = String(res.data.translation).trim();
          if (translated && translated !== src) {
            lingvaCache.set(cacheKey, translated);
            return translated;
          }
        }
        // If this instance failed, try the next one
        break;
      } catch {
        if (attempt < 2) await new Promise((r) => setTimeout(r, 800));
        // Try next instance on network error
        break;
      }
    }
  }

  return null;
}

/**
 * LibreTranslate API (free, open-source, no key required).
 * Tries multiple public instances for redundancy.
 * Docs: https://libretranslate.com/
 */
async function libreTranslate(text, sourceLang = 'auto', targetLang = 'en') {
  const src = String(text || '').trim();
  if (!src) return null;
  const cacheKey = `${sourceLang}::${targetLang}::${src}`;
  if (libreCache.has(cacheKey)) return libreCache.get(cacheKey);

  await delayLibreCall();

  // Normalize lang codes for LibreTranslate
  const srcNorm = sourceLang === 'zh-CN' ? 'zh' : sourceLang;
  const tgtNorm = targetLang === 'zh-CN' ? 'zh' : targetLang;

  // Try each instance, cycling through on failure
  const instancesToTry = [];
  for (let i = 0; i < LIBRE_INSTANCES.length; i++) {
    const idx = (currentLibreInstanceIndex + i) % LIBRE_INSTANCES.length;
    instancesToTry.push(LIBRE_INSTANCES[idx]);
  }

  for (const instance of instancesToTry) {
    const url = `${instance}/translate`;
    for (let attempt = 1; attempt <= 2; attempt++) {
      lastLibreCallAt = Date.now();
      try {
        const res = await axios.post(url, {
          q: src.slice(0, 500),
          source: srcNorm,
          target: tgtNorm,
          format: 'text'
        }, {
          timeout: 12000,
          headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
          validateStatus: (s) => s >= 200 && s < 500
        });
        if (res.status === 200 && res.data?.translatedText) {
          const translated = String(res.data.translatedText).trim();
          if (translated && translated !== src) {
            libreCache.set(cacheKey, translated);
            return translated;
          }
        }
        // If this instance failed, try the next one
        break;
      } catch {
        if (attempt < 2) await new Promise((r) => setTimeout(r, 800));
        // Try next instance on network error
        break;
      }
    }
  }

  return null;
}

/**
 * Bing Translate API (unofficial, free, no key required).
 * Uses Microsoft's Bing Translator endpoint.
 */
async function bingTranslate(text, sourceLang = 'auto', targetLang = 'en') {
  const src = String(text || '').trim();
  if (!src) return null;
  const cacheKey = `${sourceLang}::${targetLang}::${src}`;
  if (bingCache.has(cacheKey)) return bingCache.get(cacheKey);

  await delayBingCall();

  // Normalize lang codes for Bing
  const srcNorm = sourceLang === 'zh-CN' ? 'zh-Hans' : sourceLang === 'ar' ? 'ar' : sourceLang;
  const tgtNorm = targetLang === 'zh-CN' ? 'zh-Hans' : targetLang === 'ar' ? 'ar' : targetLang;

  // Try each instance
  const instancesToTry = [];
  for (let i = 0; i < BING_INSTANCES.length; i++) {
    const idx = (currentBingInstanceIndex + i) % BING_INSTANCES.length;
    instancesToTry.push(BING_INSTANCES[idx]);
  }

  for (const instance of instancesToTry) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      lastBingCallAt = Date.now();
      try {
        const res = await axios.post(instance, {
          text: src.slice(0, 1000),
          fromLang: srcNorm,
          toLang: tgtNorm,
        }, {
          timeout: 12000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          },
          validateStatus: (s) => s >= 200 && s < 500
        });
        if (res.status === 200 && res.data?.translations?.[0]?.text) {
          const translated = String(res.data.translations[0].text).trim();
          if (translated && translated !== src) {
            bingCache.set(cacheKey, translated);
            return translated;
          }
        }
        break;
      } catch {
        if (attempt < 2) await new Promise((r) => setTimeout(r, 800));
        break;
      }
    }
  }

  return null;
}

/**
 * Seznam Translate API (free, no key required).
 * Czech translation service with multilingual support.
 */
async function seznamTranslate(text, sourceLang = 'auto', targetLang = 'en') {
  const src = String(text || '').trim();
  if (!src) return null;
  const cacheKey = `${sourceLang}::${targetLang}::${src}`;
  if (seznamCache.has(cacheKey)) return seznamCache.get(cacheKey);

  await delaySeznamCall();

  // Normalize lang codes for Seznam
  const srcNorm = sourceLang === 'zh-CN' ? 'zh' : sourceLang === 'ar' ? 'ar' : sourceLang;
  const tgtNorm = targetLang === 'zh-CN' ? 'zh' : targetLang === 'ar' ? 'ar' : targetLang;

  // Try each instance
  const instancesToTry = [];
  for (let i = 0; i < SEZNAM_INSTANCES.length; i++) {
    const idx = (currentSeznamInstanceIndex + i) % SEZNAM_INSTANCES.length;
    instancesToTry.push(SEZNAM_INSTANCES[idx]);
  }

  for (const instance of instancesToTry) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      lastSeznamCallAt = Date.now();
      try {
        const res = await axios.post(instance, {
          text: src.slice(0, 500),
          source: srcNorm,
          target: tgtNorm,
        }, {
          timeout: 12000,
          headers: {
            'User-Agent': 'Mozilla/5.0',
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          },
          validateStatus: (s) => s >= 200 && s < 500
        });
        if (res.status === 200 && res.data?.result) {
          const translated = String(res.data.result).trim();
          if (translated && translated !== src) {
            seznamCache.set(cacheKey, translated);
            return translated;
          }
        }
        break;
      } catch {
        if (attempt < 2) await new Promise((r) => setTimeout(r, 800));
        break;
      }
    }
  }

  return null;
}

/**
 * Youdao Translate API (free, no key required).
 * Chinese translation service with multilingual support.
 */
async function youdaoTranslate(text, sourceLang = 'auto', targetLang = 'en') {
  const src = String(text || '').trim();
  if (!src) return null;
  const cacheKey = `${sourceLang}::${targetLang}::${src}`;
  if (youdaoCache.has(cacheKey)) return youdaoCache.get(cacheKey);

  await delayYoudaoCall();

  // Normalize lang codes for Youdao
  const srcNorm = sourceLang === 'zh-CN' ? 'zh-CHS' : sourceLang === 'ar' ? 'ar' : sourceLang;
  const tgtNorm = targetLang === 'zh-CN' ? 'zh-CHS' : targetLang === 'ar' ? 'ar' : targetLang;

  // Try each instance
  const instancesToTry = [];
  for (let i = 0; i < YOUDAO_INSTANCES.length; i++) {
    const idx = (currentYoudaoInstanceIndex + i) % YOUDAO_INSTANCES.length;
    instancesToTry.push(YOUDAO_INSTANCES[idx]);
  }

  for (const instance of instancesToTry) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      lastYoudaoCallAt = Date.now();
      try {
        const res = await axios.post(instance, {
          i: src.slice(0, 500),
          from: srcNorm,
          to: tgtNorm,
          doctype: 'json',
          version: '2.1',
        }, {
          timeout: 12000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          validateStatus: (s) => s >= 200 && s < 500
        });
        if (res.status === 200 && res.data?.translateResult) {
          const translated = res.data.translateResult
            .flat()
            .map(item => item.tgt)
            .join('')
            .trim();
          if (translated && translated !== src) {
            youdaoCache.set(cacheKey, translated);
            return translated;
          }
        }
        break;
      } catch {
        if (attempt < 2) await new Promise((r) => setTimeout(r, 800));
        break;
      }
    }
  }

  return null;
}

/**
 * Yandex Translate API (free, no key required).
 * Russian translation service with multilingual support.
 */
async function yandexTranslate(text, sourceLang = 'auto', targetLang = 'en') {
  const src = String(text || '').trim();
  if (!src) return null;
  const cacheKey = `${sourceLang}::${targetLang}::${src}`;
  if (yandexCache.has(cacheKey)) return yandexCache.get(cacheKey);

  await delayYandexCall();

  // Normalize lang codes for Yandex
  const srcNorm = sourceLang === 'zh-CN' ? 'zh' : sourceLang === 'ar' ? 'ar' : sourceLang;
  const tgtNorm = targetLang === 'zh-CN' ? 'zh' : targetLang === 'ar' ? 'ar' : targetLang;

  // Try each instance
  const instancesToTry = [];
  for (let i = 0; i < YANDEX_INSTANCES.length; i++) {
    const idx = (currentYandexInstanceIndex + i) % YANDEX_INSTANCES.length;
    instancesToTry.push(YANDEX_INSTANCES[idx]);
  }

  for (const instance of instancesToTry) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      lastYandexCallAt = Date.now();
      try {
        const res = await axios.get(instance, {
          params: {
            text: src.slice(0, 500),
            lang: `${srcNorm}-${tgtNorm}`,
            format: 'plain'
          },
          timeout: 12000,
          headers: {
            'User-Agent': 'Mozilla/5.0',
            'Accept': 'application/json'
          },
          validateStatus: (s) => s >= 200 && s < 500
        });
        if (res.status === 200 && res.data?.text) {
          const translated = Array.isArray(res.data.text) 
            ? res.data.text.join('').trim() 
            : String(res.data.text).trim();
          if (translated && translated !== src) {
            yandexCache.set(cacheKey, translated);
            return translated;
          }
        }
        break;
      } catch {
        if (attempt < 2) await new Promise((r) => setTimeout(r, 800));
        break;
      }
    }
  }

  return null;
}

/**
 * Papago Translate API (free, no key required).
 * Korean Naver translation service with multilingual support.
 */
async function papagoTranslate(text, sourceLang = 'auto', targetLang = 'en') {
  const src = String(text || '').trim();
  if (!src) return null;
  const cacheKey = `${sourceLang}::${targetLang}::${src}`;
  if (papagoCache.has(cacheKey)) return papagoCache.get(cacheKey);

  await delayPapagoCall();

  // Normalize lang codes for Papago
  const srcNorm = sourceLang === 'zh-CN' ? 'zh-CN' : sourceLang === 'ar' ? 'ar' : sourceLang;
  const tgtNorm = targetLang === 'zh-CN' ? 'zh-CN' : targetLang === 'ar' ? 'ar' : targetLang;

  // Try each instance
  const instancesToTry = [];
  for (let i = 0; i < PAPAGO_INSTANCES.length; i++) {
    const idx = (currentPapagoInstanceIndex + i) % PAPAGO_INSTANCES.length;
    instancesToTry.push(PAPAGO_INSTANCES[idx]);
  }

  for (const instance of instancesToTry) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      lastPapagoCallAt = Date.now();
      try {
        const res = await axios.post(instance, {
          source: srcNorm,
          target: tgtNorm,
          text: src.slice(0, 500),
        }, {
          timeout: 12000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          validateStatus: (s) => s >= 200 && s < 500
        });
        if (res.status === 200 && res.data?.translatedText) {
          const translated = String(res.data.translatedText).trim();
          if (translated && translated !== src) {
            papagoCache.set(cacheKey, translated);
            return translated;
          }
        }
        break;
      } catch {
        if (attempt < 2) await new Promise((r) => setTimeout(r, 800));
        break;
      }
    }
  }

  return null;
}

/**
 * WordReference Translation API (free, no key required).
 * Dictionary-based translation service.
 */
async function wordreferenceTranslate(text, sourceLang = 'auto', targetLang = 'en') {
  const src = String(text || '').trim();
  if (!src) return null;
  const cacheKey = `${sourceLang}::${targetLang}::${src}`;
  if (wordreferenceCache.has(cacheKey)) return wordreferenceCache.get(cacheKey);

  await delayWordReferenceCall();

  // Normalize lang codes for WordReference
  const srcNorm = sourceLang === 'zh-CN' ? 'zh' : sourceLang === 'ar' ? 'ar' : sourceLang;
  const tgtNorm = targetLang === 'zh-CN' ? 'zh' : targetLang === 'ar' ? 'ar' : targetLang;

  // Try each instance
  const instancesToTry = [];
  for (let i = 0; i < WORDREFERENCE_INSTANCES.length; i++) {
    const idx = (currentWordReferenceInstanceIndex + i) % WORDREFERENCE_INSTANCES.length;
    instancesToTry.push(WORDREFERENCE_INSTANCES[idx]);
  }

  for (const instance of instancesToTry) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      lastWordReferenceCallAt = Date.now();
      try {
        const res = await axios.get(instance, {
          params: {
            text: src.slice(0, 500),
            source: srcNorm,
            target: tgtNorm,
          },
          timeout: 12000,
          headers: {
            'User-Agent': 'Mozilla/5.0',
            'Accept': 'application/json'
          },
          validateStatus: (s) => s >= 200 && s < 500
        });
        if (res.status === 200 && res.data?.translation) {
          const translated = String(res.data.translation).trim();
          if (translated && translated !== src) {
            wordreferenceCache.set(cacheKey, translated);
            return translated;
          }
        }
        break;
      } catch {
        if (attempt < 2) await new Promise((r) => setTimeout(r, 800));
        break;
      }
    }
  }

  return null;
}

/**
 * Universal translation with fallback logic (10 providers).
 * Returns null if translation failed.
 * Returns "LIMIT_REACHED" if we hit quota on all providers.
 */
async function universalTranslate(text, sourceLang = 'auto', targetLang = 'en') {
  const src = String(text || '').trim();
  if (!src) return null;

  // 1. Try Google
  let translated = await googleTranslate(src, sourceLang, targetLang);

  // Basic validation: if Google returns the exact same string as source for
  // non-English source, it's often a sign of a failed translation/bypass.
  if (translated && !translated.includes('MYMEMORY WARNING')) {
    if (sourceLang === 'ar' && translated === src) {
      // Google may be blocking — continue to MyMemory
    } else if (translated === src && sourceLang !== 'en') {
      // Same text returned for non-English source = likely failure
    } else {
      return translated;
    }
  }

  // 2. Try MyMemory
  translated = await myMemoryTranslate(src, sourceLang, targetLang);
  if (translated) {
    if (sourceLang === 'ar' && translated === src) {
      // Both failed or returned source
    } else if (translated === src && sourceLang !== 'en') {
      // Same text returned
    } else {
      console.log(`    [Translator] Google failed, MyMemory success! ("${src.slice(0, 20)}..." -> "${translated.slice(0, 20)}...")`);
      return translated;
    }
  }

  // 3. Try Lingva (totally free, no key needed)
  translated = await lingvaTranslate(src, sourceLang, targetLang);
  if (translated) {
    if (sourceLang === 'ar' && translated === src) {
      // All three returned source
    } else if (translated === src && sourceLang !== 'en') {
      // All three returned source
    } else {
      console.log(`    [Translator] Google+MyMemory failed, Lingva success! ("${src.slice(0, 20)}..." -> "${translated.slice(0, 20)}...")`);
      return translated;
    }
  }

  // 4. Try LibreTranslate (open-source, free, no key needed)
  translated = await libreTranslate(src, sourceLang, targetLang);
  if (translated) {
    if (sourceLang === 'ar' && translated === src) {
      // All four returned source
    } else if (translated === src && sourceLang !== 'en') {
      // All four returned source
    } else {
      console.log(`    [Translator] Google+MyMemory+Lingva+Libr... failed, LibreTranslate success! ("${src.slice(0, 20)}..." -> "${translated.slice(0, 20)}...")`);
      return translated;
    }
  }

  // 5. Try Bing Translate (unofficial, free, no key needed)
  translated = await bingTranslate(src, sourceLang, targetLang);
  if (translated) {
    if (sourceLang === 'ar' && translated === src) {
      // All five returned source
    } else if (translated === src && sourceLang !== 'en') {
      // All five returned source
    } else {
      console.log(`    [Translator] Google+MyMemory+Lingva+Libre failed, Bing success! ("${src.slice(0, 20)}..." -> "${translated.slice(0, 20)}...")`);
      return translated;
    }
  }

  // 6. Try Seznam Translate (free, no key needed)
  translated = await seznamTranslate(src, sourceLang, targetLang);
  if (translated) {
    if (sourceLang === 'ar' && translated === src) {
      // All six returned source
    } else if (translated === src && sourceLang !== 'en') {
      // All six returned source
    } else {
      console.log(`    [Translator] All others failed, Seznam success! ("${src.slice(0, 20)}..." -> "${translated.slice(0, 20)}...")`);
      return translated;
    }
  }

  // 7. Try Youdao Translate (free, no key needed)
  translated = await youdaoTranslate(src, sourceLang, targetLang);
  if (translated) {
    if (sourceLang === 'ar' && translated === src) {
      // All seven returned source
    } else if (translated === src && sourceLang !== 'en') {
      // All seven returned source
    } else {
      console.log(`    [Translator] All others failed, Youdao success! ("${src.slice(0, 20)}..." -> "${translated.slice(0, 20)}...")`);
      return translated;
    }
  }

  // 8. Try Yandex Translate (free, no key needed)
  translated = await yandexTranslate(src, sourceLang, targetLang);
  if (translated) {
    if (sourceLang === 'ar' && translated === src) {
      // All eight returned source
    } else if (translated === src && sourceLang !== 'en') {
      // All eight returned source
    } else {
      console.log(`    [Translator] All others failed, Yandex success! ("${src.slice(0, 20)}..." -> "${translated.slice(0, 20)}...")`);
      return translated;
    }
  }

  // 9. Try Papago Translate (free, no key needed)
  translated = await papagoTranslate(src, sourceLang, targetLang);
  if (translated) {
    if (sourceLang === 'ar' && translated === src) {
      // All nine returned source
    } else if (translated === src && sourceLang !== 'en') {
      // All nine returned source
    } else {
      console.log(`    [Translator] All others failed, Papago success! ("${src.slice(0, 20)}..." -> "${translated.slice(0, 20)}...")`);
      return translated;
    }
  }

  // 10. Try WordReference (free, no key needed)
  translated = await wordreferenceTranslate(src, sourceLang, targetLang);
  if (translated) {
    if (sourceLang === 'ar' && translated === src) {
      // All ten returned source
    } else if (translated === src && sourceLang !== 'en') {
      // All ten returned source
    } else {
      console.log(`    [Translator] All others failed, WordReference success! ("${src.slice(0, 20)}..." -> "${translated.slice(0, 20)}...")`);
      return translated;
    }
  }

  // All ten providers failed or returned identical text.
  return "LIMIT_REACHED";
}

// Convenience wrappers (kept for clarity at the call site).
async function googleTranslateZhToEn(text) {
  const src = String(text || '').trim();
  if (!src) return null;
  if (!/[\u4e00-\u9fff]/.test(src)) return null; // not Chinese
  return universalTranslate(src, 'zh-CN', 'en');
}
async function googleTranslateArToEn(text) {
  const src = String(text || '').trim();
  if (!src) return null;
  return universalTranslate(src, 'ar', 'en');
}

const args = Object.fromEntries(
  process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? 'true'];
  })
);
const LIMIT = args.limit ? parseInt(args.limit, 10) : null;
const START = args.start ? parseInt(args.start, 10) : 0;

const stats = { total: 0, processed: 0, brokenImages: 0, deleted: 0, succeeded: 0, failed: 0, embedOk: 0, embedFailed: 0 };

function hasChineseChars(text) {
  return /[\u4e00-\u9fff]/.test(String(text || ''));
}

function isGoodArabicName(name) {
  const nameStr = String(name || '').trim();
  
  // 1. Empty or very short name is bad
  if (!nameStr || nameStr.length < 2) return false;
  
  // 2. Contains Chinese characters - definitely bad
  if (hasChineseChars(nameStr)) return false;
  
  // 3. Contains only numbers or symbols - bad
  if (/^[\d\s\-\_\.\:\;\+\=\*\/\\\(\)\[\]\{\}\@\#\$\%\^\&\|\<\>\!\"\'\?\,]+$/.test(nameStr)) return false;
  
  // 4. Too few Arabic letters (less than 3) - likely not a real Arabic name
  // Note: We allow some English for brands, but it must have at least some Arabic to be a "Good Arabic Name"
  const arabicLetters = nameStr.match(/[\u0600-\u06FF]/g) || [];
  if (arabicLetters.length < 3) return false;
  
  // 5. Check for repeated characters (e.g., "aaaaa" or "ببببب")
  if (/(.)\1{4,}/.test(nameStr.replace(/\s/g, ''))) return false;

  // 6. Check for nonsense long words (e.g., "asdfghjklqwertyuiop")
  const words = nameStr.split(/\s+/);
  if (words.some(w => w.length > 25)) return false;

  // 7. Contains common garbage patterns from JS/API/Scrapers
  const garbagePatterns = [
    /undefined/i,
    /null/i,
    /NaN/i,
    /\[object Object\]/i,
    /error/i,
    /exception/i,
    /failed/i,
    /test/i,
    /example/i,
    /sample/i,
    /placeholder/i,
    /dummy/i,
    /fake/i,
    /mock/i,
    /no title/i,
    /untitled/i,
    /product name/i,
    /click here/i,
    /buy now/i,
    /http/i,
    /www\./i
  ];
  
  for (const pattern of garbagePatterns) {
    if (pattern.test(nameStr)) return false;
  }
  
  // 8. Ratio check: If it has more non-Arabic/non-English/non-numeric chars than allowed
  // (already partially covered by symbol check, but this is more broad)

  // 9. Single-letter Arabic words (e.g. "ل" or "و" or "ب" standing alone as a word)
  //    These are almost always garbage from bad translation/scraping.
  const singleLetterArabic = /\b[\u0600-\u06FF]\b/;
  if (singleLetterArabic.test(nameStr)) return false;

  // 10. Words that mix Arabic and Latin/English characters (e.g. "سوiter", "netflixعربي")
  //     These indicate broken/concatenated translations and should be re-done.
  const mixedScriptWords = nameStr.split(/\s+/).some(w => /[\u0600-\u06FF]/.test(w) && /[a-zA-Z]/.test(w));
  if (mixedScriptWords) return false;

  // Looks like a reasonable Arabic product name
  return true;
}

// Lenient version used for product *descriptions* (not names). Descriptions
// legitimately contain English brand names, sizes (XL, 2XL), material words
// (Polyester, Spandex), and punctuation — so we do NOT require Arabic letters
// here. We only flag descriptions that are clearly broken: Chinese characters,
// classic garbage tokens, or effectively empty.
function isDescriptionAcceptable(text) {
  const str = String(text || '').trim();
  if (!str) return false;
  if (str.length < 12) return false; // too short to be a real description
  if (hasChineseChars(str)) return false; // Chinese = wrong language
  const garbagePatterns = [
    /\bundefined\b/i, /\bnull\b/i, /\bNaN\b/i, /\[object\s+Object\]/i,
    /\berror\b/i, /\bexception\b/i, /\bfailed\b/i, /\bplaceholder\b/i
  ];
  for (const p of garbagePatterns) {
    if (p.test(str)) return false;
  }
  return true;
}

function vectorToSqlLiteral(vector) {
  if (!Array.isArray(vector)) return null;
  return '[' + vector.map((v) => {
    if (!Number.isFinite(v)) return '0';
    return Number(v).toFixed(6).replace(/0+$/, '').replace(/\.$/, '') || '0';
  }).join(',') + ']';
}

const imageUrlCache = new Map();
async function testImageUrl(url) {
  if (!url || typeof url !== 'string') return false;
  if (imageUrlCache.has(url)) return imageUrlCache.get(url);
  for (let attempt = 0; attempt <= 1; attempt++) {
    try {
      const res = await axios.head(url, { timeout: HEAD_TIMEOUT_MS, headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'image/*' }, validateStatus: (s) => (s >= 200 && s < 400) || s === 405 || s === 403 });
      const ok = (res.status >= 200 && res.status < 400) || res.status === 405 || res.status === 403;
      imageUrlCache.set(url, ok);
      return ok;
    } catch {
      if (attempt === 1) { imageUrlCache.set(url, false); return false; }
    }
  }
  imageUrlCache.set(url, false);
  return false;
}

function loadProgress() {
  try { if (fs.existsSync(PROGRESS_FILE)) return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8')); } catch {}
  return null;
}
function saveProgress(lastProductId, processedCount) {
  try { fs.writeFileSync(PROGRESS_FILE, JSON.stringify({ lastProductId, processedCount, updatedAt: new Date().toISOString() }, null, 2), 'utf8'); } catch (e) { console.warn(`  ⚠  Could not save progress: ${e.message}`); }
}
function clearProgress() {
  try { if (fs.existsSync(PROGRESS_FILE)) fs.unlinkSync(PROGRESS_FILE); } catch {}
}

function acquireLock() {
  if (fs.existsSync(LOCK_FILE)) {
    const lockData = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
    const pid = lockData.pid;
    try {
      // Check if process is still running
      process.kill(pid, 0);
      console.error(`\n ❌ ERROR: Script is already running (PID: ${pid}).`);
      console.error(`    If you are sure it's not running, delete ${LOCK_FILE} and try again.\n`);
      process.exit(1);
    } catch (e) {
      // Process not running, we can take the lock
      console.log(` 🔄 Found stale lock file for PID ${pid}. Overwriting...`);
    }
  }
  fs.writeFileSync(LOCK_FILE, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }), 'utf8');
}

function releaseLock() {
  try { if (fs.existsSync(LOCK_FILE)) fs.unlinkSync(LOCK_FILE); } catch {}
}

let lastProcessedId = 0;
let productsSinceLastSave = 0;


async function processProduct(p) {
  stats.processed++;

  // ---- Step 1: Check image ----
  const imageCandidates = [];
  if (p.image) imageCandidates.push(p.image);
  for (const img of p.images || []) { if (img?.url) imageCandidates.push(img.url); }
  let hasWorkingImage = false;
  if (imageCandidates.length > 0) {
    const results = await Promise.all(imageCandidates.map((u) => testImageUrl(u)));
    hasWorkingImage = results.some(Boolean);
  }
  if (!hasWorkingImage) {
    stats.brokenImages++;
    try {
      await withRetry(
        () => prisma.product.delete({ where: { id: p.id } }),
        `Delete product #${p.id} (broken image)`
      );
      stats.deleted++;
      console.log(`  🗑  Product #${p.id} DELETED (broken image)`);
      return { kind: 'deleted' };
    } catch (delErr) { return { kind: 'delete_failed', id: p.id, error: delErr?.message }; }
  }

  // ---- Step 2: Already-good Arabic branch (NO DeepSeek AI) ----
  // The only thing that matters is p.name. If it looks like a real Arabic
  // product name, use the free Google path. If it doesn't (Chinese, broken,
  // garbage, too short, etc.), fall through to Step 3 and call DeepSeek.
  const nameIsGood = isGoodArabicName(p.name);

  if (nameIsGood) {
    // We translate p.name (Arabic) -> English via the free Google endpoint.
    let englishTitle = p.aiMetadata?.originalTitleEnglish || null;
    let translationSource = null;

    // 1) Translate the Arabic name to English via free Google Translate
    const translated = await googleTranslateArToEn(p.name);
    
    if (translated === "LIMIT_REACHED") {
      console.error(`\n 🛑 FATAL: Translation limits reached for Google, MyMemory, Lingva, LibreTranslate, Bing, Seznam, Youdao, Yandex, Papago, AND WordReference.`);
      console.error(`    Stopping the process to avoid corrupting data with Arabic-only English titles.\n`);
      process.exit(1);
    }

    if (translated) {
      englishTitle = translated;
      translationSource = 'google';
    }

    // 2) Final fallback: keep existing english title
    if (!englishTitle) {
      englishTitle = p.aiMetadata?.originalTitleEnglish || null;
      translationSource = translationSource || 'existing';
    }

    // If we still have no English title, we cannot generate a good embedding.
    if (!englishTitle) {
      console.log(`  ⏭️  Product #${p.id} [good] | AR: "${p.name.slice(0, 50)}..." | SKIPPED - No English translation available`);
      return { kind: 'skipped_no_en' };
    }

    // 3) Build/refresh text embedding from the English title.
    let newEmbedding = null;
    try {
      newEmbedding = await embedText(englishTitle);
      if (!Array.isArray(newEmbedding) || newEmbedding.length === 0 || newEmbedding.every((v) => v === 0)) {
        newEmbedding = null;
        stats.embedFailed++;
      } else {
        stats.embedOk++;
      }
    } catch { stats.embedFailed++; }

    // 4) Update DB with new embedding and metadata (including brand/original)
    const vectorLiteral = newEmbedding ? vectorToSqlLiteral(newEmbedding) : null;
    const metadataPatch = { 
      originalTitleEnglish: englishTitle
    };

    if (vectorLiteral) {
      await withRetry(
        () => prisma.$executeRawUnsafe(
          `UPDATE "Product" SET "textEmbedding"=$1::vector,"aiMetadata"=COALESCE("aiMetadata",'{}'::jsonb)||$2::jsonb,"updatedAt"=NOW() WHERE "id"=$3`,
          vectorLiteral, JSON.stringify(metadataPatch), p.id
        ),
        `Update product #${p.id} with new embedding and metadata`
      );
    } else {
      await withRetry(
        () => prisma.$executeRawUnsafe(
          `UPDATE "Product" SET "aiMetadata"=COALESCE("aiMetadata",'{}'::jsonb)||$1::jsonb,"updatedAt"=NOW() WHERE "id"=$2`,
          JSON.stringify(metadataPatch), p.id
        ),
        `Update product #${p.id} with metadata only`
      );
    }

    stats.succeeded++;
    console.log(`  ✅  Product #${p.id} [good] | EN: "${englishTitle.slice(0, 40)}..." | Embedding: ${vectorLiteral ? '✓' : '✗'}`);
    return { kind: 'good_fixed' };
  }

  // ---- Step 3: Determine the ORIGINAL Chinese title to translate from ----
  let chineseTitle = null;
  let chineseDesc = null;

  if (hasChineseChars(p.name)) {
    chineseTitle = p.name;
    chineseDesc = p.description;
  } else if (p.aiMetadata?.originalTitle && hasChineseChars(p.aiMetadata.originalTitle)) {
    chineseTitle = p.aiMetadata.originalTitle;
    chineseDesc = p.description;
  } else {
    if (p.aiMetadata?.originalTitleEnglish || p.aiMetadata?.translatedDescription) {
      return { kind: 'already_done' };
    }
    stats.failed++;
    console.log(`  ❌  Product #${p.id} SKIPPED — no Chinese name found`);
    return { kind: 'skipped_no_chinese' };
  }

  // ---- Step 4: Translate from Chinese ----
  try {
    const translated = await translateProduct(chineseTitle, chineseDesc);
    if (!translated) {
      stats.failed++;
      console.log(`  ❌  Product #${p.id} AI translation failed — API returned null or invalid response`);
      return { kind: 'failed' };
    }

    // ---- Step 5: Generate embedding from ENGLISH title only ----
    let newEmbedding = null;
    if (translated.titleEn) {
      try {
        newEmbedding = await embedText(translated.titleEn);
        if (!Array.isArray(newEmbedding) || newEmbedding.length === 0 || newEmbedding.every((v) => v === 0)) {
          newEmbedding = null;
          stats.embedFailed++;
        } else {
          stats.embedOk++;
        }
      } catch { stats.embedFailed++; }
    }

    const metadataPatch = {
      originalTitle: chineseTitle,
      translatedDescription: translated.descriptionAr || p.description || null,
      originalTitleEnglish: translated.titleEn || null
    };
    const vectorLiteral = newEmbedding ? vectorToSqlLiteral(newEmbedding) : null;
    // We only enter the DeepSeek branch when the Arabic name is bad (or
    // there is Chinese source material to translate from), so it's safe
    // to overwrite the name with the AI's titleAr.
    const finalArabicName = translated.titleAr || p.name;
    await withRetry(
      () => prisma.$executeRawUnsafe(
        `UPDATE "Product" SET "name"=$1,"description"=COALESCE($2,"description"),"textEmbedding"=$3::vector,"aiMetadata"=COALESCE("aiMetadata",'{}'::jsonb)||$4::jsonb,"updatedAt"=NOW() WHERE "id"=$5`,
        finalArabicName, translated.descriptionAr || p.description, vectorLiteral, JSON.stringify(metadataPatch), p.id
      ),
      `Update product #${p.id} with AI translation results`
    );

    stats.succeeded++;
    console.log(`  ✅  Product #${p.id} [bad-name] | AR: "${finalArabicName}" | EN: "${translated.titleEn || '—'}" | Embedding: ${vectorLiteral ? '✓' : '✗'}`);
    return { kind: 'ok' };
  } catch (err) {
    stats.failed++;
    console.error(`  ❌  Product #${p.id} unexpected error: ${err.message}`);
    return { kind: 'error', id: p.id, error: err.message };
  }
}

async function main() {
  acquireLock();
  
  console.log('\n ============================================================ ');
  console.log('    Product Audit & Fix (Arabic + English)');
  console.log('    Using Shared translationService');
  console.log('    MODE: Strictly Sequential');
  console.log(' ============================================================ \n');

  const progress = loadProgress();
  // Decide the start ID, in priority order:
  //   1. --start=N       : user explicitly told us where to start
  //   2. --resume        : pick up from the last saved progress (crash recovery)
  //   3. default         : start at 0 and scan ALL products in a single pass
  //
  // The old default behavior auto-resumed from the progress file, which made
  // it look like the script was "looping back" to a previous ID on every run.
  // That resume behavior is now opt-in via --resume.
  let startId = 0;
  if ('start' in args) {
    startId = START;
    console.log(` ⏩  --start=${START} given; starting from Product #${START}`);
  } else if (args.resume && progress?.lastProductId) {
    startId = progress.lastProductId;
    console.log(` ⏩  --resume given; resuming from Product #${startId} (was at ${progress.processedCount || 0} processed)`);
  } else {
    console.log(` ▶️   Starting from Product #0 (scanning all products in a single pass)`);
    if (progress?.lastProductId) {
      console.log(`    (Saved progress #${progress.lastProductId} ignored; pass --resume to use it)`);
    }
  }

  const where = { id: { gt: startId } };
  const totalToScan = await withRetry(
    () => prisma.product.count({ where }),
    'Count products to scan'
  );
  console.log(`\n 📦 Products to scan: ${totalToScan}`);

  const products = await withRetry(
    () => prisma.product.findMany({
      where,
      orderBy: { id: 'asc' },
      take: LIMIT || 999999
    }),
    'Fetch products to process'
  );

  stats.total = products.length;
  console.log(` 🔄 Will process ${products.length} products sequentially...\n`);

  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    
    await processProduct(p);
    
    lastProcessedId = p.id;
    productsSinceLastSave++;

    if (productsSinceLastSave >= SAVE_PROGRESS_INTERVAL) {
      saveProgress(lastProcessedId, i + 1);
      productsSinceLastSave = 0;
    }
    
    // Small delay between each product to be gentle on APIs
    await new Promise((r) => setTimeout(r, WORKER_DELAY_MS));
  }

  clearProgress();
  releaseLock();
  console.log('\n 🎉 DONE!');
  console.log(`    Total scanned: ${stats.processed}`);
  console.log(`    Succeeded:     ${stats.succeeded}`);
  console.log(`    Broken/Del:    ${stats.deleted}`);
  console.log(`    Failed:        ${stats.failed}`);
  console.log(`    Embeddings:    ${stats.embedOk} OK / ${stats.embedFailed} Failed\n`);
}

main().catch((err) => {
  releaseLock();
  console.error('Fatal error:', err);
  process.exit(1);
});
