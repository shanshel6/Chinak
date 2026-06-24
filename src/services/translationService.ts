/**
 * Translation service for Arabic → English translation
 * Uses Google Translate API with CORS proxy for client-side translation
 */

import { Capacitor, CapacitorHttp } from '@capacitor/core';

export type TranslationMethod = 'google' | 'mymemory' | 'fallback';

export interface TranslationResult {
  text: string;
  method: TranslationMethod;
}

/**
 * ====================================================================
 * CLIENT-SIDE TRANSLATION CACHING IS DISABLED.
 *
 * We were hitting a bug where a "مفتاح" → "مفتاح" (Arabic echoed back
 * unchanged) result was getting cached, then re-served forever, which
 * made CLIP embed raw Arabic and return random products.
 *
 * While debugging, every translation now goes out to the network so the
 * logs are easy to read. Re-enable later with an LRU + TTL + integrity
 * check (must contain NO Arabic chars).
 * ====================================================================
 */
const TRANSLATION_CACHE_DISABLED = true;
const TRANSLATION_CACHE_MAX = 200;
const translationCache = new Map<string, TranslationResult>();

function cacheGet(key: string): TranslationResult | undefined {
  if (TRANSLATION_CACHE_DISABLED) return undefined;
  const v = translationCache.get(key);
  if (v) {
    // Refresh insertion order (LRU)
    translationCache.delete(key);
    translationCache.set(key, v);
  }
  return v;
}

function cachePut(key: string, value: TranslationResult): void {
  if (TRANSLATION_CACHE_DISABLED) return;
  if (translationCache.has(key)) translationCache.delete(key);
  translationCache.set(key, value);
  if (translationCache.size > TRANSLATION_CACHE_MAX) {
    const firstKey = translationCache.keys().next().value;
    if (firstKey !== undefined) translationCache.delete(firstKey);
  }
}





/**
 * Post-process the English translation to fix known-wrong outputs.
 * Each fix is conditional on the ORIGINAL ARABIC input having contained
 * the corresponding Arabic keyword.
 */
function postprocessEnglishTranslation(
  english: string,
  originalArabic: string
): string {
  let result = english;
  const lower = originalArabic;

  // --- 1. Fix "بشرة" → skin (not "human being(s)") ---
  if (/بشرة|بشرات/.test(lower)) {
    result = result.replace(/\bhuman being(s)?\b/gi, 'skin');
    result = result.replace(/\bhumans\b/gi, 'skin');
    result = result.replace(/\bhuman\b/gi, 'skin');
  }

  // --- 2. Fix "كوري" / "كورية" → Korean (not "coral") ---
  if (/كوري|كورية|ال كورية/.test(lower)) {
    result = result.replace(/\bcoral\b/gi, 'Korean');
  }

  // --- 3. Fix "صيني" / "صينية" → Chinese (not "plate/dish") ---
  if (/صيني|صينية|ال صينية/.test(lower)) {
    result = result.replace(/\bplate\b/gi, 'Chinese');
    result = result.replace(/\bplates\b/gi, 'Chinese');
    result = result.replace(/\bdish(es)?\b/gi, 'Chinese');
  }

  // --- 4. Fix "تركي" / "تركية" → Turkish (not "bath") ---
  if (/تركي|تركية|ال تركية/.test(lower)) {
    result = result.replace(/\bbath(s)?\b/gi, 'Turkish');
  }

  // --- 5. Capitalize first letter (cosmetic) ---
  result = result.trim();
  if (result.length > 0) {
    result = result[0].toUpperCase() + result.slice(1);
  }

  result = result.replace(/\s+/g, ' ').trim();
  return result;
}



/**
 * Call Google's public (unofficial) Translate endpoint.
 * This is the same endpoint the Google Translate web app uses. It does
 * not require an API key. It is BLOCKED in mainland China without VPN.
 * 
 * NOTE: Modified to call server endpoint instead of Google Translate directly
 * to avoid CORS issues in mobile app/WebView environment.
 *
 * @param text Arabic text to translate
 * @returns the English translation, or null on failure
 */
async function googleTranslateOnline(text: string): Promise<string | null> {
  if (!text) return null;
  try {
    const url = new URL('https://translate.googleapis.com/translate_a/single');
    url.searchParams.set('client', 'gtx');
    url.searchParams.set('sl', 'ar');
    url.searchParams.set('tl', 'en');
    url.searchParams.set('dt', 't');
    url.searchParams.set('q', text);

    const headers = {
      'User-Agent': 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
    };

    let data: any;

    if (Capacitor.isNativePlatform()) {
      // Use native HTTP to bypass CORS and use the device's actual IP (avoid proxy 429s)
      const options = {
        url: url.toString(),
        headers,
      };
      const response = await CapacitorHttp.get(options);
      if (response.status !== 200) {
        console.warn('[Translation Service] Google Translate Native HTTP error:', response.status);
        return null;
      }
      data = response.data;
    } else {
      // Browser fallback (still might hit CORS, but better than a 429'd proxy for dev)
      const response = await fetch(url.toString(), {
        method: 'GET',
        headers,
      });

      if (!response.ok) {
        console.warn('[Translation Service] Google Translate Browser HTTP error:', response.status);
        return null;
      }
      data = await response.json();
    }
    if (!Array.isArray(data) || !Array.isArray(data[0])) {
      console.warn('[Translation Service] Google Translate unexpected shape');
      return null;
    }

    const translated: string = data[0]
      .map((chunk: any) => (Array.isArray(chunk) && typeof chunk[0] === 'string' ? chunk[0] : ''))
      .join('')
      .trim();

    if (!translated) return null;
    return translated;
  } catch (error) {
    console.warn('[Translation Service] Google Translate request failed:', error);
    return null;
  }
}

/**
 * Call MyMemory public API.
 * 
 * @param text Arabic text to translate
 * @returns the English translation, or null on failure
 */
async function myMemoryTranslateOnline(text: string): Promise<string | null> {
  if (!text) return null;
  try {
    const url = new URL('https://api.mymemory.translated.net/get');
    url.searchParams.set('q', text);
    url.searchParams.set('langpair', 'ar|en');

    let data: any;

    if (Capacitor.isNativePlatform()) {
      const options = {
        url: url.toString(),
      };
      const response = await CapacitorHttp.get(options);
      if (response.status !== 200) {
        console.warn('[Translation Service] MyMemory Native HTTP error:', response.status);
        return null;
      }
      data = response.data;
    } else {
      const response = await fetch(url.toString());
      if (!response.ok) {
        console.warn('[Translation Service] MyMemory Browser HTTP error:', response.status);
        return null;
      }
      data = await response.json();
    }

    if (data?.responseData?.translatedText) {
      const translated = String(data.responseData.translatedText).trim();
      if (translated && !translated.includes('MYMEMORY WARNING') && !translated.includes('YOU HAVE EXCEEDED')) {
        return translated;
      }
    }
    return null;
  } catch (error) {
    console.warn('[Translation Service] MyMemory request failed:', error);
    return null;
  }
}



/**
 * Returns true if a "translation" is actually the original Arabic text
 * returned unchanged. This is a symptom of the translator failing
 * silently and falling back to its input, which is exactly what was
 * breaking the search for "مفتاح" — the server echoes the Arabic back,
 * CLIP has no idea what to do with it, and the user gets random products.
 */
function looksLikeUntranslated(text: string): boolean {
  if (!text) return true;
  // Any character in the Arabic Unicode block means it's still Arabic.
  return /[\u0600-\u06FF]/.test(text);
}

/**
 * Curated fallback dictionary for words that the AI translator
 * routinely mishandles or fails to translate at all. We only put words
 * here that we have verified produce GOOD search results when used as
 * the CLIP text embedding. Adding a word to this list short-circuits
 * Google + the server translator entirely.
 *
 * IMPORTANT: keys must be the *preprocessed* form (post-Iraqi
 * normalization), not the raw user input.
 */
const FALLBACK_DICTIONARY: Record<string, string> = {
  'مفتاح': 'key switch',
  'مفاتيح': 'keys switches',
  'قفل': 'lock',
  'اقفال': 'locks',
  'كابل': 'cable',
  'كابلات': 'cables',
  'شاحن': 'charger',
  'شواحن': 'chargers',
  'هاتف': 'phone',
  'موبايل': 'mobile phone',
  'سماعة': 'headphones',
  'سماعات': 'headphones',
  'حذاء': 'shoes',
  'احذية': 'shoes',
  'قميص': 'shirt',
  'قمصان': 'shirts',
  'بنطلون': 'pants',
  'بناطيل': 'pants',
  'فستان': 'dress',
  'فساتين': 'dresses',
  'ساعة': 'watch',
  'ساعات': 'watches',
  'حقيبة': 'bag',
  'حقائب': 'bags',
  'نظارة': 'glasses',
  'نظارات': 'glasses',
  'مصباح': 'lamp',
  'مصابيح': 'lamps',
  'مروحة': 'fan',
  'مراوح': 'fans',
  'مكنسة': 'vacuum cleaner',
  'مكانس': 'vacuum cleaners',
  'ثلاجة': 'refrigerator',
  'غسالة': 'washing machine',
  'تلفزيون': 'television',
  'ريموت': 'remote control',
  'بطارية': 'battery',
  'بطاريات': 'batteries',
};

function lookupFallbackDictionary(preprocessedText: string): string | null {
  const trimmed = preprocessedText.trim();
  if (!trimmed) return null;
  if (FALLBACK_DICTIONARY[trimmed]) return FALLBACK_DICTIONARY[trimmed];
  return null;
}

/**
 * Translates Arabic text to English using Google Translate API.
 * Uses CORS proxy to avoid CORS issues in WebView/Android app environment.
 *
 * If Google Translate fails, returns the original Arabic text.
 *
 * Returns BOTH the translated text and the method that produced it.
 * The UI can use `result.method` to display a "Google" / "Fallback" badge.
 */
export async function translateArabicToEnglish(text: string): Promise<TranslationResult> {
  console.log('[Translation Service] ====== Starting Translation ======');
  console.log('[Translation Service] Original input:', text);

  // REMOVED: Arabic normalization and preprocessing - using raw text directly
  const preprocessedText = text.trim();
  console.log('[Translation Service] Using raw text (no normalization):', preprocessedText);

  // Check if the text is already English (no Arabic characters)
  if (!looksLikeUntranslated(preprocessedText)) {
    console.log('[Translation Service] ✓ Input is already English, skipping translation');
    const result: TranslationResult = { text: preprocessedText, method: 'google' };
    cachePut(preprocessedText, result);
    return result;
  }

  // Step 1: Curated dictionary lookup — short-circuits ALL online
  // translators and the cache. This is the safety net for words that
  // the AI model routinely mishandles (e.g. "مفتاح" was being echoed
  // back unchanged by the server's translator, which made CLIP embed
  // raw Arabic and return random products).
  const dictHit = lookupFallbackDictionary(preprocessedText);
  if (dictHit) {
    console.log(`[Translation Service] ✓ Fallback dictionary hit: "${preprocessedText}" → "${dictHit}"`);
    const result: TranslationResult = { text: dictHit, method: 'google' }; // treat as high-quality
    cachePut(preprocessedText, result);
    return result;
  }

  // Check in-memory cache first
  const cached = cacheGet(preprocessedText);
  if (cached) {
    console.log('[Translation Service] ✓ Cache hit:', cached);
    // Sanity-check: never serve a cached "translation" that is still
    // Arabic. If the cache contains a broken entry, discard it so we
    // re-attempt translation instead of silently reusing garbage.
    if (looksLikeUntranslated(cached.text)) {
      console.warn('[Translation Service] ⚠ Cached entry is still Arabic, discarding:', cached);
      translationCache.delete(preprocessedText);
    } else {
      return cached;
    }
  }

  const tryPostProcess = (raw: string): string => {
    const fixed = postprocessEnglishTranslation(raw, preprocessedText);
    if (fixed !== raw) {
      console.log('[Translation Service] Post-processor fixed:', raw, '→', fixed);
    }
    return fixed;
  };

  // Step 2: Try Google Translate ONLINE
  console.log('[Translation Service] → Trying Google Translate ONLINE...');
  try {
    const googleResult = await googleTranslateOnline(preprocessedText);
    if (googleResult && !looksLikeUntranslated(googleResult)) {
      const fixed = tryPostProcess(googleResult);
      const result: TranslationResult = { text: fixed, method: 'google' };
      console.log('[Translation Service] ✓ Google translation SUCCESS:', result);
      cachePut(preprocessedText, result);
      return result;
    } else {
      console.log('[Translation Service] ✗ Google returned empty or Arabic');
    }
  } catch (error: any) {
    console.warn('[Translation Service] ✗ Google translation FAILED:', error?.message || error);
  }

  // Step 3: Try MyMemory ONLINE (Fallback)
  console.log('[Translation Service] → Trying MyMemory ONLINE (Fallback for Ar→En)...');
  try {
    const myMemoryResult = await myMemoryTranslateOnline(preprocessedText);
    if (myMemoryResult && !looksLikeUntranslated(myMemoryResult)) {
      const fixed = tryPostProcess(myMemoryResult);
      const result: TranslationResult = { text: fixed, method: 'mymemory' };
      console.log('[Translation Service] ✓ MyMemory translation SUCCESS:', result);
      cachePut(preprocessedText, result);
      return result;
    } else {
      console.log('[Translation Service] ✗ MyMemory returned empty or Arabic');
    }
  } catch (error: any) {
    console.warn('[Translation Service] ✗ MyMemory translation FAILED:', error?.message || error);
  }

  // Step 4: All translation methods failed, return the preprocessed Arabic text
  console.log('[Translation Service] ✗ All translation methods failed, returning original text');
  const fallback: TranslationResult = { text: preprocessedText, method: 'fallback' };
  return fallback;
}

/**
 * Convenience wrapper that returns just the translated string.
 */
export async function translateText(text: string): Promise<string> {
  const r = await translateArabicToEnglish(text);
  return r.text;
}
