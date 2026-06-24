import { embedImage, embedText } from './clipService.js';
import { normalizeArabic, normalizedTerms } from './arabicNormalize.js';

export const MAX_PRODUCT_IMAGE_EMBEDDINGS = Math.max(
  1,
  Number.parseInt(String(process.env.MAX_PRODUCT_IMAGE_EMBEDDINGS || ''), 10) || 4
);

function defaultRunDb(operation) {
  return operation();
}

function vectorToSqlLiteral(vector) {
  return `[${vector.join(',')}]`;
}

export function sanitizeProductImageUrl(input) {
  if (typeof input !== 'string') return '';
  let url = input.trim();
  if (!url) return '';
  url = url.replace(/^[`'"]+|[`'"]+$/g, '');
  if (url.startsWith('//')) url = `https:${url}`;
  url = url.replace(/[)\]}",:;`]+$/g, '');
  url = url.replace(/[#?].*$/, '');
  url = url.replace(/_\d+x\d+.*$/, '').replace(/\.webp$/i, '');
  return /^https?:\/\//i.test(url) ? url : '';
}

async function loadTopProductImages(prisma, productId, limit, runDb) {
  return runDb(
    () => prisma.productImage.findMany({
      where: { productId },
      select: { id: true, url: true, order: true },
      orderBy: [{ order: 'asc' }, { id: 'asc' }],
      take: limit
    }),
    `fetch top product images ${productId}`
  );
}

export async function ensureProductImageEmbeddings({
  prisma,
  productId,
  productName = null,
  fallbackImageUrl = null,
  maxImages = MAX_PRODUCT_IMAGE_EMBEDDINGS,
  runDb = defaultRunDb,
  logger = console,
}) {
  // Check if product already has a valid embedding - preserve it if so
  const existingProduct = await runDb(
    () => prisma.product.findUnique({
      where: { id: productId },
      select: { imageEmbedding: true }
    }),
    `check existing image embedding for product ${productId}`
  );

  if (existingProduct?.imageEmbedding) {
    logger.info?.(`[Image Embedding] Product ${productId} already has an embedding, preserving it`);
    return {
      embeddedCount: 0,
      embeddedImageIds: [],
      mainVector: null,
      preserved: true
    };
  }

  // Just get one image (the first one)
  const productImages = await loadTopProductImages(prisma, productId, 1, runDb);
  
  let imageUrl = null;
  
  if (productImages.length > 0) {
    imageUrl = sanitizeProductImageUrl(productImages[0].url);
  }
  
  // If no ProductImage, try fallback
  if (!imageUrl) {
    const fallbackUrl = sanitizeProductImageUrl(fallbackImageUrl);
    if (fallbackUrl) {
      imageUrl = fallbackUrl;
    }
  }

  if (!imageUrl) {
    return { embeddedCount: 0, embeddedImageIds: [], mainVector: null };
  }

  try {
    const embedding = await embedImage(imageUrl, productName || null);
    if (!Array.isArray(embedding) || embedding.length === 0 || embedding.every((value) => value === 0)) {
      logger.warn?.(`[Image Embedding] Empty/zero embedding for Product ${productId}`);
      return { embeddedCount: 0, embeddedImageIds: [], mainVector: null };
    }

    // Ensure embedding is 512 dimensions
    let finalEmbedding = embedding;
    if (embedding.length !== 512) {
      finalEmbedding = [...embedding];
      while (finalEmbedding.length < 512) finalEmbedding.push(0);
      finalEmbedding = finalEmbedding.slice(0, 512);
    }

    const vectorLiteral = vectorToSqlLiteral(finalEmbedding);
    await runDb(
      () => prisma.$executeRawUnsafe(
        `UPDATE "Product" SET "imageEmbedding" = $1::vector WHERE "id" = $2`,
        vectorLiteral,
        productId
      ),
      `update product image embedding ${productId}`
    );

    return {
      embeddedCount: 1,
      embeddedImageIds: productImages.length > 0 ? [productImages[0].id] : [],
      mainVector: vectorLiteral,
      averagedVector: finalEmbedding
    };
  } catch (error) {
    logger.warn?.(`[Image Embedding] Failed for Product ${productId}: ${error?.message || error}`);
    return { embeddedCount: 0, embeddedImageIds: [], mainVector: null };
  }
}

export async function searchProductsByImageVector(prisma, vector, limit = 20, offset = 0) {
  const safeLimit = Math.min(100, Math.max(1, Number.parseInt(String(limit || '20'), 10) || 20));
  const safeOffset = Math.max(0, Number.parseInt(String(offset || '0'), 10) || 0);
  
  // Ensure vector is 512 dimensions
  let finalVector = vector;
  if (vector.length !== 512) {
    finalVector = [...vector];
    while (finalVector.length < 512) finalVector.push(0);
    finalVector = finalVector.slice(0, 512);
  }

  const vectorLiteral = vectorToSqlLiteral(finalVector);
  const rows = await prisma.$queryRawUnsafe(
    `
      SELECT
        p.id,
        NULL::int AS "matchedImageId",
        p.image AS "matchedImageUrl",
        0 AS "matchedImageOrder",
        (p."imageEmbedding" <=> $1::vector) AS distance,
        1 - (p."imageEmbedding" <=> $1::vector) AS similarity
      FROM "Product" p
      WHERE p."imageEmbedding" IS NOT NULL
        AND p."status" = 'PUBLISHED'
        AND p."isActive" = true
      ORDER BY distance ASC, id ASC
      LIMIT $2
      OFFSET $3
    `,
    vectorLiteral,
    safeLimit,
    safeOffset
  );

  return Array.isArray(rows)
    ? rows.map((row) => ({
        id: Number(row.id),
        matchedImageId: row.matchedImageId == null ? null : Number(row.matchedImageId),
        matchedImageUrl: row.matchedImageUrl || null,
        matchedImageOrder: row.matchedImageOrder == null ? null : Number(row.matchedImageOrder),
        distance: Number(row.distance),
        similarity: Number(row.similarity),
      }))
    : [];
}

/**
 * Search products by text embedding (CLIP, 512 dimensions)
 */
export async function searchProductsByTextVector(prisma, vector, limit = 20, offset = 0) {
  const safeLimit = Math.min(100, Math.max(1, Number.parseInt(String(limit || '20'), 10) || 20));
  const safeOffset = Math.max(0, Number.parseInt(String(offset || '0'), 10) || 0);
  
  // Ensure vector is 512 dimensions
  let finalVector = vector;
  if (vector.length !== 512) {
    finalVector = [...vector];
    while (finalVector.length < 512) finalVector.push(0);
    finalVector = finalVector.slice(0, 512);
  }
  
  const vectorLiteral = vectorToSqlLiteral(finalVector);
  const rows = await prisma.$queryRawUnsafe(
    `
      SELECT
        p.id,
        NULL::int AS "matchedImageId",
        p.image AS "matchedImageUrl",
        0 AS "matchedImageOrder",
        (p."textEmbedding" <=> $1::vector) AS distance,
        1 - (p."textEmbedding" <=> $1::vector) AS similarity
      FROM "Product" p
      WHERE p."textEmbedding" IS NOT NULL
        AND p."status" = 'PUBLISHED'
        AND p."isActive" = true
      ORDER BY distance ASC, id ASC
      LIMIT $2
      OFFSET $3
    `,
    vectorLiteral,
    safeLimit,
    safeOffset
  );

  return Array.isArray(rows)
    ? rows.map((row) => ({
        id: Number(row.id),
        matchedImageId: row.matchedImageId == null ? null : Number(row.matchedImageId),
        matchedImageUrl: row.matchedImageUrl || null,
        matchedImageOrder: row.matchedImageOrder == null ? null : Number(row.matchedImageOrder),
        distance: Number(row.distance),
        similarity: Number(row.similarity),
      }))
    : [];
}

/**
 * Lexical search over Product.nameNormalized.
 *
 * Ranks by TERM COVERAGE: a product whose normalized name contains all of the
 * query terms outranks one that contains only some. An exact-phrase match gets
 * an extra boost. Trigram similarity is the tiebreaker (handles typos / fuzzy
 * forms). Requires the `pg_trgm` extension and `Product.nameNormalized` column
 * (see scripts/migrate-search-hybrid.mjs).
 *
 * Returns rows ordered best-first with { id, coverage, lexSim }.
 */
export async function searchProductsByLexical(prisma, queryAr, limit = 100, offset = 0) {
  const terms = normalizedTerms(queryAr);
  if (terms.length === 0) return [];
  const phrase = normalizeArabic(queryAr);
  const safeLimit = Math.min(500, Math.max(1, Number.parseInt(String(limit), 10) || 100));
  const safeOffset = Math.max(0, Number.parseInt(String(offset), 10) || 0);

  // $1 = phrase, $2..$(n+1) = terms, then limit, offset
  const params = [phrase, ...terms, safeLimit, safeOffset];
  const limitParam = `$${terms.length + 2}`;
  const offsetParam = `$${terms.length + 3}`;

  // coverage = number of query terms present as substrings of the name.
  const coverageExpr = terms
    .map((_, i) => `(CASE WHEN p."nameNormalized" LIKE ('%' || $${i + 2} || '%') THEN 1 ELSE 0 END)`)
    .join(' + ');
  // A product is a candidate if it contains at least one term.
  const anyTermExpr = terms
    .map((_, i) => `p."nameNormalized" LIKE ('%' || $${i + 2} || '%')`)
    .join(' OR ');

  const rows = await prisma.$queryRawUnsafe(
    `
      SELECT
        p.id,
        NULL::int AS "matchedImageId",
        p.image AS "matchedImageUrl",
        0 AS "matchedImageOrder",
        (${coverageExpr}) AS coverage,
        (CASE WHEN p."nameNormalized" LIKE ('%' || $1 || '%') THEN 1 ELSE 0 END) AS phrase_hit,
        similarity(p."nameNormalized", $1) AS lex_sim
      FROM "Product" p
      WHERE p."nameNormalized" IS NOT NULL
        AND p."status" = 'PUBLISHED'
        AND p."isActive" = true
        AND (${anyTermExpr})
      ORDER BY phrase_hit DESC, coverage DESC, lex_sim DESC, p.id ASC
      LIMIT ${limitParam}
      OFFSET ${offsetParam}
    `,
    ...params
  );

  return Array.isArray(rows)
    ? rows.map((row) => ({
        id: Number(row.id),
        matchedImageId: null,
        matchedImageUrl: row.matchedImageUrl || null,
        matchedImageOrder: 0,
        coverage: Number(row.coverage) + Number(row.phrase_hit || 0),
        lexSim: Number(row.lex_sim),
      }))
    : [];
}

/**
 * Hybrid text search: lexical (term coverage on the Arabic name) fused with the
 * CLIP text-embedding vector search via Reciprocal Rank Fusion.
 *
 * Ranking contract:
 *   1. Literal multi-word matches win — higher term coverage always ranks first.
 *   2. Within the same coverage, RRF blends lexical + semantic rank.
 *   3. Pure-semantic (synonym) hits — coverage 0 — appear only AFTER literal
 *      matches, as a recall backup. CLIP is never a filter.
 *
 * Both halves keep the status=PUBLISHED + isActive guard.
 */
export async function searchHybridText(prisma, vector, queryAr, limit = 20, offset = 0) {
  const safeLimit = Math.min(100, Math.max(1, Number.parseInt(String(limit), 10) || 20));
  const safeOffset = Math.max(0, Number.parseInt(String(offset), 10) || 0);
  const poolSize = Math.min(500, safeOffset + safeLimit + 100);
  const K = 60; // RRF damping constant

  const [lexHits, vecHits] = await Promise.all([
    searchProductsByLexical(prisma, queryAr, poolSize, 0),
    Array.isArray(vector) && vector.length
      ? searchProductsByTextVector(prisma, vector, poolSize, 0)
      : Promise.resolve([]),
  ]);

  const merged = new Map();
  const ensure = (id) => {
    if (!merged.has(id)) {
      merged.set(id, {
        id,
        coverage: 0,
        rrf: 0,
        similarity: 0,
        matchedImageId: null,
        matchedImageUrl: null,
        matchedImageOrder: null,
      });
    }
    return merged.get(id);
  };

  lexHits.forEach((hit, rank) => {
    const e = ensure(hit.id);
    e.coverage = Math.max(e.coverage, hit.coverage);
    e.rrf += 1 / (K + rank + 1);
    if (!e.matchedImageUrl) e.matchedImageUrl = hit.matchedImageUrl;
    if (e.similarity === 0) e.similarity = hit.lexSim;
  });

  vecHits.forEach((hit, rank) => {
    const e = ensure(hit.id);
    e.rrf += 1 / (K + rank + 1);
    // Prefer the semantic similarity score for display when present.
    e.similarity = hit.similarity;
    e.matchedImageId = hit.matchedImageId ?? e.matchedImageId;
    if (hit.matchedImageUrl) e.matchedImageUrl = hit.matchedImageUrl;
    e.matchedImageOrder = hit.matchedImageOrder ?? e.matchedImageOrder;
  });

  const ordered = Array.from(merged.values()).sort((a, b) => {
    if (b.coverage !== a.coverage) return b.coverage - a.coverage; // literal matches first
    if (b.rrf !== a.rrf) return b.rrf - a.rrf;
    return a.id - b.id;
  });

  return ordered.slice(safeOffset, safeOffset + safeLimit);
}

/**
 * Hybrid search: combines text embedding similarity with image embedding similarity
 */
export async function searchProductsByHybridVector(prisma, textVector, imageVector = null, limit = 20, offset = 0) {
  const safeLimit = Math.min(100, Math.max(1, Number.parseInt(String(limit || '20'), 10) || 20));
  const safeOffset = Math.max(0, Number.parseInt(String(offset || '0'), 10) || 0);
  
  // Ensure vectors are 512 dimensions
  let finalTextVector = textVector;
  if (textVector.length !== 512) {
    finalTextVector = [...textVector];
    while (finalTextVector.length < 512) finalTextVector.push(0);
    finalTextVector = finalTextVector.slice(0, 512);
  }
  
  let finalImageVector = imageVector || finalTextVector;
  if (finalImageVector.length !== 512) {
    finalImageVector = [...finalImageVector];
    while (finalImageVector.length < 512) finalImageVector.push(0);
    finalImageVector = finalImageVector.slice(0, 512);
  }
  
  const textVectorLiteral = vectorToSqlLiteral(finalTextVector);
  const imageVectorLiteral = vectorToSqlLiteral(finalImageVector);
  
  const rows = await prisma.$queryRawUnsafe(
    `
      SELECT
        p.id,
        NULL::int AS "matchedImageId",
        p.image AS "matchedImageUrl",
        0 AS "matchedImageOrder",
        -- Hybrid distance: average of text and image distances
        ((p."textEmbedding" <=> $1::vector) + (p."imageEmbedding" <=> $2::vector)) / 2 AS distance,
        -- Hybrid similarity: average of text and image similarities
        ((1 - (p."textEmbedding" <=> $1::vector)) + (1 - (p."imageEmbedding" <=> $2::vector))) / 2 AS similarity,
        -- Individual similarities for debugging
        1 - (p."textEmbedding" <=> $1::vector) AS text_similarity,
        1 - (p."imageEmbedding" <=> $2::vector) AS image_similarity
      FROM "Product" p
      WHERE (p."textEmbedding" IS NOT NULL OR p."imageEmbedding" IS NOT NULL)
        AND p."status" = 'PUBLISHED'
        AND p."isActive" = true
      ORDER BY distance ASC, id ASC
      LIMIT $3
      OFFSET $4
    `,
    textVectorLiteral,
    imageVectorLiteral,
    safeLimit,
    safeOffset
  );

  return Array.isArray(rows)
    ? rows.map((row) => ({
        id: Number(row.id),
        matchedImageId: row.matchedImageId == null ? null : Number(row.matchedImageId),
        matchedImageUrl: row.matchedImageUrl || null,
        matchedImageOrder: row.matchedImageOrder == null ? null : Number(row.matchedImageOrder),
        distance: Number(row.distance),
        similarity: Number(row.similarity),
        textSimilarity: Number(row.text_similarity),
        imageSimilarity: Number(row.image_similarity),
      }))
    : [];
}
