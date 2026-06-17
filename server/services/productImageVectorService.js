import { embedImage, embedText } from './clipService.js';

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
