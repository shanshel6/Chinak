
import { translateArabicToEnglish } from './services/aiService.js';

console.log('Testing forced translation...');
const testQueries = [
  'بدلة سباحة حمراء',
  'حذاء رياضي',
  'هاتف محمول'
];

for (const query of testQueries) {
  const translated = await translateArabicToEnglish(query);
  console.log(`Original: ${query} → Translated: ${translated}`);
}
