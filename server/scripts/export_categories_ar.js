import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildCategoryIndex } from '../services/categoryService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { list } = buildCategoryIndex();
const payload = list.map((entry) => ({
  id: entry.id,
  nameEn: entry.nameEn,
  nameAr: entry.nameAr,
  pathEn: entry.pathEn,
  pathAr: entry.pathAr
}));

const outputPath = path.join(__dirname, '..', 'data', 'categories_translated_export.json');
fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2));
console.log(`Exported ${payload.length} categories to ${outputPath}`);
