/**
 * Translation service for Arabic → English translation
 *
 * Flow (in order of priority):
 *   1. Apply Iraqi Arabic normalization
 *   2. Try Google Translate ONLINE (uses customer's internet, highest quality)
 *   3. Fall back to ML Kit OFFLINE (bundled on-device model, no internet)
 *   4. Return the preprocessed text as a last resort
 *
 * Each successful translation returns the method used so the UI can
 * display a badge (e.g. "Google" vs "Offline / ML Kit").
 */

import MLKitTranslate from '../plugins/mlkit-translate';
import { Capacitor } from '@capacitor/core';

/** Method used to produce the translation. */
export type TranslationMethod = 'google' | 'mlkit' | 'fallback';

/** Result of a translation attempt. */
export interface TranslationResult {
  text: string;
  method: TranslationMethod;
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
    // Refresh insertion order (LRU)
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
    // Skin care / beauty
    'عنايه': 'عناية',
    'بالبشره': 'بالبشرة',
    'بشره': 'بشرة',
    'للوجه': 'للوجه',
    'للشعر': 'للشعر',
    'للجسم': 'للجمسم',
    'كريمات': 'كريمات',
    'مستحضرات': 'مستحضرات',
    'تجميليه': 'تجميليه',

    // Clothing
    'ملابس': 'ملابس',
    'فستان': 'فستان',
    'فساتين': 'فساتين',
    'بنطلون': 'بنطلون',
    'بناطيل': 'بناطيل',
    'قماش': 'قماش',

    // Electronics
    'موبايل': 'هاتف',
    'تلفون': 'هاتف',
    'تلفزيون': 'تلفزيون',
    'تلفاز': 'تلفزيون',
    'كومبيوتر': 'كمبيوتر',
    'لابتوب': 'كمبيوتر محمول',

    // Home
    'بيت': 'منزل',
    'بيتي': 'منزلي',
    'اكل': 'طعام',
    'مو': 'ماء',
    'مي': 'ماء',

    // Common words
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

  // Apply replacements (case-insensitive)
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
 * Pre-process Arabic text before sending to any translation backend.
 *
 * This is NOT a dictionary. It is a small set of word-level substitutions
 * for Arabic words that translation models consistently mistranslate. We
 * swap them for a clearer Arabic synonym so the model produces the
 * intended English word.
 */
function preprocessArabicForTranslation(text: string): string {
  let result = text;

  // "بشرة" / "بشره" is consistently mistranslated as "human being(s)".
  // "جلد" unambiguously means "skin" (body part) in Arabic and translates
  // correctly in every model. Swap it whenever the word appears.
  result = result.replace(/بشره|بشرة/g, 'جلد');

  // "كوريه" / "كورية" can be misread as "coral" by ML Kit.
  // "كوري" alone (without the taa marbouta) is unambiguous and translates
  // correctly to "Korean". Swap to the bare form before translating.
  result = result.replace(/الكوريه|كوريه|كورية/g, (m) => {
    return m.startsWith('ال') ? 'الكوري' : 'كوري';
  });

  // "صينيه" / "صينية" can be misread as "plate/dish".
  // "صيني" alone translates cleanly to "Chinese".
  result = result.replace(/الصينيه|صينيه|صينية/g, (m) => {
    return m.startsWith('ال') ? 'الصيني' : 'صيني';
  });

  // "تركيه" / "تركية" can be misread as "Turkish bath" or similar.
  result = result.replace(/التركيه|تركيه|تركية/g, (m) => {
    return m.startsWith('ال') ? 'التركي' : 'تركي';
  });

  // Collapse extra whitespace
  result = result.replace(/\s+/g, ' ').trim();

  return result;
}

/**
 * Post-process the English translation.
 *
 * Even with a good prompt and pre-processing, the translation backend
 * may still return the wrong English word. This function does a final
 * safety pass to fix the most common known-wrong outputs, regardless of
 * where the word appears in the sentence.
 *
 * Each fix is conditional on the ORIGINAL ARABIC input having contained
 * the corresponding Arabic keyword, so we never wrongly replace an
 * English word the user actually wanted.
 */
function postprocessEnglishTranslation(
  english: string,
  originalArabic: string
): string {
  let result = english;
  const lower = originalArabic;

  // --- 1. Fix "بشرة" → skin (not "human being(s)") ---
  if (/بشره|بشرة/.test(lower)) {
    result = result.replace(/\bhuman being(s)?\b/gi, 'skin');
    result = result.replace(/\bhumans\b/gi, 'skin');
    result = result.replace(/\bhuman\b/gi, 'skin');
  }

  // --- 2. Fix "كوري" / "كورية" → Korean (not "coral") ---
  if (/كوري|كوريه|كورية|الكوريه/.test(lower)) {
    result = result.replace(/\bcoral\b/gi, 'Korean');
    result = result.replace(/\bkorean\b/g, (match, _p1, offset) => {
      const prev = result[offset - 1];
      if (!prev || prev === ' ' || prev === '.' || prev === ',' || prev === '!' || prev === '?') {
        return 'Korean';
      }
      return match;
    });
  }

  // --- 3. Fix "صيني" → Chinese (not "plate/dish") ---
  if (/صيني|صينيه|صينية|الصينيه/.test(lower)) {
    result = result.replace(/\bplate\b/gi, 'Chinese');
    result = result.replace(/\bplates\b/gi, 'Chinese');
    result = result.replace(/\bdish(es)?\b/gi, 'Chinese');
  }

  // --- 4. Fix "تركي" → Turkish (not "bath") ---
  if (/تركي|تركيه|تركية|التركيه/.test(lower)) {
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
 * Checks if we're running in a native Capacitor environment
 */
function isNativeEnvironment(): boolean {
  return Capacitor.isNativePlatform();
}

/**
 * Returns true if the device is likely online.
 * We do a quick `navigator.onLine` check; the actual fetch will
 * confirm by trying.
 */
function isLikelyOnline(): boolean {
  if (typeof navigator !== 'undefined' && 'onLine' in navigator) {
    return (navigator as any).onLine !== false;
  }
  return true;
}

/**
 * Call Google's public (unofficial) Translate endpoint.
 *
 * This is the same endpoint the Google Translate web app uses. It does
 * not require an API key and is paid for by the user's own device /
 * internet. We do not proxy it through our server.
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

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        // Mimic a real browser request — Google's endpoint rejects
        // most non-browser user agents.
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
      },
    });

    if (!response.ok) {
      console.warn('[Translation Service] Google Translate HTTP error:', response.status);
      return null;
    }

    // Response shape: [[["translated", "original", null, null, 1]], null, "ar", null, null, ...]
    const data = await response.json();
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
 * Downloads the ML Kit translation model if not already downloaded
 */
export async function ensureTranslationModelDownloaded(): Promise<void> {
  if (!isNativeEnvironment()) return;

  try {
    await MLKitTranslate.downloadModel();
    console.log('[Translation Service] ML Kit model ready');
  } catch (error) {
    console.error('[Translation Service] Failed to ensure ML Kit model:', error);
  }
}

/**
 * Translates Arabic text to English.
 *
 * Priority:
 *   1. Google Translate ONLINE (uses customer's internet, best quality)
 *   2. ML Kit OFFLINE (on-device, no internet)
 *   3. Fallback: return the preprocessed Arabic text
 *
 * Returns BOTH the translated text and the method that produced it.
 * The UI can use `result.method` to display a "Google" / "Offline" badge.
 */
export async function translateArabicToEnglish(text: string): Promise<TranslationResult> {
  console.log('[Translation Service] ====== Starting Translation ======');
  console.log('[Translation Service] Original input:', text);

  // Step 1: Apply Iraqi Arabic normalization
  const normalizedText = normalizeIraqiArabic(text);
  console.log('[Translation Service] After normalization:', normalizedText);

  // Step 1b: Pre-process Arabic to avoid known mistranslations
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

  // Step 2: Try Google Translate ONLINE (PRIMARY when online)
  if (isLikelyOnline()) {
    console.log('[Translation Service] → Trying Google Translate ONLINE (PRIMARY)...');
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
  } else {
    console.log('[Translation Service] Device appears offline, skipping Google');
  }

  // Step 3: Try ML Kit OFFLINE (FALLBACK)
  if (isNativeEnvironment()) {
    console.log('[Translation Service] → Trying ML Kit OFFLINE (FALLBACK)...');
    try {
      await ensureTranslationModelDownloaded();
      const { translatedText } = await MLKitTranslate.translateArabicToEnglish({ text: preprocessedText });
      console.log('[Translation Service] ML Kit raw response:', translatedText);

      const safe = translatedText && translatedText.trim() ? translatedText : '';
      if (safe && safe !== preprocessedText) {
        const fixed = tryPostProcess(safe);
        const result: TranslationResult = { text: fixed, method: 'mlkit' };
        console.log('[Translation Service] ✓ ML Kit translation SUCCESS:', result);
        cachePut(preprocessedText, result);
        return result;
      } else {
        console.log('[Translation Service] ✗ ML Kit returned empty or same text');
      }
    } catch (error: any) {
      console.error('[Translation Service] ✗ ML Kit translation FAILED:', error);
    }
  } else {
    console.log('[Translation Service] Not a native environment, skipping ML Kit');
  }

  // Step 4: All methods failed, return the preprocessed Arabic text
  console.log('[Translation Service] ✗ All translation methods failed, returning preprocessed text');
  const fallback: TranslationResult = { text: preprocessedText, method: 'fallback' };
  return fallback;
}

/**
 * Convenience wrapper that returns just the translated string.
 * Kept for backwards compatibility with any callers that don't
 * need the method.
 */
export async function translateText(text: string): Promise<string> {
  const r = await translateArabicToEnglish(text);
  return r.text;
}
