import { embedImage } from './clipService.js';

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
  const selectedLimit = Math.max(1, maxImages || MAX_PRODUCT_IMAGE_EMBEDDINGS);
  let productImages = await loadTopProductImages(prisma, productId, selectedLimit, runDb);

  if (productImages.length === 0) {
    const fallbackUrl = sanitizeProductImageUrl(fallbackImageUrl);
    if (fallbackUrl) {
      await runDb(
        () => prisma.productImage.create({
          data: {
            productId,
            url: fallbackUrl,
            order: 0,
            type: 'GALLERY'
          }
        }),
        `create fallback product image ${productId}`
      );
      productImages = await loadTopProductImages(prisma, productId, selectedLimit, runDb);
    }
  }

  if (productImages.length === 0) {
    return { embeddedCount: 0, embeddedImageIds: [], mainVector: null };
  }

  let mainVector = null;
  const embeddedImageIds = [];
  const allEmbeddings = [];

  for (const image of productImages) {
    const imageUrl = sanitizeProductImageUrl(image.url);
    if (!imageUrl) continue;

    try {
      const embedding = await embedImage(imageUrl, productName || null);
      if (!Array.isArray(embedding) || embedding.length === 0 || embedding.every((value) => value === 0)) {
        logger.warn?.(`[Image Embedding] Empty/zero embedding for Product ${productId}, image ${image.id}`);
        continue;
      }

      allEmbeddings.push(embedding);
      const vectorLiteral = vectorToSqlLiteral(embedding);
      await runDb(
        () => prisma.$executeRawUnsafe(
          `UPDATE "ProductImage" SET "url" = $1, "imageEmbedding" = $2::vector WHERE "id" = $3`,
          imageUrl,
          vectorLiteral,
          image.id
        ),
        `update product image embedding ${image.id}`
      );

      if (!mainVector) {
        mainVector = vectorLiteral;
      }
      embeddedImageIds.push(image.id);
    } catch (error) {
      logger.warn?.(`[Image Embedding] Failed for Product ${productId}, image ${image.id}: ${error?.message || error}`);
    }
  }

  // Ensure we use the correct logger from ensureProductImageEmbeddings if available
  const activeLogger = logger || console;

  await runDb(
    () => prisma.$executeRawUnsafe(
      `
        UPDATE "ProductImage"
        SET "imageEmbedding" = NULL
        WHERE "productId" = $1
          AND "id" NOT IN (
            SELECT id
            FROM "ProductImage"
            WHERE "productId" = $1
            ORDER BY "order" ASC, "id" ASC
            LIMIT $2
          )
      `,
      productId,
      selectedLimit
    ),
    `clear extra product image embeddings ${productId}`
  ).catch(err => {
    activeLogger.warn?.(`[Image Embedding] Non-critical error clearing extra embeddings for Product ${productId}: ${err.message}`);
    // We don't throw here to prevent freezing the entire pipeline for a non-critical cleanup task
  });

  if (mainVector) {
    await runDb(
      () => prisma.$executeRawUnsafe(
        `UPDATE "Product" SET "imageEmbedding" = $1::vector WHERE "id" = $2`,
        mainVector,
        productId
      ),
      `update legacy image embedding ${productId}`
    );
  }

  // Compute averaged embedding from all images for better category matching
  let averagedVector = null;
  if (allEmbeddings.length > 0) {
    const dim = allEmbeddings[0].length;
    const avg = new Array(dim).fill(0);
    for (const emb of allEmbeddings) {
      for (let i = 0; i < dim; i++) avg[i] += emb[i];
    }
    for (let i = 0; i < dim; i++) avg[i] /= allEmbeddings.length;
    averagedVector = avg;
  }

  return {
    embeddedCount: embeddedImageIds.length,
    embeddedImageIds,
    mainVector,
    averagedVector
  };
}

export async function searchProductsByImageVector(prisma, vector, limit = 20, offset = 0) {
  const safeLimit = Math.min(100, Math.max(1, Number.parseInt(String(limit || '20'), 10) || 20));
  const safeOffset = Math.max(0, Number.parseInt(String(offset || '0'), 10) || 0);
  const vectorLiteral = vectorToSqlLiteral(vector);
  const rows = await prisma.$queryRawUnsafe(
    `
      WITH image_matches AS (
        SELECT
          pi."productId" AS id,
          pi.id AS "matchedImageId",
          pi.url AS "matchedImageUrl",
          pi."order" AS "matchedImageOrder",
          (pi."imageEmbedding" <=> $1::vector) AS distance
        FROM "ProductImage" pi
        INNER JOIN "Product" p ON p.id = pi."productId"
        WHERE pi."imageEmbedding" IS NOT NULL
          AND p."status" = 'PUBLISHED'
          AND p."isActive" = true
      ),
      legacy_matches AS (
        SELECT
          p.id AS id,
          NULL::int AS "matchedImageId",
          p.image AS "matchedImageUrl",
          0 AS "matchedImageOrder",
          (p."imageEmbedding" <=> $1::vector) AS distance
        FROM "Product" p
        WHERE p."imageEmbedding" IS NOT NULL
          AND p."status" = 'PUBLISHED'
          AND p."isActive" = true
      ),
      combined_matches AS (
        SELECT * FROM image_matches
        UNION ALL
        SELECT * FROM legacy_matches
      ),
      ranked_matches AS (
        SELECT
          id,
          "matchedImageId",
          "matchedImageUrl",
          "matchedImageOrder",
          distance,
          1 - distance AS similarity,
          ROW_NUMBER() OVER (
            PARTITION BY id
            ORDER BY distance ASC, "matchedImageOrder" ASC, COALESCE("matchedImageId", 0) ASC
          ) AS rn
        FROM combined_matches
      )
      SELECT
        id,
        "matchedImageId",
        "matchedImageUrl",
        "matchedImageOrder",
        distance,
        similarity
      FROM ranked_matches
      WHERE rn = 1
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
