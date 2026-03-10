import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverRoot = path.resolve(__dirname, '..');

const tryLoadJson = (filePath) => {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8').trim();
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || (Array.isArray(parsed) && parsed.length === 0)) return null;
    return parsed;
  } catch {
    return null;
  }
};

const getCategorySources = () => {
  const candidates = [
    path.join(serverRoot, 'data', 'categories_translated_export.json'),
    path.join(serverRoot, 'all_categories_full.json')
  ];
  for (const filePath of candidates) {
    const parsed = tryLoadJson(filePath);
    if (parsed) return parsed;
  }
  return [];
};

const normalizeNode = (node, index, parentId) => {
  const nameEn = node?.nameEn || node?.name_en || node?.name || node?.title || '';
  const nameAr = node?.nameAr || node?.name_ar || node?.name || node?.title || '';
  const id = node?.id ?? node?.categoryId ?? `${parentId || 'root'}-${index}`;
  const children = Array.isArray(node?.children) ? node.children : (Array.isArray(node?.subcategories) ? node.subcategories : []);
  return { id: String(id), nameEn: String(nameEn), nameAr: String(nameAr), children };
};

const buildIndex = (nodes, parentPathEn = '', parentPathAr = '', parentId = 'root') => {
  const list = [];
  const map = new Map();
  const walk = (items, pathEn, pathAr, parentKey) => {
    items.forEach((raw, idx) => {
      const node = normalizeNode(raw, idx, parentKey);
      const currentPathEn = pathEn ? `${pathEn} > ${node.nameEn}` : node.nameEn;
      const currentPathAr = pathAr ? `${pathAr} > ${node.nameAr}` : node.nameAr;
      const entry = {
        id: node.id,
        nameEn: node.nameEn,
        nameAr: node.nameAr,
        pathEn: currentPathEn,
        pathAr: currentPathAr
      };
      list.push(entry);
      map.set(node.id, entry);
      if (node.children.length > 0) {
        walk(node.children, currentPathEn, currentPathAr, node.id);
      }
    });
  };
  walk(nodes, parentPathEn, parentPathAr, parentId);
  return { list, map };
};

export const buildCategoryIndex = () => {
  const source = getCategorySources();
  if (!Array.isArray(source)) return { list: [], map: new Map() };
  return buildIndex(source);
};
