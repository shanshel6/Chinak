import prisma from '../prismaClient.js';

/**
 * Deletes "bad" images (white/placeholder/small) from the database.
 * 
 * Bad image patterns:
 * 1. URLs ending with _Q90.jpg_ (fleamarket placeholder/white images)
 * 2. URLs containing ~livephoto~ (live photo HEIC variants)
 * 3. URLs containing tps-48-48 (tiny 48x48 placeholder PNGs)
 * 
 * Rules:
 * - From ProductImage table: delete any row matching bad patterns
 * - From Product.image (main image): only clear it if the product has other
 *   good images in ProductImage to fall back on. Otherwise keep it so the
 *   product isn't left with zero images.
 */

// Patterns that identify bad/placeholder/white/small images
const BAD_IMAGE_PATTERNS = [
  /_Q90\.jpg_$/,             // fleamarket white/placeholder images
  /~livephoto~/,             // live photo HEIC variants (small/placeholder)
  /tps-48-48/,               // 48x48 tiny placeholder PNGs
];

function isBadImage(url) {
  if (!url) return false;
  return BAD_IMAGE_PATTERNS.some((pattern) => pattern.test(url));
}

async function main() {
  console.log('=== Bad Image Cleanup Script ===\n');

  // ------------------------------------------------------------------
  // Step 1: Delete bad images from ProductImage table
  // ------------------------------------------------------------------
  console.log('Step 1: Fetching all ProductImage rows...');

  // We need to scan all images. Fetch in batches to avoid memory issues.
  const allGalleryImages = await prisma.productImage.findMany({
    select: { id: true, url: true, productId: true },
  });

  console.log(`  Total gallery images in DB: ${allGalleryImages.length}`);

  const badGalleryImageIds = [];
  const badGalleryImageInfo = [];

  for (const img of allGalleryImages) {
    if (isBadImage(img.url)) {
      badGalleryImageIds.push(img.id);
      badGalleryImageInfo.push({ id: img.id, productId: img.productId, url: img.url });
    }
  }

  console.log(`  Bad gallery images found: ${badGalleryImageIds.length}`);

  if (badGalleryImageIds.length > 0) {
    // Log a sample of what we're deleting
    console.log('\n  Sample of bad gallery images to delete:');
    badGalleryImageInfo.slice(0, 10).forEach((img) => {
      console.log(`    [id=${img.id}] productId=${img.productId} url=${img.url}`);
    });
    if (badGalleryImageInfo.length > 10) {
      console.log(`    ... and ${badGalleryImageInfo.length - 10} more`);
    }

    // Delete in batches of 1000
    const BATCH_SIZE = 1000;
    let deletedGalleryCount = 0;
    for (let i = 0; i < badGalleryImageIds.length; i += BATCH_SIZE) {
      const batch = badGalleryImageIds.slice(i, i + BATCH_SIZE);
      const result = await prisma.productImage.deleteMany({
        where: { id: { in: batch } },
      });
      deletedGalleryCount += result.count;
    }
    console.log(`\n  ✅ Deleted ${deletedGalleryCount} bad images from ProductImage table.`);
  }

  // ------------------------------------------------------------------
  // Step 2: Fix Product.image (main image) if it's a bad URL
  // ------------------------------------------------------------------
  console.log('\nStep 2: Checking Product.image (main image) for bad URLs...');

  // Find all products whose main image matches a bad pattern
  // We use OR conditions for each pattern
  const productsWithBadMainImage = await prisma.product.findMany({
    where: {
      AND: [
        { image: { not: null } },
        {
          OR: [
            { image: { endsWith: '_Q90.jpg_' } },
            { image: { contains: '~livephoto~' } },
            { image: { contains: 'tps-48-48' } },
          ],
        },
      ],
    },
    select: {
      id: true,
      image: true,
      images: {
        select: { id: true, url: true },
      },
    },
  });

  console.log(`  Products with bad main image: ${productsWithBadMainImage.length}`);

  let clearedMainImageCount = 0;
  let replacedMainImageCount = 0;
  let keptMainImageCount = 0;

  for (const product of productsWithBadMainImage) {
    // Find good gallery images for this product (after cleanup)
    const goodGalleryImages = product.images.filter((img) => !isBadImage(img.url));

    if (goodGalleryImages.length > 0) {
      // Replace main image with the first good gallery image
      const newMainImage = goodGalleryImages[0].url;
      await prisma.product.update({
        where: { id: product.id },
        data: { image: newMainImage },
      });
      replacedMainImageCount++;
    } else {
      // No good gallery images exist. Clear the main image to null
      // (product has no valid images at all — better than keeping a bad one)
      await prisma.product.update({
        where: { id: product.id },
        data: { image: null },
      });
      clearedMainImageCount++;
    }
  }

  if (productsWithBadMainImage.length > 0) {
    console.log(`  ✅ Replaced main image with good gallery image: ${replacedMainImageCount} products.`);
    console.log(`  ✅ Cleared main image (no good images available): ${clearedMainImageCount} products.`);
  }

  // ------------------------------------------------------------------
  // Summary
  // ------------------------------------------------------------------
  console.log('\n=== SUMMARY ===');
  console.log(`Bad gallery images deleted from ProductImage: ${badGalleryImageIds.length}`);
  console.log(`Product main images replaced with good image:     ${replacedMainImageCount}`);
  console.log(`Product main images cleared (no good images):     ${clearedMainImageCount}`);
  console.log(`Total bad images removed:                         ${badGalleryImageIds.length + replacedMainImageCount + clearedMainImageCount}`);
  console.log('\nDone.');
}

main()
  .catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
