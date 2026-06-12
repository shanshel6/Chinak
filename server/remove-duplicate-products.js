import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });

import prisma from './prismaClient.js';

async function removeDuplicateProducts() {
  console.log('🔍 Finding duplicate products...');

  // Step 1: Find all products with goofishItemId
  const products = await prisma.product.findMany({
    select: {
      id: true,
      aiMetadata: true,
      createdAt: true
    },
    where: {
      aiMetadata: {
        not: null
      }
    },
    orderBy: {
      createdAt: 'desc'
    }
  });

  console.log(`📦 Found ${products.length} products with aiMetadata`);

  // Step 2: Group products by goofishItemId
  const productsByGoofishId = {};
  for (const product of products) {
    const goofishItemId = product.aiMetadata?.goofishItemId;
    if (goofishItemId) {
      if (!productsByGoofishId[goofishItemId]) {
        productsByGoofishId[goofishItemId] = [];
      }
      productsByGoofishId[goofishItemId].push(product);
    }
  }

  // Step 3: Find duplicates (groups with >1 product)
  const duplicates = Object.entries(productsByGoofishId).filter(
    ([_, products]) => products.length > 1
  );

  console.log(`⚠️ Found ${duplicates.length} duplicate goofishItemId groups`);

  if (duplicates.length === 0) {
    console.log('✅ No duplicates found!');
    await prisma.$disconnect();
    return;
  }

  // Step 4: For each duplicate group, keep the first one and delete the rest
  const productsToDelete = [];
  for (const [goofishItemId, groupProducts] of duplicates) {
    // Keep the first product (oldest or newest? We'll keep the oldest - createdAt asc)
    const sortedProducts = [...groupProducts].sort((a, b) => a.createdAt - b.createdAt);
    const [keepProduct, ...deleteProducts] = sortedProducts;
    console.log(`\n📋 goofishItemId: ${goofishItemId}`);
    console.log(`   ✅ Keeping product id: ${keepProduct.id} (created at: ${keepProduct.createdAt})`);
    deleteProducts.forEach(p => {
      console.log(`   ❌ Deleting product id: ${p.id} (created at: ${p.createdAt})`);
      productsToDelete.push(p.id);
    });
  }

  // Step 5: DRY RUN FIRST! Show what we would delete
  console.log(`\n⚠️ DRY RUN: Would delete ${productsToDelete.length} products`);
  console.log('   Product IDs to delete:', productsToDelete);

  // Step 6: Delete duplicates!
  console.log('\n🗑️ Deleting duplicate products...');
  for (const productId of productsToDelete) {
    try {
      await prisma.product.delete({
        where: { id: productId }
      });
      console.log(`   ✅ Deleted product id: ${productId}`);
    } catch (error) {
      console.error(`   ❌ Failed to delete product id: ${productId}`, error.message);
    }
  }

  console.log('\n✅ Done! Deleted', productsToDelete.length, 'duplicate products');

  await prisma.$disconnect();
}

removeDuplicateProducts().catch(console.error);
