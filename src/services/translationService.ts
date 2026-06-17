
/**
 * Translation service for Arabic → English translation using Google ML Kit on-device
 */

import MLKitTranslate from '../plugins/mlkit-translate';
import { Capacitor } from '@capacitor/core';

/**
 * Checks if we're running in a native Capacitor environment
 */
function isNativeEnvironment(): boolean {
  return Capacitor.isNativePlatform();
}

/**
 * Downloads the ML Kit translation model if not already downloaded
 */
export async function ensureTranslationModelDownloaded(): Promise<void> {
  if (!isNativeEnvironment()) {
    console.log('[Translation Service] Not a native environment, skipping model download');
    return;
  }

  try {
    const { isDownloaded } = await MLKitTranslate.isModelDownloaded();
    if (!isDownloaded) {
      console.log('[Translation Service] Downloading translation model...');
      await MLKitTranslate.downloadModel();
      console.log('[Translation Service] Translation model downloaded successfully');
    }
  } catch (error) {
    console.error('[Translation Service] Failed to ensure model is downloaded:', error);
  }
}

/**
 * Translates Arabic text to English using Google ML Kit on-device translation
 */
export async function translateArabicToEnglish(text: string): Promise<string> {
  console.log('[Translation Service] Translating:', text);

  // If not a native environment, return the text (fallback to server translation if needed)
  if (!isNativeEnvironment()) {
    console.log('[Translation Service] Not a native environment, returning original text');
    return text;
  }

  try {
    const { translatedText } = await MLKitTranslate.translateArabicToEnglish({ text });
    console.log('[Translation Service] Translated:', translatedText);
    return translatedText;
  } catch (error) {
    console.error('[Translation Service] Translation failed:', error);
    return text; // Fallback to original text if translation fails
  }
}
