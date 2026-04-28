import { canonicalCategories } from './server/services/categoryCanonicalService.js';

for (const cat of canonicalCategories) {
  if (cat.slug === 'other') continue;
  const englishAlias = (cat.aliases || []).find(a => /^[a-zA-Z\s-]+$/.test(a));
  const promptSubject = englishAlias || cat.slug.replace(/_/g, ' ');
  const text = `a photo of ${promptSubject}`;
  console.log(`${cat.slug.padEnd(30)} -> ${text}`);
}
