
import { registerPlugin } from '@capacitor/core';

export interface MLKitTranslatePlugin {
  /**
   * Translates text from Arabic to English
   * @param options The text to translate
   * @returns The translated text
   */
  translateArabicToEnglish(options: { text: string }): Promise<{ translatedText: string }>;

  /**
   * Checks if the translation model is downloaded
   * @returns true if the model is downloaded
   */
  isModelDownloaded(): Promise<{ isDownloaded: boolean }>;

  /**
   * Downloads the Arabic→English translation model
   */
  downloadModel(): Promise<void>;
}

const MLKitTranslate = registerPlugin<MLKitTranslatePlugin>('MLKitTranslate');

export default MLKitTranslate;
