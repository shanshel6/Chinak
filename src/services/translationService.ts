/**
 * Translation service for Arabic → English translation
 *
 * Uses ONLY Google Translate ONLINE - no offline fallback
 *
 * This is the same endpoint the Google Translate web app uses. It does
 * not require an API key and is paid for by the user's own device /
 * internet. We do not proxy it through our server.
 */

import { Capacitor } from '@capacitor/core';
import { CapacitorHttp } from '@capacitor/core';

/** Result of a translation attempt. */
export interface TranslationResult {
  text: string;
  method: 'google' | 'fallback';
}

/**
 * In-memory LRU-ish cache so we don't hammer Google with the same
 * query twice in a session. Persists for the lifetime of the tab.
 */
const TRANSLATION_CACHE_MAX = 200;
const translationCache = new Map<string, TranslationResult>();

function cacheGet(key: string): TranslationResult | undefined {
  const v = translationCache.get(key);
  if (v) {
    translationCache.delete(key);
    translationCache.set(key, v);
  }
  return v;
}

function cachePut(key: string, value: TranslationResult): void {
  if (translationCache.has(key)) translationCache.delete(key);
  translationCache.set(key, value);
  if (translationCache.size > TRANSLATION_CACHE_MAX) {
    const firstKey = translationCache.keys().next().value;
    if (firstKey !== undefined) translationCache.delete(firstKey);
  }
}

/**
 * Iraqi Arabic normalization
 * Converts Iraqi dialect words and variations to standard Arabic
 */
function normalizeIraqiArabic(text: string): string {
  let normalized = text.trim();

  // Common Iraqi dialect → Standard Arabic mappings
  const iraqiReplacements: Record<string, string> = {
    'عنايه': 'عناية',
    'بالبشره': 'بالبشرة',
    'بشره': 'بشرة',
    'للوجه': 'للوجه',
    'للشعر': 'للشعر',
    'للجسم': 'للجمسم',
    'كريمات': 'كريمات',
    'مستحضرات': 'مستحضرات',
    'تجميليه': 'تجميليه',
    'ملابس': 'ملابس',
    'فستان': 'فستان',
    'فساتين': 'فساتين',
    'بنطلون': 'بنطلون',
    'بناطيل': 'بناطيل',
    'قماش': 'قماش',
    'موبايل': 'هاتف',
    'تلفون': 'هاتف',
    'تلفزيون': 'تلفزيون',
    'تلفاز': 'تلفزيون',
    'كومبيوتر': 'كمبيوتر',
    'لابتوب': 'كمبيوتر محمول',
    'بيت': 'منزل',
    'بيتي': 'منزلي',
    'اكل': 'طعام',
    'مو': 'ماء',
    'مي': 'ماء',
    'كويس': 'جيد',
    'زين': 'جيد',
    'هواي': 'كثير',
    'شوية': 'قليل',
    'دز': 'أرسل',
    'اكو': 'يوجد',
    'ماكو': 'لا يوجد',
    'هسه': 'الآن',
    'هاي': 'هذه',
    'هذا': 'هذا',
    'هاذ': 'هذا',
    'هاذي': 'هذه',
    'اريد': 'أريد',
    'ابي': 'أريد',
    'ابغى': 'أريد',
    'اشتري': 'أشتري',
    'اشتريت': 'اشتريت',
  };

  const lowerText = normalized.toLowerCase();
  for (const [iraqi, standard] of Object.entries(iraqiReplacements)) {
    if (lowerText.includes(iraqi.toLowerCase())) {
      const regex = new RegExp(iraqi, 'gi');
      normalized = normalized.replace(regex, standard);
    }
  }

  // Remove diacritics (tashkeel)
  normalized = normalized.replace(/[\u064B-\u0652]/g, '');

  // Normalize alef variations (أ إ آ → ا)
  normalized = normalized.replace(/[أإآٱ]/g, 'ا');

  // Normalize yaa variations (ى → ي)
  normalized = normalized.replace(/[ى]/g, 'ي');

  // Normalize taa marbouta (ة → ه)
  normalized = normalized.replace(/[ة]/g, 'ه');

  // Remove extra spaces
  normalized = normalized.replace(/\s+/g, ' ').trim();

  console.log('[Translation Service] Iraqi normalization:', text, '→', normalized);
  return normalized;
}

/**
 * Pre-process Arabic text before sending to translation backend.
 */
function preprocessArabicForTranslation(text: string): string {
  let result = text;

  // "بشرة" / "بشره" is consistently mistranslated as "human being(s)".
  result = result.replace(/بشره|بشرة/g, 'جلد');

  // "كوريه" / "كورية" can be misread as "coral" by translation models.
  result = result.replace(/الكوريه|كوريه|كورية/g, (m) => {
    return m.startsWith('ال') ? 'الكوري' : 'كوري';
  });

  // "صينيه" / "صينية" can be misread as "plate/dish".
  result = result.replace(/الصينيه|صينيه|صينية/g, (m) => {
    return m.startsWith('ال') ? 'الصيني' : 'صيني';
  });

  // "تركيه" / "تركية" can be misread as "Turkish bath"
  result = result.replace(/التركيه|تركيه|تركية/g, (m) => {
    return m.startsWith('ال') ? 'التركي' : 'تركي';
  });

  // Collapse extra whitespace
  result = result.replace(/\s+/g, ' ').trim();

  return result;
}

/**
 * Post-process the English translation.
 */
function postprocessEnglishTranslation(
  english: string,
  originalArabic: string
): string {
  let result = english;
  const lower = originalArabic;

  // Fix "بشرة" → skin
  if (/بشره|بشرة/.test(lower)) {
    result = result.replace(/\bhuman being(s)?\b/gi, 'skin');
    result = result.replace(/\bhumans\b/gi, 'skin');
    result = result.replace(/\bhuman\b/gi, 'skin');
  }

  // Fix "كوري" → Korean
  if (/كوري|كوريه|كورية|الكوريه/.test(lower)) {
    result = result.replace(/\bcoral\b/gi, 'Korean');
  }

  // Fix "صيني" → Chinese
  if (/صيني|صينيه|صينية|الصينيه/.test(lower)) {
    result = result.replace(/\bplate\b/gi, 'Chinese');
    result = result.replace(/\bplates\b/gi, 'Chinese');
    result = result.replace(/\bdish(es)?\b/gi, 'Chinese');
  }

  // Fix "تركي" → Turkish
  if (/تركي|تركيه|تركية|التركيه/.test(lower)) {
    result = result.replace(/\bbath(s)?\b/gi, 'Turkish');
  }

  // Capitalize first letter
  result = result.trim();
  if (result.length > 0) {
    result = result[0].toUpperCase() + result.slice(1);
  }

  result = result.replace(/\s+/g, ' ').trim();
  return result;
}

/**
 * Call Google's public Translate endpoint.
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

    console.log('[Translation Service] Google Translate URL:', url.toString().substring(0, 100) + '...');

    let translated: string;

    // On native (iOS/Android), use CapacitorHttp to bypass WKWebView CORS restrictions
    if (Capacitor.isNativePlatform()) {
      console.log('[Translation Service] Using CapacitorHttp for native platform');
      const nativeResponse = await CapacitorHttp.get({
        url: url.toString(),
        headers: {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': 'https://translate.google.com/',
        },
      });

      console.log('[Translation Service] CapacitorHttp status:', nativeResponse.status);

      if (nativeResponse.status !== 200) {
        console.warn('[Translation Service] Google Translate HTTP error:', nativeResponse.status);
        return null;
      }

      const data = typeof nativeResponse.data === 'string' ? JSON.parse(nativeResponse.data) : nativeResponse.data;
      if (!Array.isArray(data) || !Array.isArray(data[0])) {
        console.warn('[Translation Service] Google Translate unexpected shape');
        return null;
      }

      translated = data[0]
        .map((chunk: any) => (Array.isArray(chunk) && typeof chunk[0] === 'string' ? chunk[0] : ''))
        .join('')
        .trim();
    } else {
      // Web fallback
      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': 'https://translate.google.com/',
        },
      });

      console.log('[Translation Service] Google Translate status:', response.status);

      if (!response.ok) {
        console.warn('[Translation Service] Google Translate HTTP error:', response.status);
        return null;
      }

      const data = await response.json();
      if (!Array.isArray(data) || !Array.isArray(data[0])) {
        console.warn('[Translation Service] Google Translate unexpected shape');
        return null;
      }

      translated = data[0]
        .map((chunk: any) => (Array.isArray(chunk) && typeof chunk[0] === 'string' ? chunk[0] : ''))
        .join('')
        .trim();
    }

    console.log('[Translation Service] Google Translate result:', translated);

    if (!translated) return null;
    return translated;
  } catch (error: any) {
    console.error('[Translation Service] Google Translate failed:', error?.message || error);
    return null;
  }
}

/**
 * Translates Arabic text to English using Google Translate ONLY.
 * No offline fallback - requires internet connection.
 */
export async function translateArabicToEnglish(text: string): Promise<TranslationResult> {
  console.log('[Translation Service] ====== Starting Translation ======');
  console.log('[Translation Service] Original input:', text);

  // Step 1: Apply Iraqi Arabic normalization
  const normalizedText = normalizeIraqiArabic(text);
  console.log('[Translation Service] After normalization:', normalizedText);

  // Step 2: Pre-process Arabic to avoid known mistranslations
  const preprocessedText = preprocessArabicForTranslation(normalizedText);
  console.log('[Translation Service] After pre-processing:', preprocessedText);

  // Check in-memory cache first
  const cached = cacheGet(preprocessedText);
  if (cached) {
    console.log('[Translation Service] ✓ Cache hit:', cached);
    return cached;
  }

  const tryPostProcess = (raw: string): string => {
    const fixed = postprocessEnglishTranslation(raw, normalizedText);
    if (fixed !== raw) {
      console.log('[Translation Service] Post-processor fixed:', raw, '→', fixed);
    }
    return fixed;
  };

  // Step 3: Try Google Translate ONLINE
  console.log('[Translation Service] → Trying Google Translate ONLINE...');
  try {
    const googleResult = await googleTranslateOnline(preprocessedText);
    if (googleResult && googleResult !== preprocessedText) {
      const fixed = tryPostProcess(googleResult);
      const result: TranslationResult = { text: fixed, method: 'google' };
      console.log('[Translation Service] ✓ Google translation SUCCESS:', result);
      cachePut(preprocessedText, result);
      return result;
    } else {
      console.log('[Translation Service] ✗ Google returned empty or same text');
    }
  } catch (error: any) {
    console.warn('[Translation Service] ✗ Google translation FAILED:', error?.message || error);
  }

  // Step 4: All methods failed, return the preprocessed Arabic text
  console.log('[Translation Service] ✗ Translation failed, returning preprocessed text');
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
