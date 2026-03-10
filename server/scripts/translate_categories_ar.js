import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env') });

process.on('unhandledRejection', (reason) => {
  console.error('unhandled_rejection', reason);
});

const deepInfraKey = String(process.env.DEEPINFRA_API_KEY || '').trim();
const deepInfraUrl = String(process.env.DEEPINFRA_TRANSLATION_API_URL || process.env.DEEPINFRA_CATEGORY_TRANSLATION_API_URL || process.env.DEEPINFRA_API_URL || 'https://api.deepinfra.com/v1/openai/chat/completions').trim();
const deepInfraModel = String(process.env.DEEPINFRA_TRANSLATION_MODEL || process.env.DEEPINFRA_CATEGORY_MODEL || process.env.DEEPINFRA_MODEL || 'deepseek-ai/DeepSeek-V3').trim();

if (!deepInfraKey) {
  throw new Error('DEEPINFRA_API_KEY missing');
}

const readJsonFile = (filePath) => {
  if (!fs.existsSync(filePath)) return null;
  const raw = String(fs.readFileSync(filePath, 'utf8') || '').trim();
  if (!raw) return null;
  return JSON.parse(raw);
};

const writeJsonFile = (filePath, data) => {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
};

const examplePath = path.join(__dirname, '..', '..', 'example.txt');
const exampleData = readJsonFile(examplePath);
const roots = exampleData?.Result?.Roots || [];

const translationsPath = path.join(__dirname, '..', 'data', 'category_translations_ar.json');
const existingTranslations = readJsonFile(translationsPath) || {};

const hasArabic = (value) => /[\u0600-\u06FF]/.test(String(value || ''));
const normalizeTranslation = (value) => String(value || '').trim();
const isValidArabicTranslation = (original, translated) => {
  if (hasArabic(original)) return true;
  return hasArabic(translated);
};

Object.keys(existingTranslations).forEach((name) => {
  const translated = existingTranslations[name];
  if (!hasArabic(name) && !hasArabic(translated)) {
    delete existingTranslations[name];
  }
});

const fallbackMap = {
  clothing: 'ملابس',
  apparel: 'ملابس',
  shoes: 'أحذية',
  shoe: 'حذاء',
  bags: 'شنط',
  bag: 'شنطة',
  accessories: 'اكسسوارات',
  accessory: 'اكسسوار',
  electronics: 'إلكترونيات',
  phone: 'هاتف',
  phones: 'هواتف',
  mobile: 'موبايل',
  computer: 'كمبيوتر',
  computers: 'كمبيوترات',
  laptop: 'لابتوب',
  tablets: 'أجهزة لوحية',
  tablet: 'جهاز لوحي',
  home: 'منزل',
  kitchen: 'مطبخ',
  furniture: 'أثاث',
  decor: 'ديكور',
  beauty: 'تجميل',
  health: 'صحة',
  sport: 'رياضة',
  sports: 'رياضة',
  baby: 'أطفال',
  children: 'أطفال',
  kids: 'أطفال',
  infant: 'رضع',
  toy: 'ألعاب',
  toys: 'ألعاب',
  car: 'سيارات',
  automotive: 'سيارات',
  tools: 'أدوات',
  tool: 'أداة',
  pet: 'حيوانات أليفة',
  pets: 'حيوانات أليفة',
  men: 'رجالي',
  women: 'نسائي',
  "women's": 'نسائي',
  "men's": 'رجالي',
  girls: 'بنات',
  boys: 'أولاد',
  underwear: 'ملابس داخلية',
  jeans: 'جينز',
  dress: 'فستان',
  dresses: 'فساتين',
  watch: 'ساعة',
  watches: 'ساعات',
  jewelry: 'مجوهرات',
  camera: 'كاميرا',
  cameras: 'كاميرات',
  lighting: 'إضاءة',
  makeup: 'مكياج',
  perfume: 'عطور',
  perfumes: 'عطور',
  fragrance: 'عطور',
  bicycles: 'دراجات',
  bicycle: 'دراجة',
  outdoor: 'خارجي',
  camping: 'تخييم'
};

const fallbackTranslate = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return raw;
  const tokens = raw.split(/([^A-Za-z0-9]+)/);
  const mapped = tokens.map((token) => {
    const key = token.toLowerCase();
    return fallbackMap[key] || token;
  }).join('');
  if (hasArabic(mapped)) return mapped;
  return `قسم ${mapped}`;
};

const collectNames = (nodes, list = []) => {
  if (!Array.isArray(nodes)) return list;
  nodes.forEach((node) => {
    const name = String(node?.Name || '').trim();
    if (name) list.push(name);
    if (node?.Children) collectNames(node.Children, list);
  });
  return list;
};

const uniqueNames = Array.from(new Set(collectNames(roots)));
uniqueNames.forEach((name) => {
  if (!existingTranslations[name] && hasArabic(name)) {
    existingTranslations[name] = name;
  }
});
let pendingNames = uniqueNames.filter((name) => {
  const current = existingTranslations[name];
  if (!current) return !hasArabic(name);
  return !isValidArabicTranslation(name, current);
});
const limit = Number.parseInt(String(process.env.CATEGORY_TRANSLATION_LIMIT || '0'), 10);
if (Number.isFinite(limit) && limit > 0) {
  pendingNames = pendingNames.slice(0, limit);
}
console.log(`pending=${pendingNames.length}`);

const parseJsonArray = (content) => {
  if (!content) return null;
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.translations)) return parsed.translations;
  } catch (_e) {}
  const match = String(content).match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (match) {
    try {
      const parsed = JSON.parse(match[1]);
      if (Array.isArray(parsed)) return parsed;
      if (parsed && Array.isArray(parsed.translations)) return parsed.translations;
    } catch (_e) {}
  }
  return null;
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const translateBatch = async (names, attempt = 0) => {
  const strict = attempt > 0;
  const systemPrompt = strict
    ? 'Translate each category name from English into natural Arabic for Iraqi users. Return ONLY a JSON array of strings in the same order. All outputs MUST contain Arabic letters. Never return the input unchanged. If a term is brand/technical, keep it in English but add Arabic context so Arabic letters appear. If unsure, transliterate into Arabic letters. Examples: "Clothing" -> "ملابس", "Children shoes" -> "أحذية أطفال", "Phone accessories" -> "اكسسوارات الهاتف". Do not add extra text.'
    : 'Translate each category name from English into natural Arabic for Iraqi users. Return ONLY a JSON array of strings in the same order. Outputs must contain Arabic letters. Never return the input unchanged. Keep brand names and units in English but add Arabic context so Arabic letters appear. Examples: "Clothing" -> "ملابس", "Children shoes" -> "أحذية أطفال", "Phone accessories" -> "اكسسوارات الهاتف". Do not add extra text.';
  const userPrompt = JSON.stringify(names);
  const response = await axios.post(
    deepInfraUrl,
    {
      model: deepInfraModel,
      temperature: strict ? 0.0 : 0.2,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]
    },
    {
      headers: {
        Authorization: `Bearer ${deepInfraKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    }
  );
  const content = response?.data?.choices?.[0]?.message?.content || '';
  const parsed = parseJsonArray(content);
  if (!Array.isArray(parsed) || parsed.length !== names.length) {
    throw new Error('Invalid translation response');
  }
  return parsed.map((entry) => normalizeTranslation(entry));
};

const translateBatchWithRetry = async (names) => {
  let attempt = 0;
  while (attempt < 3) {
    try {
      console.log(`translate_attempt=${attempt + 1} count=${names.length}`);
      return await translateBatch(names, attempt);
    } catch (error) {
      const message = String(error?.message || error || '');
      console.warn(`translate_batch_failed attempt=${attempt + 1} count=${names.length} message=${message}`);
      await delay(1500 * (attempt + 1));
      attempt += 1;
    }
  }
  return null;
};

const batchSize = 20;
for (let i = 0; i < pendingNames.length; i += batchSize) {
  let batch = pendingNames.slice(i, i + batchSize);
  console.log(`batch=${Math.floor(i / batchSize) + 1}/${Math.ceil(pendingNames.length / batchSize)} size=${batch.length}`);
  let attempt = 0;
  while (batch.length > 0 && attempt < 3) {
    const translated = await translateBatchWithRetry(batch);
    console.log(`translate_result count=${translated ? translated.length : 0}`);
    if (!translated) {
      break;
    }
    if (i === 0 && attempt === 0) {
      const preview = batch.slice(0, 5).map((name, idx) => ({ name, translated: translated[idx] }));
      console.log(`preview=${JSON.stringify(preview)}`);
    }
    const retry = [];
    batch.forEach((name, idx) => {
      const value = translated[idx] || name;
      if (isValidArabicTranslation(name, value)) {
        existingTranslations[name] = value;
      } else {
        retry.push(name);
      }
    });
    batch = retry;
    attempt += 1;
  }
  if (batch.length > 0) {
    batch.forEach((name) => {
      const fallbackValue = fallbackTranslate(name);
      if (isValidArabicTranslation(name, fallbackValue)) {
        existingTranslations[name] = fallbackValue;
      }
    });
  }
  writeJsonFile(translationsPath, existingTranslations);
}

const finalizeNames = uniqueNames.filter((name) => {
  const current = existingTranslations[name];
  if (!current) return !hasArabic(name);
  return !isValidArabicTranslation(name, current);
});
finalizeNames.forEach((name) => {
  const fallbackValue = fallbackTranslate(name);
  if (isValidArabicTranslation(name, fallbackValue)) {
    existingTranslations[name] = fallbackValue;
  }
});

writeJsonFile(translationsPath, existingTranslations);

const applyTranslations = (nodes) => {
  if (!Array.isArray(nodes)) return nodes;
  return nodes.map((node) => {
    const name = String(node?.Name || '').trim();
    const nameAr = existingTranslations[name] || name;
    const children = node?.Children ? applyTranslations(node.Children) : undefined;
    const nextNode = {
      ...node,
      NameAr: nameAr
    };
    if (children) nextNode.Children = children;
    return nextNode;
  });
};

const output = {
  ...exampleData,
  Result: {
    ...exampleData.Result,
    Roots: applyTranslations(roots)
  }
};

const outputPath = path.join(__dirname, '..', 'data', 'categories_ar.json');
writeJsonFile(outputPath, output);
console.log(`Translated ${Object.keys(existingTranslations).length} names`);
console.log(`Wrote ${outputPath}`);
