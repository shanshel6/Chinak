import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const seedPath = path.join(__dirname, '..', 'scripts', 'canonical-categories.seed.json');

const normalizeCategoryText = (value) => String(value || '')
  .toLowerCase()
  .replace(/[أإآ]/g, 'ا')
  .replace(/ٱ/g, 'ا')
  .replace(/ء/g, '')
  .replace(/ؤ/g, 'و')
  .replace(/ئ/g, 'ي')
  .replace(/ة/g, 'ه')
  .replace(/ى/g, 'ي')
  .replace(/[\u064B-\u0652]/g, '')
  .replace(/ـ/g, '')
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const loadCanonicalCategories = () => {
  const raw = fs.readFileSync(seedPath, 'utf8');
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [];
};

const buildAliasLookup = (categories) => {
  const map = new Map();
  for (const category of categories) {
    if (!category || !category.slug) continue;
    const candidates = [category.name_ar, ...(Array.isArray(category.aliases) ? category.aliases : [])];
    for (const candidate of candidates) {
      const normalized = normalizeCategoryText(candidate);
      if (!normalized) continue;
      if (!map.has(normalized)) {
        map.set(normalized, category.slug);
      }
      map.set(normalized.replace(/\s+/g, ''), category.slug);
    }
  }
  return map;
};

const canonicalCategories = loadCanonicalCategories();
const aliasLookup = buildAliasLookup(canonicalCategories);

const mapToCanonicalCategory = (input) => {
  const normalized = normalizeCategoryText(input);
  if (!normalized) return null;
  return aliasLookup.get(normalized) || aliasLookup.get(normalized.replace(/\s+/g, '')) || null;
};

export {
  canonicalCategories,
  normalizeCategoryText,
  mapToCanonicalCategory
};
