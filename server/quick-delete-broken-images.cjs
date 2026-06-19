#!/usr/bin/env node

/**
 * Quick script to delete products with broken images
 */

import prisma from './prismaClient.js';

async function testImageUrl(url) {
  try {
    const response = await fetch(url, { method: 'HEAD' });
    return response.ok;
  } catch {
    return false;
  }
}

async function main() {
  console.log('🔍 Finding products with broken images...\n');

  // Get all active products
  const products = await prisma.product.findMany({
    where: { isActive: true, status: 'PUBLISHED' },
    include: { images: true }
  });

  console.log(`Total products: ${products.length}`);

  const productsToDelete = [];

  // Check each product
  for (const product of products) {
    if (product.images.length === 0) {
      // No images at all
      productsToDelete.push(product.id);
      console.log(`❌ Product ${product.id}: No images`);
      continue;
    }

    // Check if all images are broken
    let allBroken = true;
    let brokenCount = 0;

    for (const image of product.images) {
      const ok = await testImageUrl(image.url);
      if (!ok) {
        brokenCount++;
      } else {
        allBroken = false;
      }
    }

    if (allBroken && product.images.length > 0) {
      productsToDelete.push(product.id);
      console.log(`❌ Product ${product.id}: All ${brokenCount} images broken`);
    }

    // Progress
    if (productsToDelete.length % 100 === 0) {
      console.log(`Checked ${products.length} products, ${productsToDelete.length} to delete`);
    }
  }

  console.log(`\n📊 Products to delete: ${productsToDelete.length}`);

  // Delete them
  if (productsToDelete.length > 0) {
    console.log(`\n🗑️  Deleting ${productsToDelete.length} products...`);

    const deleted = await prisma.product.deleteMany({
      where: { id: { in: productsToDelete } }
    });

    console.log(`✅ Deleted ${deleted.count} products`);
  }

  await prisma.$disconnect();
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
