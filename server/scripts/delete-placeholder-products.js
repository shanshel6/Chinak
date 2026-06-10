import prisma from '../prismaClient.js';

const PLACEHOLDER_IMAGE_URL = 'https://img.alicdn.com/imgextra/i4/O1CN01CYtPWu1MUBqQAUK9D_!!6000000001437-2-tps-2-2.png';
const PRODUCT_BATCH_SIZE = 6000;

async function main() {
  console.log(`Checking the latest ${PRODUCT_BATCH_SIZE} products for placeholder image or missing valid images...`);

  const recentProducts = await prisma.product.findMany({
    orderBy: { id: 'desc' },
    take: PRODUCT_BATCH_SIZE,
    select: {
      id: true,
      image: true,
      images: {
        select: { id: true, url: true }
      }
    }
  });

  const productIdsToDelete = [];

  for (const product of recentProducts) {
    const hasMainPlaceholder = product.image === PLACEHOLDER_IMAGE_URL;
    const hasValidMainImage = Boolean(product.image && product.image !== PLACEHOLDER_IMAGE_URL);
    const galleryPlaceholderCount = Array.isArray(product.images)
      ? product.images.filter((img) => img.url === PLACEHOLDER_IMAGE_URL).length
      : 0;
    const galleryValidCount = Array.isArray(product.images)
      ? product.images.filter((img) => img.url && img.url !== PLACEHOLDER_IMAGE_URL).length
      : 0;

    const shouldDeleteBecausePlaceholder = hasMainPlaceholder || galleryPlaceholderCount > 0;
    const shouldDeleteBecauseNoValidImage = !hasValidMainImage && galleryValidCount === 0;

    if (shouldDeleteBecausePlaceholder || shouldDeleteBecauseNoValidImage) {
      productIdsToDelete.push(product.id);
    }
  }

  if (productIdsToDelete.length === 0) {
    console.log('No matching products found in the last 6000 items. Nothing deleted.');
    return;
  }

  console.log(`Found ${productIdsToDelete.length} product(s) to delete.`);
  console.log('Product IDs:', productIdsToDelete.join(', '));

  const deleteResult = await prisma.product.deleteMany({
    where: { id: { in: productIdsToDelete } }
  });

  console.log(`Deleted ${deleteResult.count} product(s).`);
}

main()
  .catch((error) => {
    console.error('Cleanup script failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
