import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { normalizeCategoryText } from '../services/categoryCanonicalService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const proposalPath = path.join(__dirname, '.assign-canonical-categories.proposals.json');
const seedPath = path.join(__dirname, 'canonical-categories.seed.json');

const hasFlag = (name) => process.argv.includes(name);
const dryRun = hasFlag('--dry-run');

const readJsonFile = (filePath, fallback) => {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed;
  } catch {
    return fallback;
  }
};

const writeJsonFile = (filePath, value) => {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
};

const dedupeStrings = (values) => Array.from(new Set(
  (Array.isArray(values) ? values : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean)
));

const normalizeProposalSlug = (value) => String(value || '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '')
  .replace(/_{2,}/g, '_')
  .trim();

const walkCategories = (nodes, callback) => {
  if (!Array.isArray(nodes)) return;
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue;
    callback(node);
    walkCategories(Array.isArray(node.children) ? node.children : [], callback);
  }
};

const buildExistingLookup = (seed) => {
  const slugSet = new Set();
  const aliasMap = new Map();
  walkCategories(seed, (node) => {
    if (!node.slug) return;
    slugSet.add(String(node.slug));
    const candidates = [node.slug, node.name_ar, ...(Array.isArray(node.aliases) ? node.aliases : [])];
    for (const candidate of candidates) {
      const normalized = normalizeCategoryText(candidate);
      if (!normalized) continue;
      aliasMap.set(normalized, String(node.slug));
      aliasMap.set(normalized.replace(/\s+/g, ''), String(node.slug));
    }
  });
  return { slugSet, aliasMap };
};

const findNodeBySlug = (nodes, slug) => {
  if (!Array.isArray(nodes)) return null;
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue;
    if (String(node.slug) === String(slug)) return node;
    const nested = findNodeBySlug(Array.isArray(node.children) ? node.children : [], slug);
    if (nested) return nested;
  }
  return null;
};

const main = () => {
  const proposals = readJsonFile(proposalPath, []);
  const seed = readJsonFile(seedPath, []);

  if (!Array.isArray(proposals)) {
    throw new Error(`Invalid proposals file: ${proposalPath}`);
  }
  if (!Array.isArray(seed)) {
    throw new Error(`Invalid seed file: ${seedPath}`);
  }

  const lookup = buildExistingLookup(seed);
  let mergedCount = 0;
  let skippedCount = 0;

  for (const proposal of proposals) {
    if (!proposal || typeof proposal !== 'object') continue;
    if (String(proposal.status || '').toLowerCase() !== 'approved') continue;

    const proposedSlug = normalizeProposalSlug(proposal.proposedSlug || proposal.slug);
    const nameAr = String(proposal.name_ar || '').trim();
    const parentSlug = String(proposal.parentSlug || '').trim();
    const aliases = dedupeStrings([nameAr, proposedSlug, ...(Array.isArray(proposal.aliases) ? proposal.aliases : [])]).slice(0, 20);

    if (!proposedSlug || !nameAr || !parentSlug) {
      proposal.status = 'invalid';
      proposal.mergeError = 'Missing proposedSlug, name_ar, or parentSlug';
      skippedCount += 1;
      continue;
    }

    const normalizedCandidates = [proposedSlug, nameAr, ...aliases]
      .map((value) => normalizeCategoryText(value))
      .filter(Boolean);
    const existingMatch = normalizedCandidates
      .map((value) => lookup.aliasMap.get(value) || lookup.aliasMap.get(value.replace(/\s+/g, '')))
      .find(Boolean);

    if (lookup.slugSet.has(proposedSlug) || existingMatch) {
      proposal.status = 'merged_existing';
      proposal.mergedSlug = existingMatch || proposedSlug;
      proposal.mergedAt = new Date().toISOString();
      proposal.mergeError = '';
      skippedCount += 1;
      continue;
    }

    const parentNode = findNodeBySlug(seed, parentSlug);
    if (!parentNode) {
      proposal.status = 'invalid_parent';
      proposal.mergeError = `Parent slug not found: ${parentSlug}`;
      skippedCount += 1;
      continue;
    }

    const nextNode = {
      slug: proposedSlug,
      name_ar: nameAr,
      aliases
    };

    if (!dryRun) {
      if (!Array.isArray(parentNode.children)) parentNode.children = [];
      parentNode.children.push(nextNode);
    }

    proposal.status = dryRun ? 'approved' : 'merged';
    proposal.mergedSlug = proposedSlug;
    proposal.mergedAt = new Date().toISOString();
    proposal.mergeError = '';
    mergedCount += 1;

    lookup.slugSet.add(proposedSlug);
    for (const candidate of [proposedSlug, nameAr, ...aliases]) {
      const normalized = normalizeCategoryText(candidate);
      if (!normalized) continue;
      lookup.aliasMap.set(normalized, proposedSlug);
      lookup.aliasMap.set(normalized.replace(/\s+/g, ''), proposedSlug);
    }
  }

  if (!dryRun) {
    writeJsonFile(seedPath, seed);
  }
  writeJsonFile(proposalPath, proposals);

  console.log(`[merge-category-proposals] dryRun=${dryRun ? 'yes' : 'no'} merged=${mergedCount} skipped=${skippedCount} proposalFile=${proposalPath}`);
  if (!dryRun) {
    console.log(`[merge-category-proposals] updated seed=${seedPath}`);
  }
};

main();
