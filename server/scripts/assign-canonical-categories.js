import prisma from '../prismaClient.js';
import { canonicalCategories, mapToCanonicalCategory, normalizeCategoryText } from '../services/categoryCanonicalService.js';
import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';
import readline from 'readline/promises';
import { fileURLToPath } from 'url';

const categoryBySlug = new Map(canonicalCategories.map((category) => [category.slug, category]));
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const checkpointPath = path.join(__dirname, '.assign-canonical-categories.checkpoint.json');
const reportPath = path.join(__dirname, '.assign-canonical-categories.report.json');
const proposalPath = path.join(__dirname, '.assign-canonical-categories.proposals.json');
const reviewPath = path.join(__dirname, '.assign-canonical-categories.review.json');

const buildCategoryMatchers = () => canonicalCategories.map((category) => {
  const aliases = [category.name_ar, ...(Array.isArray(category.aliases) ? category.aliases : [])]
    .map((value) => normalizeCategoryText(value))
    .filter(Boolean);
  const aliasSet = new Set(aliases);
  const compactAliasSet = new Set(aliases.map((value) => value.replace(/\s+/g, '')).filter(Boolean));
  return {
    slug: category.slug,
    name_ar: category.name_ar,
    aliases,
    aliasSet,
    compactAliasSet
  };
});

const categoryMatchers = buildCategoryMatchers();
const categoryAliasLookup = new Map();
for (const matcher of categoryMatchers) {
  categoryAliasLookup.set(String(matcher.slug), matcher.slug);
  for (const alias of matcher.aliases) {
    categoryAliasLookup.set(alias, matcher.slug);
    categoryAliasLookup.set(alias.replace(/\s+/g, ''), matcher.slug);
  }
}
const buildCategoryTrace = (slug) => {
  const category = categoryBySlug.get(slug);
  if (!category) {
    return {
      slug: String(slug || ''),
      name_ar: String(slug || ''),
      parentSlug: null,
      parentNameAr: null,
      pathSlugs: [String(slug || '')].filter(Boolean),
      pathNamesAr: [String(slug || '')].filter(Boolean),
      pathLabel: String(slug || ''),
      isLeaf: true
    };
  }

  const pathSlugs = Array.isArray(category.pathSlugs) && category.pathSlugs.length > 0
    ? category.pathSlugs
    : [category.slug];
  const pathNamesAr = Array.isArray(category.pathNamesAr) && category.pathNamesAr.length > 0
    ? category.pathNamesAr
    : [category.name_ar || category.slug];

  return {
    slug: category.slug,
    name_ar: category.name_ar || category.slug,
    parentSlug: category.parentSlug || null,
    parentNameAr: category.parentNameAr || null,
    pathSlugs,
    pathNamesAr,
    pathLabel: pathNamesAr.join(' > '),
    isLeaf: !category.parentSlug
      ? pathSlugs.length === 1
      : true
  };
};
const fashionQualifierRules = [
  {
    slug: 'fashion_men',
    qualifiers: ['رجالي', 'رجال', 'للرجال', 'شبابي'],
    clothingTerms: ['ملابس', 'ازياء', 'لبس', 'قميص', 'تيشيرت', 'تيشرت', 'بنطلون', 'بنطرون', 'شورت', 'هودي', 'جاكيت', 'بيجامه', 'طقم']
  },
  {
    slug: 'fashion_women',
    qualifiers: ['نسائي', 'نساء', 'للنسا', 'حريمي'],
    clothingTerms: ['ملابس', 'ازياء', 'لبس', 'فستان', 'بلوزه', 'عبايه', 'تنوره', 'قميص', 'تيشيرت', 'تيشرت', 'بنطلون', 'بنطرون', 'بيجامه', 'طقم']
  },
  {
    slug: 'fashion_kids',
    qualifiers: ['اطفال', 'اولادي', 'بناتي', 'مواليد', 'بيبي', 'طفل', 'رضيع', 'رضع'],
    clothingTerms: ['ملابس', 'ازياء', 'لبس', 'بيجامه', 'تيشيرت', 'تيشرت', 'فستان', 'طقم', 'بنطلون', 'بنطرون', 'جاكيت', 'شورت']
  }
].map((rule) => ({
  ...rule,
  qualifiers: rule.qualifiers.map((value) => normalizeCategoryText(value)).filter(Boolean),
  clothingTerms: rule.clothingTerms.map((value) => normalizeCategoryText(value)).filter(Boolean)
}));
const DEFAULT_BATCH_SIZE = 200;
const DEFAULT_QUERY_TIMEOUT_MS = 60000;
const DEFAULT_ALL_MODE_FETCH_CHUNK_SIZE = 5;
const DEFAULT_REVIEW_EVERY = 1800;
const DEFAULT_AI_MODEL = String(
  process.env.CATEGORY_ASSIGN_MODEL
  || process.env.DEEPINFRA_CATEGORY_MODEL
  || process.env.DEEPINFRA_MODEL
  || 'Qwen/Qwen3-8B'
).trim();
const heartbeatMs = 15000;

const safeParseMetadata = (value) => {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
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

const findExistingCategorySlug = (...values) => {
  for (const value of values) {
    const normalized = normalizeCategoryText(value);
    if (!normalized) continue;
    const compact = normalized.replace(/\s+/g, '');
    const existing = categoryAliasLookup.get(normalized) || categoryAliasLookup.get(compact);
    if (existing) return existing;
  }
  return null;
};

const buildCompositeKeywordTexts = (keywords) => {
  const cleanKeywords = Array.from(new Set(
    (Array.isArray(keywords) ? keywords : [])
      .map((value) => String(value || '').trim())
      .filter(Boolean)
  ));
  if (cleanKeywords.length < 2) return [];

  const limitedKeywords = cleanKeywords.slice(0, 10);
  const compositeTexts = new Set();
  compositeTexts.add(limitedKeywords.join(' '));

  for (let windowSize = 2; windowSize <= 4; windowSize += 1) {
    for (let index = 0; index <= limitedKeywords.length - windowSize; index += 1) {
      compositeTexts.add(limitedKeywords.slice(index, index + windowSize).join(' '));
    }
  }

  const singleWordKeywords = limitedKeywords.filter((value) => String(value).trim().split(/\s+/).length === 1);
  const pairLimit = Math.min(singleWordKeywords.length, 8);
  for (let i = 0; i < pairLimit; i += 1) {
    for (let j = i + 1; j < pairLimit; j += 1) {
      compositeTexts.add(`${singleWordKeywords[i]} ${singleWordKeywords[j]}`);
    }
  }

  return Array.from(compositeTexts);
};

const collectProductTexts = (product) => {
  const aiMetadata = safeParseMetadata(product.aiMetadata);
  const keywordComposites = buildCompositeKeywordTexts(product.keywords);
  const values = [
    product.name,
    ...(Array.isArray(product.keywords) ? product.keywords : []),
    ...keywordComposites,
    aiMetadata.originalTitle,
    aiMetadata.original_title,
    aiMetadata.translatedTitle,
    aiMetadata.translated_title,
    aiMetadata.title,
    aiMetadata.title_ar,
    aiMetadata.titleAr,
    aiMetadata.description,
    aiMetadata.description_ar,
    aiMetadata.descriptionAr,
    aiMetadata.translatedDescription,
    aiMetadata.translatedDesc,
    aiMetadata.fullDescriptionAr,
    aiMetadata.full_description_ar,
    aiMetadata.sourceCategory,
    aiMetadata.categoryName,
    aiMetadata.categoryPath,
    aiMetadata.categoryPathAr,
    product.specs
  ];
  return Array.from(new Set(values
    .flatMap((value) => String(value || '').split(/[\n\r|;,/]+/))
    .map((value) => String(value || '').trim())
    .filter(Boolean)));
};

const addScore = (scores, matchedTerms, slug, points, rawText) => {
  if (!slug || !Number.isFinite(points) || points <= 0) return;
  scores.set(slug, (scores.get(slug) || 0) + points);
  if (rawText) {
    const bucket = matchedTerms.get(slug) || new Set();
    bucket.add(String(rawText).slice(0, 120));
    matchedTerms.set(slug, bucket);
  }
};

const textContainsWholeTerm = (normalizedText, term) => {
  if (!normalizedText || !term) return false;
  return normalizedText === term
    || normalizedText.startsWith(`${term} `)
    || normalizedText.endsWith(` ${term}`)
    || normalizedText.includes(` ${term} `);
};

const hasAnyWholeTerm = (normalizedText, terms) => terms.some((term) => textContainsWholeTerm(normalizedText, term));

const getFashionQualifierRule = (slug) => fashionQualifierRules.find((rule) => rule.slug === slug) || null;

const isAmbiguousFashionQualifierText = (normalizedText, slug) => {
  const rule = getFashionQualifierRule(slug);
  if (!rule) return false;
  return rule.qualifiers.includes(normalizedText);
};

const scoreFashionQualifierSignals = (normalizedText, scores, matchedTerms) => {
  for (const rule of fashionQualifierRules) {
    const hasQualifier = hasAnyWholeTerm(normalizedText, rule.qualifiers);
    if (!hasQualifier) continue;
    const hasClothingTerm = hasAnyWholeTerm(normalizedText, rule.clothingTerms);
    if (hasClothingTerm) {
      addScore(scores, matchedTerms, rule.slug, 120, normalizedText);
    } else if (normalizedText.split(/\s+/).length <= 2) {
      addScore(scores, matchedTerms, rule.slug, 8, normalizedText);
    }
  }
};

const scoreTextAgainstCategories = (normalizedText, compactText, scores, matchedTerms) => {
  scoreFashionQualifierSignals(normalizedText, scores, matchedTerms);

  const direct = mapToCanonicalCategory(normalizedText) || mapToCanonicalCategory(compactText);
  if (direct) {
    addScore(
      scores,
      matchedTerms,
      direct,
      isAmbiguousFashionQualifierText(normalizedText, direct) ? 12 : 140,
      normalizedText
    );
  }

  for (const matcher of categoryMatchers) {
    let extra = 0;
    for (const alias of matcher.aliases) {
      if (!alias) continue;
      const compactAlias = alias.replace(/\s+/g, '');
      if (isAmbiguousFashionQualifierText(alias, matcher.slug)) {
        if (normalizedText === alias || compactText === compactAlias) {
          extra += 6;
        }
        continue;
      }
      if (normalizedText === alias || compactText === compactAlias) {
        extra += 80;
      } else if (normalizedText.startsWith(alias) || compactText.startsWith(compactAlias)) {
        extra += 44;
      } else if (alias.length >= 3 && (normalizedText.includes(alias) || compactText.includes(compactAlias))) {
        extra += 18;
      }
    }
    if (extra > 0) {
      addScore(scores, matchedTerms, matcher.slug, extra, normalizedText);
    }
  }
};

const rankCategoryScores = (scores) => Array.from(scores.entries()).sort((a, b) => {
  const diff = b[1] - a[1];
  if (diff !== 0) return diff;
  return String(a[0]).localeCompare(String(b[0]));
});

const classifyProductRuleBased = (product) => {
  const texts = collectProductTexts(product);
  const scores = new Map();
  const matchedTerms = new Map();

  for (const text of texts) {
    const normalizedText = normalizeCategoryText(text);
    if (!normalizedText) continue;
    const compactText = normalizedText.replace(/\s+/g, '');
    if (!compactText) continue;
    scoreTextAgainstCategories(normalizedText, compactText, scores, matchedTerms);
  }

  const ranked = rankCategoryScores(scores);
  if (ranked.length === 0) {
    return {
      slug: 'other',
      score: 0,
      confidence: 'low',
      source: 'rules',
      matchedTerms: [],
      candidates: []
    };
  }

  const [bestSlug, bestScore] = ranked[0];
  const secondScore = ranked[1]?.[1] || 0;
  const scoreGap = bestScore - secondScore;
  const competitionRatio = bestScore > 0 && secondScore > 0 ? (secondScore / bestScore) : 0;
  let confidence = 'low';
  if (bestScore >= 180 && scoreGap >= 60 && competitionRatio < 0.7) {
    confidence = 'high';
  } else if (bestScore >= 90 && scoreGap >= 20 && competitionRatio < 0.9) {
    confidence = 'medium';
  }

  return {
    slug: bestSlug,
    score: bestScore,
    confidence,
    source: 'rules',
    matchedTerms: Array.from(matchedTerms.get(bestSlug) || []).slice(0, 12),
    candidates: ranked.slice(0, 25).map(([slug, score]) => ({ slug, score }))
  };
};

const getAiClient = () => {
  const siliconFlowKey = String(process.env.SILICONFLOW_API_KEY || '').trim();
  const deepInfraKey = String(process.env.DEEPINFRA_API_KEY || '').trim();
  if (siliconFlowKey) {
    return new OpenAI({
      baseURL: 'https://api.siliconflow.com/v1',
      apiKey: siliconFlowKey
    });
  }
  if (deepInfraKey) {
    return new OpenAI({
      baseURL: 'https://api.deepinfra.com/v1/openai',
      apiKey: deepInfraKey
    });
  }
  return null;
};

const extractJsonObject = (raw) => {
  const text = String(raw || '').trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {}

  const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    try {
      return JSON.parse(fencedMatch[1]);
    } catch {}
  }

  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    try {
      return JSON.parse(text.slice(firstBrace, lastBrace + 1));
    } catch {}
  }

  return null;
};

const buildAiCategoryChoices = (ruleClassification) => {
  const ruleChoices = Array.isArray(ruleClassification?.candidates) ? ruleClassification.candidates : [];
  if (ruleChoices.length > 0) {
    return ruleChoices
      .map((entry) => {
        const category = categoryBySlug.get(entry.slug);
        return `${entry.slug} | ${category?.name_ar || entry.slug}`;
      })
      .join('\n');
  }

  return canonicalCategories
    .map((category) => `${category.slug} | ${category.name_ar}`)
    .join('\n');
};

const buildAiCategoryCatalog = () => canonicalCategories
  .map((category) => {
    const aliases = Array.isArray(category.aliases) ? category.aliases.slice(0, 6).join(', ') : '';
    return `${category.slug} | ${category.name_ar}${aliases ? ` | aliases: ${aliases}` : ''}`;
  })
  .join('\n');

const parseAiConfidence = (value, fallback = 'medium') => {
  const normalized = String(value || '').toLowerCase();
  return ['high', 'medium', 'low'].includes(normalized) ? normalized : fallback;
};

const buildExistingCategoryClassification = (slug, ruleClassification, reason, confidence) => ({
  slug,
  score: Math.max(Number(ruleClassification?.score || 0), 60),
  confidence: parseAiConfidence(confidence, 'medium'),
  source: 'ai_fallback',
  matchedTerms: Array.isArray(ruleClassification?.matchedTerms) ? ruleClassification.matchedTerms : [],
  candidates: Array.isArray(ruleClassification?.candidates) ? ruleClassification.candidates : [],
  reason: String(reason || 'ai_fallback').slice(0, 200)
});

const sanitizeProposalPayload = (proposal) => {
  if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal)) return null;
  const slug = normalizeProposalSlug(proposal.slug || proposal.slug_en || proposal.slugEn);
  const nameAr = String(proposal.name_ar || proposal.nameAr || '').trim();
  const parentSlug = String(proposal.parentSlug || proposal.parent_slug || '').trim();
  const aliases = dedupeStrings([
    ...(Array.isArray(proposal.aliases) ? proposal.aliases : []),
    ...(Array.isArray(proposal.aliases_ar) ? proposal.aliases_ar : []),
    ...(Array.isArray(proposal.aliases_en) ? proposal.aliases_en : [])
  ]).slice(0, 12);
  if (!slug || !nameAr || !parentSlug) return null;
  return {
    slug,
    name_ar: nameAr,
    parentSlug,
    aliases,
    reason: String(proposal.reason || '').trim().slice(0, 240)
  };
};

const createCategoryProposalEntry = (proposal, product, ruleClassification, aiReason) => ({
  status: 'pending',
  proposedSlug: proposal.slug,
  name_ar: proposal.name_ar,
  parentSlug: proposal.parentSlug,
  aliases: dedupeStrings([proposal.name_ar, proposal.slug, ...proposal.aliases]).slice(0, 16),
  reason: String(proposal.reason || aiReason || 'ai_new_category_proposal').slice(0, 240),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  supportingProducts: [
    {
      productId: product.id,
      name: String(product.name || '').slice(0, 240),
      ruleSlug: ruleClassification.slug,
      ruleConfidence: ruleClassification.confidence,
      matchedTerms: Array.isArray(ruleClassification.matchedTerms) ? ruleClassification.matchedTerms.slice(0, 8) : []
    }
  ]
});

const mergeProposalEntries = (existingEntry, nextEntry) => {
  if (!existingEntry) return nextEntry;
  const seenProductIds = new Set((Array.isArray(existingEntry.supportingProducts) ? existingEntry.supportingProducts : []).map((item) => Number(item?.productId || 0)));
  const supportingProducts = [
    ...(Array.isArray(existingEntry.supportingProducts) ? existingEntry.supportingProducts : [])
  ];
  for (const item of Array.isArray(nextEntry.supportingProducts) ? nextEntry.supportingProducts : []) {
    const productId = Number(item?.productId || 0);
    if (productId > 0 && !seenProductIds.has(productId)) {
      seenProductIds.add(productId);
      supportingProducts.push(item);
    }
  }
  return {
    ...existingEntry,
    ...nextEntry,
    status: existingEntry.status || nextEntry.status || 'pending',
    aliases: dedupeStrings([...(existingEntry.aliases || []), ...(nextEntry.aliases || [])]).slice(0, 16),
    supportingProducts: supportingProducts.slice(0, 50),
    createdAt: existingEntry.createdAt || nextEntry.createdAt,
    updatedAt: new Date().toISOString()
  };
};

const readProposalReport = () => {
  try {
    if (!fs.existsSync(proposalPath)) return [];
    const raw = fs.readFileSync(proposalPath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const writeProposalReport = (proposals) => {
  fs.writeFileSync(proposalPath, JSON.stringify(proposals, null, 2));
};

const writeReviewReport = (review) => {
  fs.writeFileSync(reviewPath, JSON.stringify(review, null, 2));
};

const isPendingProposalEntry = (entry) => {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
  return String(entry.status || 'pending').toLowerCase() === 'pending' && Boolean(entry.proposedSlug);
};

const getPendingProposalEntries = (proposalMap) => getSortedProposalEntries(proposalMap).filter(isPendingProposalEntry);

const getSortedProposalEntries = (proposalMap) => Array.from(proposalMap.values()).sort((a, b) => {
  const aPending = isPendingProposalEntry(a) ? 0 : 1;
  const bPending = isPendingProposalEntry(b) ? 0 : 1;
  if (aPending !== bPending) return aPending - bPending;
  const supportDiff = (b?.supportingProducts?.length || 0) - (a?.supportingProducts?.length || 0);
  if (supportDiff !== 0) return supportDiff;
  return String(a?.proposedSlug || '').localeCompare(String(b?.proposedSlug || ''));
});

const upsertProposal = (proposalMap, proposal, product, ruleClassification, aiReason) => {
  const entry = createCategoryProposalEntry(proposal, product, ruleClassification, aiReason);
  const current = proposalMap.get(entry.proposedSlug);
  proposalMap.set(entry.proposedSlug, mergeProposalEntries(current, entry));
};

const truncateText = (value, maxLength = 120) => {
  const text = String(value || '').trim();
  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
};

const compactProposalForReview = (entry) => ({
  proposedSlug: String(entry?.proposedSlug || '').trim(),
  name_ar: String(entry?.name_ar || '').trim(),
  parentSlug: String(entry?.parentSlug || '').trim(),
  aliases: dedupeStrings(entry?.aliases || []).slice(0, 8),
  supportCount: Array.isArray(entry?.supportingProducts) ? entry.supportingProducts.length : 0,
  sampleProducts: (Array.isArray(entry?.supportingProducts) ? entry.supportingProducts : [])
    .slice(0, 4)
    .map((item) => ({
      productId: Number(item?.productId || 0),
      name: truncateText(item?.name || '', 120)
    })),
  rejectedMergeTargets: dedupeStrings(entry?.rejectedMergeTargets || []).slice(0, 24)
});

const parseReviewConfidence = (value) => parseAiConfidence(value, 'medium');

const sanitizeReviewSuggestions = (payload, proposalEntries) => {
  const proposalLookup = new Map(proposalEntries.map((entry) => [String(entry.proposedSlug), entry]));
  const rawSuggestions = Array.isArray(payload?.suggestions) ? payload.suggestions : [];
  const seen = new Set();
  const suggestions = [];

  for (const item of rawSuggestions) {
    const type = String(item?.type || '').trim().toLowerCase();
    const sourceSlug = normalizeProposalSlug(item?.sourceSlug || item?.source_slug);
    const targetSlug = type === 'merge_proposals'
      ? normalizeProposalSlug(item?.targetSlug || item?.target_slug)
      : String(item?.targetSlug || item?.target_slug || '').trim();
    const reason = truncateText(item?.reason || 'ai_review_merge', 240);
    const confidence = parseReviewConfidence(item?.confidence);
    if (!sourceSlug || !targetSlug || sourceSlug === targetSlug) continue;

    const sourceEntry = proposalLookup.get(sourceSlug);
    if (!sourceEntry || !isPendingProposalEntry(sourceEntry)) continue;

    if (type === 'merge_proposals') {
      const targetEntry = proposalLookup.get(targetSlug);
      if (!targetEntry || !isPendingProposalEntry(targetEntry)) continue;
    } else if (type === 'merge_to_existing') {
      if (!categoryBySlug.has(targetSlug)) continue;
    } else {
      continue;
    }

    const rejectionKey = `${type}:${targetSlug}`;
    const rejectedTargets = new Set(dedupeStrings(sourceEntry.rejectedMergeTargets || []));
    if (rejectedTargets.has(rejectionKey)) continue;

    const dedupeKey = `${type}:${sourceSlug}:${targetSlug}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    suggestions.push({
      type,
      sourceSlug,
      targetSlug,
      reason,
      confidence
    });
  }

  const confidenceRank = { high: 0, medium: 1, low: 2 };
  return suggestions.sort((a, b) => {
    const diff = (confidenceRank[a.confidence] ?? 9) - (confidenceRank[b.confidence] ?? 9);
    if (diff !== 0) return diff;
    return `${a.sourceSlug}:${a.targetSlug}`.localeCompare(`${b.sourceSlug}:${b.targetSlug}`);
  });
};

const reviewPendingProposalsWithAi = async (client, proposalEntries) => {
  if (!client || !Array.isArray(proposalEntries) || proposalEntries.length === 0) return [];
  const pendingCatalog = proposalEntries.map(compactProposalForReview);
  const response = await client.chat.completions.create({
    model: DEFAULT_AI_MODEL,
    temperature: 0,
    messages: [
      {
        role: 'system',
        content: [
          'You review pending product category proposals.',
          'Return JSON only.',
          'Schema: {"suggestions":[{"type":"merge_proposals|merge_to_existing","sourceSlug":"pending_slug","targetSlug":"pending_or_existing_slug","confidence":"high|medium|low","reason":"short reason"}]}',
          'Use merge_proposals only when two pending proposals mean the same thing, differ only by typo, wording, or unnecessary extras.',
          'Use merge_to_existing only when an existing canonical category already covers the proposal well.',
          'Prefer merge_to_existing over keeping duplicate pending categories.',
          'Do not merge parent-child categories that are genuinely different.',
          'Only use targetSlug values from the provided pending proposals or the provided canonical category catalog.'
        ].join(' ')
      },
      {
        role: 'user',
        content: [
          'Pending proposals:',
          JSON.stringify(pendingCatalog, null, 2),
          '',
          'Existing canonical category catalog:',
          buildAiCategoryCatalog()
        ].join('\n')
      }
    ]
  });

  const parsed = extractJsonObject(response?.choices?.[0]?.message?.content);
  return sanitizeReviewSuggestions(parsed, proposalEntries);
};

const mergeSupportingProducts = (left, right) => {
  const seen = new Set();
  const merged = [];
  for (const item of [...(Array.isArray(left) ? left : []), ...(Array.isArray(right) ? right : [])]) {
    const productId = Number(item?.productId || 0);
    const dedupeKey = productId > 0 ? `id:${productId}` : `name:${String(item?.name || '')}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    merged.push(item);
  }
  return merged.slice(0, 50);
};

const appendReviewNote = (entry, note) => dedupeStrings([...(Array.isArray(entry?.reviewNotes) ? entry.reviewNotes : []), note]).slice(0, 24);

const markSuggestionRejected = (proposalMap, suggestion) => {
  const sourceEntry = proposalMap.get(suggestion.sourceSlug);
  if (!sourceEntry) return;
  const rejectionKey = `${suggestion.type}:${suggestion.targetSlug}`;
  proposalMap.set(suggestion.sourceSlug, {
    ...sourceEntry,
    rejectedMergeTargets: dedupeStrings([...(sourceEntry.rejectedMergeTargets || []), rejectionKey]).slice(0, 24),
    reviewNotes: appendReviewNote(sourceEntry, `Rejected ${suggestion.type} -> ${suggestion.targetSlug}`),
    updatedAt: new Date().toISOString()
  });
};

const applyReviewSuggestion = (proposalMap, suggestion) => {
  const now = new Date().toISOString();
  const sourceEntry = proposalMap.get(suggestion.sourceSlug);
  if (!sourceEntry || !isPendingProposalEntry(sourceEntry)) return false;

  if (suggestion.type === 'merge_to_existing') {
    proposalMap.set(suggestion.sourceSlug, {
      ...sourceEntry,
      status: 'merged_existing',
      mergedSlug: suggestion.targetSlug,
      mergedIntoSlug: suggestion.targetSlug,
      mergeReason: suggestion.reason,
      reviewNotes: appendReviewNote(sourceEntry, `Merged into existing ${suggestion.targetSlug}: ${suggestion.reason}`),
      mergedAt: now,
      updatedAt: now
    });
    return true;
  }

  if (suggestion.type === 'merge_proposals') {
    const targetEntry = proposalMap.get(suggestion.targetSlug);
    if (!targetEntry || !isPendingProposalEntry(targetEntry)) return false;

    proposalMap.set(suggestion.targetSlug, {
      ...targetEntry,
      aliases: dedupeStrings([
        ...(targetEntry.aliases || []),
        ...(sourceEntry.aliases || []),
        sourceEntry.proposedSlug,
        sourceEntry.name_ar
      ]).slice(0, 16),
      supportingProducts: mergeSupportingProducts(targetEntry.supportingProducts, sourceEntry.supportingProducts),
      reviewNotes: appendReviewNote(targetEntry, `Absorbed ${sourceEntry.proposedSlug}: ${suggestion.reason}`),
      updatedAt: now
    });

    proposalMap.set(suggestion.sourceSlug, {
      ...sourceEntry,
      status: 'merged_into_pending',
      mergedIntoSlug: suggestion.targetSlug,
      mergeReason: suggestion.reason,
      reviewNotes: appendReviewNote(sourceEntry, `Merged into pending ${suggestion.targetSlug}: ${suggestion.reason}`),
      mergedAt: now,
      updatedAt: now
    });
    return true;
  }

  return false;
};

const describeReviewSuggestion = (proposalMap, suggestion) => {
  const sourceEntry = proposalMap.get(suggestion.sourceSlug);
  const sourceLabel = `${suggestion.sourceSlug}${sourceEntry?.name_ar ? ` / ${sourceEntry.name_ar}` : ''}`;
  if (suggestion.type === 'merge_to_existing') {
    const category = categoryBySlug.get(suggestion.targetSlug);
    return `Merge pending "${sourceLabel}" into existing "${suggestion.targetSlug}${category?.name_ar ? ` / ${category.name_ar}` : ''}"`;
  }

  const targetEntry = proposalMap.get(suggestion.targetSlug);
  return `Merge pending "${sourceLabel}" into pending "${suggestion.targetSlug}${targetEntry?.name_ar ? ` / ${targetEntry.name_ar}` : ''}"`;
};

const promptReviewSuggestions = async (proposalMap, suggestions) => {
  if (!process.stdin.isTTY || !process.stdout.isTTY || !Array.isArray(suggestions) || suggestions.length === 0) {
    return { prompted: false, appliedCount: 0, dismissedCount: 0 };
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  let appliedCount = 0;
  let dismissedCount = 0;

  try {
    for (let index = 0; index < suggestions.length; index += 1) {
      const suggestion = suggestions[index];
      console.log('');
      console.log(`[category-assign] review ${index + 1}/${suggestions.length} ${describeReviewSuggestion(proposalMap, suggestion)}`);
      console.log(`[category-assign] review reason=${suggestion.reason} confidence=${suggestion.confidence}`);
      const answer = String(await rl.question('[category-assign] apply this merge? [Y/n] ')).trim().toLowerCase();
      if (answer === '' || answer === 'y' || answer === 'yes') {
        if (applyReviewSuggestion(proposalMap, suggestion)) {
          appliedCount += 1;
          console.log('[category-assign] review applied');
        } else {
          dismissedCount += 1;
          console.log('[category-assign] review skipped because source/target changed');
        }
      } else {
        markSuggestionRejected(proposalMap, suggestion);
        dismissedCount += 1;
        console.log('[category-assign] review kept separate');
      }
    }
  } finally {
    rl.close();
  }

  return {
    prompted: true,
    appliedCount,
    dismissedCount
  };
};

const runProposalReviewCheckpoint = async ({
  aiClient,
  proposalMap,
  processed,
  queryTimeoutMs,
  trigger,
  reviewEvery
}) => {
  const pendingEntries = getPendingProposalEntries(proposalMap);
  const reviewSummary = {
    reviewedAt: new Date().toISOString(),
    trigger,
    processed,
    reviewEvery,
    pendingCount: pendingEntries.length,
    suggestions: [],
    appliedCount: 0,
    dismissedCount: 0,
    prompted: false
  };

  if (!aiClient || pendingEntries.length === 0) {
    writeReviewReport(reviewSummary);
    return reviewSummary;
  }

  console.log(`[category-assign] review_start trigger=${trigger} processed=${processed} pending=${pendingEntries.length}`);
  let suggestions = [];
  try {
    suggestions = await withTimeout(
      reviewPendingProposalsWithAi(aiClient, pendingEntries),
      queryTimeoutMs,
      `review proposals ${processed}`
    );
  } catch (error) {
    reviewSummary.error = truncateText(error?.message || error, 240);
    writeReviewReport(reviewSummary);
    console.warn(`[category-assign] review_failed trigger=${trigger} error=${reviewSummary.error}`);
    return reviewSummary;
  }

  reviewSummary.suggestions = suggestions;
  if (suggestions.length === 0) {
    writeReviewReport(reviewSummary);
    console.log(`[category-assign] review_done trigger=${trigger} suggestions=0`);
    return reviewSummary;
  }

  console.log(`[category-assign] review_found trigger=${trigger} suggestions=${suggestions.length}`);
  const promptResult = await promptReviewSuggestions(proposalMap, suggestions);
  reviewSummary.prompted = promptResult.prompted;
  reviewSummary.appliedCount = promptResult.appliedCount;
  reviewSummary.dismissedCount = promptResult.dismissedCount;
  writeProposalReport(getSortedProposalEntries(proposalMap));
  writeReviewReport(reviewSummary);
  console.log(`[category-assign] review_done trigger=${trigger} applied=${reviewSummary.appliedCount} dismissed=${reviewSummary.dismissedCount} prompted=${reviewSummary.prompted ? 'yes' : 'no'} file=${reviewPath}`);
  return reviewSummary;
};

const resolveCategoryWithAi = async (client, product, ruleClassification, allowNewCategories) => {
  if (!client) {
    return {
      classification: ruleClassification,
      proposal: null
    };
  }

  const textBundle = collectProductTexts(product).slice(0, 24).join('\n');
  const candidateChoices = buildAiCategoryChoices(ruleClassification);
  const fullCatalog = buildAiCategoryCatalog();
  const response = await client.chat.completions.create({
    model: DEFAULT_AI_MODEL,
    temperature: 0,
    messages: [
      {
        role: 'system',
        content: [
          'You classify products into an existing canonical category when possible.',
          'Return JSON only.',
          allowNewCategories
            ? 'Schema: {"action":"use_existing|propose_new","slug":"existing_slug_or_empty","confidence":"high|medium|low","reason":"short reason","proposal":{"slug":"english_ascii_slug","name_ar":"Arabic category name","parentSlug":"existing_parent_slug","aliases":["alias1","alias2"],"reason":"short reason"}}'
            : 'Schema: {"action":"use_existing","slug":"allowed_slug","confidence":"high|medium|low","reason":"short reason"}',
          'Prefer an existing category when it is a reasonable fit.',
          'Only use propose_new when no existing category fits well.',
          'When proposing a new category, use an ASCII English slug, Arabic category name, and an existing parentSlug from the provided catalog.',
          'Never invent a parent slug outside the provided catalog.'
        ].join(' ')
      },
      {
        role: 'user',
        content: [
          'Product signals:',
          textBundle || 'No text available',
          '',
          'Top candidate categories:',
          candidateChoices || 'None',
          '',
          'Full category catalog:',
          fullCatalog
        ].join('\n')
      }
    ]
  });

  const parsed = extractJsonObject(response?.choices?.[0]?.message?.content);
  const action = String(parsed?.action || '').trim().toLowerCase();
  const reason = String(parsed?.reason || 'ai_fallback').slice(0, 200);
  const confidence = parseAiConfidence(parsed?.confidence, 'medium');
  const nextSlug = String(parsed?.slug || '').trim();
  if (categoryBySlug.has(nextSlug)) {
    return {
      classification: buildExistingCategoryClassification(nextSlug, ruleClassification, reason, confidence),
      proposal: null
    };
  }

  if (!allowNewCategories || action !== 'propose_new') {
    return {
      classification: ruleClassification,
      proposal: null
    };
  }

  const proposal = sanitizeProposalPayload(parsed?.proposal);
  if (!proposal || !categoryBySlug.has(proposal.parentSlug)) {
    return {
      classification: ruleClassification,
      proposal: null
    };
  }

  const existingSlug = findExistingCategorySlug(proposal.slug, proposal.name_ar, ...proposal.aliases);
  if (existingSlug && categoryBySlug.has(existingSlug)) {
    return {
      classification: buildExistingCategoryClassification(existingSlug, ruleClassification, reason, confidence),
      proposal: null
    };
  }

  return {
    classification: {
      ...ruleClassification,
      source: 'ai_new_category_proposed',
      reason
    },
    proposal
  };
};

const updateProductCategory = async (product, classification, dryRun) => {
  if (dryRun) return false;
  const category = categoryBySlug.get(classification.slug) || categoryBySlug.get('other');
  const nextMetadata = {
    categorySlug: category?.slug || 'other',
    categoryNameAr: category?.name_ar || 'أخرى',
    categoryScore: Number(classification.score || 0),
    categoryConfidence: classification.confidence || 'low',
    categorySource: classification.source || 'rules',
    categoryMatchedTerms: Array.isArray(classification.matchedTerms) ? classification.matchedTerms.slice(0, 12) : [],
    categoryReviewNeeded: classification.confidence === 'low' || (category?.slug || 'other') === 'other',
    categoryAssignedAt: new Date().toISOString()
  };
  const metadataPatch = JSON.stringify(nextMetadata);

  const maxRetries = 5;
  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const changedRows = await prisma.$executeRawUnsafe(`
        UPDATE "Product"
        SET "aiMetadata" = COALESCE("aiMetadata", '{}'::jsonb) || $2::jsonb
        WHERE id = $1
      `, product.id, metadataPatch);
      return Number(changedRows || 0) > 0;
    } catch (err) {
      lastError = err;
      const isConnectionError = err.code === 'P1001' || err.code === 'P1017' || String(err.message).includes('Can\'t reach database');
      
      if (isConnectionError && attempt < maxRetries) {
        const waitMs = Math.min(30000, 2000 * Math.pow(2, attempt - 1));
        console.warn(`[category-assign] Database connection lost for Product ${product.id}. Retrying (${attempt}/${maxRetries}) in ${waitMs}ms...`);
        await new Promise(r => setTimeout(r, waitMs));
        continue;
      }
      throw err;
    }
  }
  throw lastError;
};

const withTimeout = async (promise, timeoutMs, label) => {
  let timeoutId;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      })
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
};

const parseArgNumber = (name, fallback) => {
  const raw = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (!raw) return fallback;
  const value = Number.parseInt(raw.split('=').slice(1).join('='), 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const parseArgValue = (name) => {
  const raw = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (!raw) return null;
  return String(raw.split('=').slice(1).join('=') || '').trim();
};

const hasFlag = (name) => process.argv.includes(name);

const resolveBatchSize = () => {
  const raw = parseArgValue('--batch-size');
  if (!raw) return DEFAULT_BATCH_SIZE;
  if (raw.toLowerCase() === 'all' || raw.toLowerCase() === 'unlimited') return null;
  const numeric = Number.parseInt(raw, 10);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : DEFAULT_BATCH_SIZE;
};

const readCheckpoint = () => {
  try {
    if (!fs.existsSync(checkpointPath)) return null;
    const raw = fs.readFileSync(checkpointPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
};

const writeCheckpoint = (state) => {
  fs.writeFileSync(checkpointPath, JSON.stringify(state, null, 2));
};

const deleteCheckpoint = () => {
  try {
    if (fs.existsSync(checkpointPath)) fs.unlinkSync(checkpointPath);
  } catch {}
};

const writeReport = (report) => {
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
};

const run = async () => {
  const batchSize = resolveBatchSize();
  const maxProducts = parseArgNumber('--max-products', 0);
  const queryTimeoutMs = parseArgNumber('--timeout-ms', DEFAULT_QUERY_TIMEOUT_MS);
  const allModeChunkSize = parseArgNumber('--all-chunk', DEFAULT_ALL_MODE_FETCH_CHUNK_SIZE);
  const reviewEvery = parseArgNumber('--review-every', DEFAULT_REVIEW_EVERY);
  const resetCheckpoint = hasFlag('--reset-checkpoint');
  const dryRun = hasFlag('--dry-run');
  const useAi = hasFlag('--use-ai');
  const proposeCategories = hasFlag('--propose-categories');
  const aiClient = useAi ? getAiClient() : null;
  const checkpoint = resetCheckpoint ? null : readCheckpoint();
  const report = [];
  const proposalMap = new Map(
    readProposalReport()
      .filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry) && entry.proposedSlug)
      .map((entry) => [String(entry.proposedSlug), entry])
  );

  if (resetCheckpoint) deleteCheckpoint();
  if (useAi && !aiClient) {
    console.warn('[category-assign] --use-ai was provided but no SILICONFLOW_API_KEY or DEEPINFRA_API_KEY is configured. Falling back to rules only.');
  }
  if (proposeCategories && (!useAi || !aiClient)) {
    console.warn('[category-assign] --propose-categories requires a working AI client. Proposal generation is disabled for this run.');
  }

  let lastId = Number(checkpoint?.lastId || 0);
  if (!Number.isFinite(lastId) || lastId < 0) lastId = 0;

  const batchSizeLabel = batchSize === null ? 'all' : String(batchSize);
  console.log(`[category-assign] start batchSize=${batchSizeLabel} maxProducts=${maxProducts || 'all'} timeoutMs=${queryTimeoutMs} resumeFromId=${lastId} allModeChunk=${allModeChunkSize} dryRun=${dryRun ? 'yes' : 'no'} useAi=${useAi && aiClient ? 'yes' : 'no'} proposeCategories=${proposeCategories && useAi && aiClient ? 'yes' : 'no'} model=${DEFAULT_AI_MODEL}`);

  const connectWithRetry = async (retries = 3) => {
    for (let i = 0; i < retries; i++) {
      try {
        await withTimeout(prisma.$connect(), queryTimeoutMs, 'prisma connect');
        return;
      } catch (err) {
        if (i === retries - 1) throw err;
        console.warn(`[category-assign] db connect failed, retrying (${i + 1}/${retries})...`);
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  };

  await connectWithRetry();

  const fetchBatchWithRetry = async (query, id, take, timeoutMs, retries = 3) => {
    for (let i = 0; i < retries; i++) {
      try {
        return await withTimeout(prisma.$queryRawUnsafe(query, id, take), timeoutMs, 'fetch batch');
      } catch (err) {
        if (i === retries - 1) throw err;
        console.warn(`[category-assign] db fetch failed, retrying (${i + 1}/${retries})... error=${String(err?.message || err).slice(0, 100)}`);
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  };

  const remainingRows = await withTimeout(prisma.$queryRawUnsafe(`
    SELECT count(*)::int AS total
    FROM "Product"
    WHERE "isActive" = true AND status = 'PUBLISHED' AND id > $1
  `, lastId), queryTimeoutMs, 'count remaining products');
  const remainingCount = Number(Array.isArray(remainingRows) && remainingRows[0]?.total ? remainingRows[0].total : 0);
  const totalCount = maxProducts > 0 ? Math.min(remainingCount, maxProducts) : remainingCount;
  if (totalCount <= 0) {
    console.log('[category-assign] no products to process');
    deleteCheckpoint();
    writeReport([]);
    writeProposalReport(getSortedProposalEntries(proposalMap));
    return;
  }

  const fetchChunkSize = batchSize === null ? Math.min(allModeChunkSize, totalCount) : batchSize;
  let processed = 0;
  let updated = 0;
  let proposalCount = 0;
  let lastReviewProcessed = 0;
  let nextReviewAt = reviewEvery;
  let keepGoing = true;
  const heartbeat = setInterval(() => {
    console.log(`[category-assign] heartbeat processed=${processed}/${totalCount} updated=${updated} proposals=${proposalCount} lastId=${lastId} chunk=${fetchChunkSize}`);
  }, heartbeatMs);

  try {
    while (keepGoing && processed < totalCount) {
      const remaining = totalCount - processed;
      const takeCount = Math.min(fetchChunkSize, remaining);
      console.log(`[category-assign] fetching_batch afterId=${lastId} take=${takeCount}`);
      const rows = await fetchBatchWithRetry(`
        SELECT id, name, specs, "keywords", "aiMetadata"
        FROM "Product"
        WHERE "isActive" = true
          AND status = 'PUBLISHED'
          AND id > $1
        ORDER BY id ASC
        LIMIT $2
      `, lastId, takeCount, queryTimeoutMs);
      console.log(`[category-assign] fetched_batch count=${Array.isArray(rows) ? rows.length : 0}`);
      if (!Array.isArray(rows) || rows.length === 0) {
        keepGoing = false;
        break;
      }

      for (const product of rows) {
        processed += 1;
        lastId = Number(product.id) || lastId;

        const ruleClassification = classifyProductRuleBased(product);
        let finalClassification = ruleClassification;
        let proposal = null;
        if (useAi && aiClient && ruleClassification.confidence === 'low') {
          try {
            const aiResult = await withTimeout(
              resolveCategoryWithAi(aiClient, product, ruleClassification, proposeCategories),
              queryTimeoutMs,
              `ai classify ${product.id}`
            );
            finalClassification = aiResult?.classification || ruleClassification;
            proposal = aiResult?.proposal || null;
          } catch (error) {
            console.warn(`[category-assign] ai_fallback_failed productId=${product.id} error=${String(error?.message || error).slice(0, 200)}`);
            finalClassification = {
              ...ruleClassification,
              source: 'rules_ai_unavailable',
              reason: String(error?.message || 'ai_unavailable').slice(0, 200)
            };
          }
        }

        if (proposal) {
          upsertProposal(proposalMap, proposal, product, ruleClassification, finalClassification.reason);
          proposalCount += 1;
        }

        const changed = await withTimeout(
          updateProductCategory(product, finalClassification, dryRun),
          queryTimeoutMs,
          `update product ${product.id}`
        );
        if (changed) updated += 1;

        const categoryTrace = buildCategoryTrace(finalClassification.slug);
        report.push({
          productId: product.id,
          slug: finalClassification.slug,
          categoryNameAr: categoryTrace.name_ar,
          categoryParentSlug: categoryTrace.parentSlug,
          categoryParentNameAr: categoryTrace.parentNameAr,
          categoryPathSlugs: categoryTrace.pathSlugs,
          categoryPathNamesAr: categoryTrace.pathNamesAr,
          categoryPathLabel: categoryTrace.pathLabel,
          score: finalClassification.score,
          confidence: finalClassification.confidence,
          source: finalClassification.source,
          reason: finalClassification.reason,
          matchedTerms: finalClassification.matchedTerms,
          candidates: finalClassification.candidates,
          proposedCategorySlug: proposal?.slug || null,
          proposedCategoryParentSlug: proposal?.parentSlug || null
        });

        console.log(`[category-assign] category_success productId=${product.id} slug=${finalClassification.slug} path="${categoryTrace.pathLabel}" score=${finalClassification.score} confidence=${finalClassification.confidence} source=${finalClassification.source} changed=${changed ? 'yes' : 'no'}`);
        if (processed % 50 === 0 || processed === totalCount) {
          console.log(`[category-assign] progress processed=${processed}/${totalCount} updated=${updated}`);
          writeCheckpoint({
            lastId,
            processedInCurrentRun: processed,
            updatedInCurrentRun: updated,
            batchSize: batchSizeLabel,
            dryRun,
            useAi: useAi && Boolean(aiClient),
            updatedAt: new Date().toISOString()
          });
          writeReport(report);
          writeProposalReport(getSortedProposalEntries(proposalMap));
        }

        if (proposeCategories && aiClient && reviewEvery > 0 && processed >= nextReviewAt) {
          await runProposalReviewCheckpoint({
            aiClient,
            proposalMap,
            processed,
            queryTimeoutMs,
            trigger: `every_${reviewEvery}`,
            reviewEvery
          });
          lastReviewProcessed = processed;
          nextReviewAt += reviewEvery;
        }
      }

      console.log(`[category-assign] batch_done processed=${processed}/${totalCount} updated=${updated} lastId=${lastId}`);
      writeCheckpoint({
        lastId,
        processedInCurrentRun: processed,
        updatedInCurrentRun: updated,
        batchSize: batchSizeLabel,
        dryRun,
        useAi: useAi && Boolean(aiClient),
        updatedAt: new Date().toISOString()
      });
      writeReport(report);
      writeProposalReport(getSortedProposalEntries(proposalMap));
    }
  } finally {
    clearInterval(heartbeat);
  }

  writeReport(report);
  if (proposeCategories && aiClient && getPendingProposalEntries(proposalMap).length > 0 && processed !== lastReviewProcessed) {
    await runProposalReviewCheckpoint({
      aiClient,
      proposalMap,
      processed,
      queryTimeoutMs,
      trigger: 'final',
      reviewEvery
    });
  }
  const sortedProposals = getSortedProposalEntries(proposalMap);
  writeProposalReport(sortedProposals);
  console.log(`[category-assign] done processed=${processed} updated=${updated} proposals=${proposalCount} uniqueProposals=${sortedProposals.length} report=${reportPath}`);
  if (sortedProposals.length > 0) {
    console.log(`[category-assign] proposal file: ${proposalPath}`);
    console.log(`[category-assign] review file: ${reviewPath}`);
    console.log('[category-assign] approve any proposal by setting status="approved", then run merge_approved_category_proposals.bat');
  }
  deleteCheckpoint();
};

run()
  .catch((error) => {
    console.error('[category-assign] failed', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
